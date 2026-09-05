import { describe, expect, it } from 'vitest';

import {
  capabilitiesForApiKey,
  ok,
  type M2mTransactionalMessageInput,
  type TenantApiKey,
} from '#core/domain/index.js';

import {
  FakeEmailHmac,
  InMemoryAutomationIdempotencyRepository,
  InMemoryEmailEventRepository,
  InMemoryEmailOutboxRepository,
  InMemorySuppressionRepository,
} from '../testing/marketing-fakes.js';
import type { Ctx } from '../context.js';
import type { ApiKeyRateLimitRepository } from '../ports.js';
import { sendM2mTransactionalMessage, type M2mTransactionalEmailDeps } from './m2m-transactional-email.js';

const NOW = '1998-08-10T10:15:30.000Z';

const input = (idempotencyKey = 'order-1'): M2mTransactionalMessageInput => ({
  to: 'Buyer@Example.Test',
  subject: 'Your receipt',
  html: '<p>Paid</p>',
  replyTo: 'support@example.test',
  idempotencyKey,
});

const apiKey = (scopes: TenantApiKey['scopes'] = ['transactional']): TenantApiKey => ({
  id: 'key-1',
  tenantId: 'tenant-1',
  name: 'orders-app',
  keyHash: 'hash',
  scopes,
  createdAt: NOW,
  expiresAt: null,
  revokedAt: null,
});

const ctx = (key: TenantApiKey): Ctx => ({
  identity: {
    userId: 'api-key',
    email: 'api-key@together.invalid',
    name: 'Automation API',
    emailVerified: true,
    tenantId: 'tenant-1',
    tenantSlug: 'alpha',
    tenantName: 'Alpha',
    staffRole: null,
    memberId: null,
    image: null,
    memberDisplayName: null,
    memberBannedAt: null,
    memberDmOptOutAt: null,
    memberLanguage: null,
    memberVideoAutoplay: false,
  },
  capabilities: capabilitiesForApiKey(key),
});

const harness = (options: { transport?: boolean; perMinute?: number; perDay?: number } = {}) => {
  let sequence = 0;
  const events = new InMemoryEmailEventRepository();
  const outbox = new InMemoryEmailOutboxRepository(events);
  const suppressions = new InMemorySuppressionRepository(events);
  const counts = new Map<string, number>();
  const rateLimitClaims: Array<'minute' | 'hour' | 'day'> = [];
  const rateLimits: ApiKeyRateLimitRepository = {
    claim: async (_tenantId, claim) => {
      rateLimitClaims.push(claim.period);
      const key = `${claim.apiKeyId}:${claim.period}:${claim.windowStartedAt}`;
      const count = counts.get(key) ?? 0;
      if (count >= claim.limit) return false;
      counts.set(key, count + 1);
      return true;
    },
    release: async () => undefined,
  };
  const deps: M2mTransactionalEmailDeps = {
    idempotency: new InMemoryAutomationIdempotencyRepository(),
    rateLimits,
    limits: { perMinute: options.perMinute ?? 60, perDay: options.perDay ?? 5000 },
    transports: {
      resolve: async () => options.transport === false ? null : {
        send: async () => ok({ messageId: 'provider-1' }),
        healthcheck: async () => ok({ healthy: true }),
        test: async () => ok({ code: 'email.available', message: 'Email is available.' }),
      },
    },
    suppressions,
    hmac: new FakeEmailHmac(),
    outbox,
    events,
    ids: { nextId: () => `id-${String(sequence += 1)}` },
    clock: { nowIso: () => NOW },
    hash: { compute: (value) => `hash:${value}` },
  };
  return { deps, outbox, suppressions, events, rateLimitClaims };
};

describe('transactional M2M e-mail', () => {
  it('enqueues a tenant-transport-only message with source attribution', async () => {
    const h = harness();
    const key = apiKey();
    const result = await sendM2mTransactionalMessage(ctx(key), key, input(), h.deps);
    expect(result).toEqual({ ok: true, value: { messageId: 'id-1', replayed: false } });
    expect(h.outbox.items).toMatchObject([{
      id: 'id-1',
      tenantId: 'tenant-1',
      to: 'buyer@example.test',
      sourceApp: 'orders-app',
      tenantTransportRequired: true,
      payload: {
        kind: 'm2m-transactional',
        subject: 'Your receipt',
        html: '<p>Paid</p>',
        replyTo: 'support@example.test',
      },
    }]);
  });

  it('returns the original message id for an idempotent replay', async () => {
    const h = harness();
    const key = apiKey();
    const first = await sendM2mTransactionalMessage(ctx(key), key, input(), h.deps);
    const replay = await sendM2mTransactionalMessage(ctx(key), key, input(), h.deps);
    expect(first).toEqual({ ok: true, value: { messageId: 'id-1', replayed: false } });
    expect(replay).toEqual({ ok: true, value: { messageId: 'id-1', replayed: true } });
    expect(h.outbox.items).toHaveLength(1);
    expect(h.rateLimitClaims).toEqual(['day', 'minute']);
  });

  it('keeps an in-flight idempotent request incomplete until enqueue succeeds', async () => {
    const h = harness();
    const key = apiKey();
    const enqueue = h.outbox.enqueue.bind(h.outbox);
    let reachedEnqueue: () => void = () => undefined;
    let finishEnqueue: () => void = () => undefined;
    const enqueueReached = new Promise<void>((resolve) => { reachedEnqueue = resolve; });
    const enqueueFinished = new Promise<void>((resolve) => { finishEnqueue = resolve; });
    h.outbox.enqueue = async (queued) => {
      reachedEnqueue();
      await enqueueFinished;
      return enqueue(queued);
    };

    const firstRequest = sendM2mTransactionalMessage(ctx(key), key, input(), h.deps);
    await enqueueReached;
    expect(await sendM2mTransactionalMessage(ctx(key), key, input(), h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { retryable: true } },
    });
    finishEnqueue();
    expect(await firstRequest).toEqual({ ok: true, value: { messageId: 'id-1', replayed: false } });
    expect(await sendM2mTransactionalMessage(ctx(key), key, input(), h.deps)).toEqual({
      ok: true,
      value: { messageId: 'id-1', replayed: true },
    });
    expect(h.outbox.items).toHaveLength(1);
  });

  it('fails before enqueue when no tenant transport is configured', async () => {
    const h = harness({ transport: false });
    const key = apiKey();
    expect(await sendM2mTransactionalMessage(ctx(key), key, input(), h.deps)).toMatchObject({
      ok: false,
      error: { code: 'integration_not_configured' },
    });
    expect(h.outbox.items).toHaveLength(0);
  });

  it('blocks hard-bounce suppression while ignoring global unsubscribe', async () => {
    const hardBounce = harness();
    await hardBounce.suppressions.record('tenant-1', {
      id: 'suppression-1',
      tenantId: 'tenant-1',
      email: 'buyer@example.test',
      emailHmac: 'tenant-1:buyer@example.test',
      reason: 'hard_bounce',
      sourceRef: null,
      meta: null,
      createdAt: NOW,
      liftedAt: null,
      liftedBy: null,
    });
    const key = apiKey();
    expect(await sendM2mTransactionalMessage(ctx(key), key, input(), hardBounce.deps)).toMatchObject({
      ok: false,
      error: { code: 'suppressed', details: { reason: 'hard_bounce' } },
    });
    expect((await hardBounce.events.listByRef('tenant-1', 'transactional', 'id-1')).map((event) => event.type))
      .toEqual(['skipped']);
    const unsubscribe = harness();
    await unsubscribe.suppressions.record('tenant-1', {
      id: 'suppression-2',
      tenantId: 'tenant-1',
      email: 'buyer@example.test',
      emailHmac: 'tenant-1:buyer@example.test',
      reason: 'unsubscribe_global',
      sourceRef: null,
      meta: null,
      createdAt: NOW,
      liftedAt: null,
      liftedBy: null,
    });
    expect(await sendM2mTransactionalMessage(ctx(key), key, input(), unsubscribe.deps)).toMatchObject({ ok: true });
    expect(await unsubscribe.suppressions.record('tenant-1', {
      id: 'suppression-3',
      tenantId: 'tenant-1',
      email: 'buyer@example.test',
      emailHmac: 'tenant-1:buyer@example.test',
      reason: 'complaint',
      sourceRef: 'message-1',
      meta: null,
      createdAt: NOW,
      liftedAt: null,
      liftedBy: null,
    })).toBe(true);
    expect(await unsubscribe.suppressions.findActive('tenant-1', 'tenant-1:buyer@example.test'))
      .toMatchObject({ reason: 'complaint', sourceRef: 'message-1' });
    expect(await sendM2mTransactionalMessage(ctx(key), key, input('order-2'), unsubscribe.deps)).toMatchObject({
      ok: false,
      error: { code: 'suppressed', details: { reason: 'complaint' } },
    });
  });

  it('rate-limits new requests per API key and returns a retry interval', async () => {
    const h = harness({ perMinute: 1 });
    const key = apiKey();
    expect(await sendM2mTransactionalMessage(ctx(key), key, input('order-1'), h.deps)).toMatchObject({ ok: true });
    expect(await sendM2mTransactionalMessage(ctx(key), key, input('order-1'), h.deps)).toMatchObject({
      ok: true,
      value: { replayed: true },
    });
    expect(await sendM2mTransactionalMessage(ctx(key), key, input('order-2'), h.deps)).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', details: { period: 'minute', retryAfterSeconds: 30 } },
    });
    expect(h.rateLimitClaims).toEqual(['day', 'minute', 'day', 'minute']);
  });

  it('does not claim the minute window after the daily window rejects', async () => {
    const h = harness({ perDay: 1 });
    const key = apiKey();
    expect(await sendM2mTransactionalMessage(ctx(key), key, input('order-1'), h.deps)).toMatchObject({ ok: true });
    expect(await sendM2mTransactionalMessage(ctx(key), key, input('order-2'), h.deps)).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', details: { period: 'day' } },
    });
    expect(h.rateLimitClaims).toEqual(['day', 'minute', 'day']);
  });

  it('rejects a key without the transactional scope', async () => {
    const h = harness();
    const key = apiKey(['enrollment']);
    expect(await sendM2mTransactionalMessage(ctx(key), key, input(), h.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(h.outbox.items).toHaveLength(0);
  });
});
