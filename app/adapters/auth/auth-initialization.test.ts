import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';

import { createEmailOutboxRepository, createPlatformAuthSendLog } from '#adapters/db/email-outbox.js';
import * as schema from '#adapters/db/schema.js';

import { createAuth, createAuthPort } from './create-auth.js';

const buildAuthPort = (trustedOrigins: () => Promise<string[]>) => {
  const db = drizzle.mock({ schema });
  return createAuthPort(createAuth(db, {
    secret: 'auth-initialization-test-secret-at-least-32-characters',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
    trustedOrigins,
    secureCookies: false,
    exposeMagicLinks: false,
    emailOutbox: createEmailOutboxRepository(db),
    emailSender: { send: async () => { throw new Error('Unexpected email delivery'); } },
    authSendLog: createPlatformAuthSendLog(db),
    ids: { nextId: () => crypto.randomUUID() },
    clock: { nowIso: () => '2026-01-01T00:00:00.000Z' },
    dispatchEmail: () => undefined,
    defaultTenantName: 'Together',
    google: null,
  }));
};

describe('createAuthPort.initialize', () => {
  it('waits for the shared context and initializes it only once across calls', async () => {
    let start: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { start = resolve; });
    let finish: (origins: string[]) => void = () => undefined;
    const ready = new Promise<string[]>((resolve) => { finish = resolve; });
    const trustedOrigins = vi.fn(async () => {
      start();
      return ready;
    });
    const authPort = buildAuthPort(trustedOrigins);
    const settled = vi.fn();
    const first = authPort.initialize().then(settled);
    const second = authPort.initialize().then(settled);
    await started;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(settled).not.toHaveBeenCalled();
    finish(['http://localhost:48730']);
    await Promise.all([first, second]);
    await authPort.initialize();
    expect(settled).toHaveBeenCalledTimes(2);
    expect(trustedOrigins).toHaveBeenCalledOnce();
  });

  it('observes eager initialization rejection before a request awaits the context', async () => {
    const failure = new Error('Auth context unavailable');
    const authPort = buildAuthPort(async () => { throw failure; });
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    await expect(authPort.initialize()).rejects.toBe(failure);
  });
});
