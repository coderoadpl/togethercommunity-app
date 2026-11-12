import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ok } from '#core/domain/index.js';
import { createMetaCapiRepository } from './meta-capi.js';
import * as schema from './schema.js';

const identifiers = ['cs_live_private_session', 'private-order-token', '192.0.2.99', 'private-user-agent', 'fb.1.1234567890123.private'];
const now = '2026-11-01T10:00:00.000Z';
const capture = { at: now, ip: identifiers[2] ?? null, userAgent: identifiers[3] ?? null, fbp: identifiers[4] ?? null,
  textVersion: 'version', textSnapshot: '{}' };

const setup = (code: string) => {
  const client = new pg.Client();
  const query = vi.spyOn(client, 'query').mockRejectedValue(Object.assign(new Error(identifiers.join(' ')), { code }));
  const repository = createMetaCapiRepository(drizzle(client, { schema }), async () => 'https://example.org');
  return { repository, query };
};

const assertRedacted = async (operation: Promise<unknown>, sqlstate = '57014') => {
  const error: unknown = await operation.catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error('Expected an infrastructure error');
  expect(error.message).toBe('Meta CAPI database operation failed');
  expect(error.cause).toEqual(new Error(`PostgreSQL SQLSTATE ${sqlstate}`));
  for (const identifier of identifiers) {
    expect(error.message).not.toContain(identifier);
    expect(error.stack).not.toContain(identifier);
    expect(String(error.cause)).not.toContain(identifier);
    if (error.cause instanceof Error) {
      expect(error.cause.stack).not.toContain(identifier);
      expect(error.cause.cause).toBeUndefined();
    }
  }
};

describe('Meta CAPI database error redaction', () => {
  it.each([{ sessionId: identifiers[0] ?? '' }, { orderToken: identifiers[1] ?? '' }])('redacts a credential lookup for %j', async (access) => {
    const { repository, query } = setup('57014');
    await assertRedacted(repository.findOrder('workspace', access));
    expect(query).toHaveBeenCalledOnce();
  });

  it.each(['granted', 'denied', 'withdrawn'] as const)('redacts a failed %s transaction', async (decision) => {
    const { repository, query } = setup('57014');
    await assertRedacted(repository.decide('workspace', { sessionId: identifiers[0] ?? '' }, async () => ok({ decision, capture })));
    expect(query).toHaveBeenCalled();
  });

  it('redacts dispatch and both list boundaries', async () => {
    const { repository } = setup('57014');
    await assertRedacted(repository.processNext('workspace', now, async () => ({ retryAt: now })));
    await assertRedacted(repository.listEvents('workspace'));
    await assertRedacted(repository.listMemberConsents('workspace', 'buyer'));
  });

  it('does not retain unvalidated SQLSTATE data', async () => {
    const { repository } = setup(identifiers.join(' '));
    const error: unknown = await repository.findOrder('workspace', { sessionId: identifiers[0] ?? '' }).catch((cause: unknown) => cause);
    if (!(error instanceof Error)) throw new Error('Expected an infrastructure error');
    expect(error.message).toBe('Meta CAPI database operation failed');
    expect(error.cause).toBeUndefined();
  });
});
