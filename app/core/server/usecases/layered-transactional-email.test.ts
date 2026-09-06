import { describe, expect, it } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  SMOKE_TENANT_ID,
  type AppError,
  type EmailIntegrationTransport,
  type EmailMessage,
  type Result,
} from '#core/domain/index.js';
import type {
  EmailIntegrationTransportResolver,
  EmailPort,
  PlatformTransactionalPool,
} from '../ports.js';
import { createLayeredTransactionalEmailSender } from './layered-transactional-email.js';

const message: EmailMessage = {
  subject: 'Reset password',
  html: '<p>Reset</p>',
  text: 'Reset',
};

class MemoryPool implements PlatformTransactionalPool {
  sent = 0;
  reserved = 0;

  constructor(sent = 0) {
    this.sent = sent;
  }

  async usage() {
    return { sent: this.sent, reserved: this.reserved };
  }

  async reserve(_tenantId: string, limit: number) {
    if (this.sent + this.reserved >= limit) return false;
    this.reserved += 1;
    return true;
  }

  async settle(_tenantId: string, successful: boolean) {
    this.reserved -= 1;
    if (successful) this.sent += 1;
  }
}

const port = (
  name: string,
  calls: string[],
  result: Result<{ messageId: string }, AppError> = ok({ messageId: `${name}-message` }),
): EmailPort => ({
  healthcheck: async () => ok({ healthy: true }),
  test: async () => ok({ code: 'email.available', message: 'Email is available.' }),
  send: async () => {
    calls.push(name);
    return result;
  },
});

const transports = (
  ports: Record<EmailIntegrationTransport, EmailPort | null>,
): EmailIntegrationTransportResolver => ({
  resolve: async (_tenantId, transport) => ports[transport],
});

describe('layered transactional e-mail sender', () => {
  it.each([
    {
      name: 'tenant SES before SMTP and platform',
      tenantSes: true,
      smtp: true,
      expected: 'tenant-ses',
    },
    {
      name: 'SMTP when tenant SES is unavailable',
      tenantSes: false,
      smtp: true,
      expected: 'smtp',
    },
    {
      name: 'platform SES when tenant transports are unavailable',
      tenantSes: false,
      smtp: false,
      resend: false,
      expected: 'platform',
    },
    {
      name: 'Resend when tenant SES and SMTP are unavailable',
      tenantSes: false,
      smtp: false,
      resend: true,
      expected: 'resend',
    },
  ])('$name', async ({ tenantSes, smtp, resend = false, expected }) => {
    const calls: string[] = [];
    const pool = new MemoryPool();
    const sender = createLayeredTransactionalEmailSender({
      transports: transports({
        ses: tenantSes ? port('tenant-ses', calls) : null,
        smtp: smtp ? port('smtp', calls) : null,
        resend: resend ? port('resend', calls) : null,
      }),
      platform: port('platform', calls),
      pool,
      platformLimit: 1000,
    });

    const sent = await sender.send({ tenantId: 'tenant-1', to: 'member@example.test', ...message });

    expect(sent).toEqual(ok({ messageId: `${expected}-message`, transport: expected }));
    expect(calls).toEqual([expected]);
    expect(pool.sent).toBe(expected === 'platform' ? 1 : 0);
  });

  it('does not fall through after a selected tenant transport fails', async () => {
    const calls: string[] = [];
    const sender = createLayeredTransactionalEmailSender({
      transports: transports({
        ses: port('tenant-ses', calls, err(integrationUnavailable('SES rejected the send'))),
        smtp: port('smtp', calls),
        resend: port('resend', calls),
      }),
      platform: port('platform', calls),
      pool: new MemoryPool(),
      platformLimit: 1000,
    });

    const sent = await sender.send({ tenantId: 'tenant-1', to: 'member@example.test', ...message });

    expect(sent).toEqual(err({
      ...integrationUnavailable('SES rejected the send'),
      details: { transport: 'tenant-ses', cause: undefined },
    }));
    expect(calls).toEqual(['tenant-ses']);
  });

  it('enforces the platform cap at exactly 1000', async () => {
    const calls: string[] = [];
    const pool = new MemoryPool(1000);
    const sender = createLayeredTransactionalEmailSender({
      transports: transports({ ses: null, smtp: null, resend: null }),
      platform: port('platform', calls),
      pool,
      platformLimit: 1000,
    });

    const sent = await sender.send({ tenantId: 'tenant-1', to: 'member@example.test', ...message });

    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error.code).toBe('transactional_platform_cap_reached');
    expect(calls).toEqual([]);
    expect(pool.sent).toBe(1000);
  });

  it('never uses the platform pool when a tenant transport is required', async () => {
    const calls: string[] = [];
    const pool = new MemoryPool();
    const sender = createLayeredTransactionalEmailSender({
      transports: transports({ ses: null, smtp: null, resend: null }),
      platform: port('platform', calls),
      pool,
      platformLimit: 1000,
    });
    const sent = await sender.send({
      tenantId: 'tenant-1',
      to: 'member@example.test',
      tenantTransportRequired: true,
      ...message,
    });
    expect(sent).toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });
    expect(calls).toEqual([]);
    expect(pool.sent).toBe(0);
  });

  it('allows only the remaining platform slots under concurrent sends', async () => {
    const pool = new MemoryPool(998);
    const calls: string[] = [];
    const sender = createLayeredTransactionalEmailSender({
      transports: transports({ ses: null, smtp: null, resend: null }),
      platform: port('platform', calls),
      pool,
      platformLimit: 1000,
    });

    const results = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      sender.send({ tenantId: 'tenant-1', to: `member-${String(index)}@example.test`, ...message })));

    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results.filter((result) => !result.ok)).toHaveLength(3);
    expect(pool.sent).toBe(1000);
    expect(pool.reserved).toBe(0);
  });

  it('increments platform usage only after a successful platform send', async () => {
    const pool = new MemoryPool(999);
    const calls: string[] = [];
    const sender = createLayeredTransactionalEmailSender({
      transports: transports({ ses: null, smtp: null, resend: null }),
      platform: port('platform', calls, err(integrationUnavailable('Platform SES unavailable'))),
      pool,
      platformLimit: 1000,
    });

    const failed = await sender.send({ tenantId: 'tenant-1', to: 'member@example.test', ...message });

    expect(failed.ok).toBe(false);
    expect(pool.sent).toBe(999);
    expect(pool.reserved).toBe(0);
  });

  it('drops the smoke tenant into the sink instead of any configured transport', async () => {
    const calls: string[] = [];
    const pool = new MemoryPool();
    const sender = createLayeredTransactionalEmailSender({
      transports: transports({
        ses: port('tenant-ses', calls),
        smtp: port('smtp', calls),
        resend: port('resend', calls),
      }),
      platform: port('platform', calls),
      pool,
      platformLimit: 1000,
      smokeTenantSink: port('sink', calls),
    });

    const sent = await sender.send({
      tenantId: SMOKE_TENANT_ID,
      to: 'member@example.test',
      ...message,
    });

    expect(sent).toEqual(ok({ messageId: 'sink-message', transport: 'platform' }));
    expect(calls).toEqual(['sink']);
    expect(pool.sent).toBe(0);
  });

  it('leaves other tenants on their own transport when the sink is configured', async () => {
    const calls: string[] = [];
    const sender = createLayeredTransactionalEmailSender({
      transports: transports({ ses: port('tenant-ses', calls), smtp: null, resend: null }),
      platform: port('platform', calls),
      pool: new MemoryPool(),
      platformLimit: 1000,
      smokeTenantSink: port('sink', calls),
    });

    await sender.send({ tenantId: 'tenant-studio', to: 'member@example.test', ...message });

    expect(calls).toEqual(['tenant-ses']);
  });
});
