import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, emailEventSchema, memberTombstone } from '#core/domain/index.js';
import type { VerifiedSesEvent } from '#core/domain/marketing-sns-inbox.js';
import { applyVerifiedSesEvent } from '#core/server/usecases/marketing-email.js';

import { createEmailHmac } from '../crypto/email-hmac.js';
import { repairErasedEmailEvents, lockEmailEventErasure } from './email-event-erasure.js';
import { createMarketingDeliveryTransaction } from './marketing-delivery-transactions.js';
import { createMemberErasureRepository } from './repositories.js';
import { deliveryWebhookCtx } from './marketing-delivery-test-fixture.js';
import { campaignSends, emailEvents, emailOutbox, marketingContacts, members, suppressions, tenants, tenantSesSettings, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-11-01T12:00:00.000Z';
const address = 'private@example.test';
const hmac = createEmailHmac(Buffer.alloc(32, 7).toString('base64'));
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const types = ['delivered', 'bounced', 'complained', 'opened', 'clicked', 'failed', 'uncertain'] as const;
const meta = {
  classification: 'hard', error: 'Private Person <private@example.test>',
  linkUrl: 'https://example.test/news?email=private%40example.test#person',
  rawProviderPayload: { mail: { messageId: 'provider-id', destination: ['PRIVATE%40EXAMPLE.TEST'], commonHeaders: { to: ['Private Person'] } },
    bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'PRIVATE%40EXAMPLE.TEST' }] },
    complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'PRIVATE%40EXAMPLE.TEST' }] },
    click: { ipAddress: '192.0.2.1', userAgent: 'Private client', link: 'https://example.test/?private%40example.test' } },
};

beforeAll(async () => {
  database = await createTestDatabase('together_event_erasure', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres');
}, 60000);
afterAll(async () => { await database?.close(); });

const seed = async (tenantId: string) => {
  const db = database.db;
  await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Example', createdAt: now });
  await db.insert(user).values({ id: `${tenantId}-user`, email: `${tenantId}@example.test`, name: 'Private Person' });
  await db.insert(members).values({ id: `${tenantId}-member`, tenantId, userId: `${tenantId}-user`, email: address, createdAt: now });
  await db.insert(tenantSesSettings).values({ tenantId, fromAddress: 'sender@example.test', fromName: 'Example', identity: 'example.test', webhookToken: `${tenantId}-webhook-token-123456`, snsTopicArn: 'topic', trackingEnabled: true });
  await db.insert(campaignSends).values({ id: `${tenantId}-send`, tenantId, memberId: `${tenantId}-member`, source: 'api', email: address, subject: 'News', status: 'sent', sesMessageId: `${tenantId}-marketing`, sentAt: now, createdAt: now });
  await db.insert(emailOutbox).values({ id: `${tenantId}-outbox`, tenantId, kind: 'verify-email', to: address, payload: { kind: 'verify-email', language: 'en', actionUrl: 'https://example.test/verify' }, status: 'sent', sesMessageId: `${tenantId}-transactional`, nextAttemptAt: now, createdAt: now });
  for (const mailKind of ['marketing', 'transactional'] as const) {
    for (const type of types) await db.insert(emailEvents).values(emailEventSchema.parse({
      id: `${tenantId}-${mailKind}-${type}`, tenantId, mailKind, refId: `${tenantId}-${mailKind === 'marketing' ? 'send' : 'outbox'}`,
      type, meta, occurredAt: now, createdAt: now,
    }));
  }
};
const erase = (tenantId: string) => {
  const memberId = `${tenantId}-member`;
  const tombstone = memberTombstone(memberId);
  return createMemberErasureRepository(database.db, hmac).pseudonymize(tenantId, {
    memberId, deletedAt: now, tombstoneEmail: tombstone.email, severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
  });
};
const rows = (tenantId: string) => database.db.select().from(emailEvents).where(eq(emailEvents.tenantId, tenantId));
const assertScrubbed = (events: Array<typeof emailEvents.$inferSelect>) => {
  expect(events.length).toBeGreaterThan(0);
  const serialized = JSON.stringify(events.map((event) => event.meta));
  for (const value of ['private', 'PRIVATE', 'Private', '192.0.2.1', 'userAgent', 'commonHeaders', 'emailAddress', '?', '#']) expect(serialized).not.toContain(value);
  for (const row of events) expect(emailEventSchema.safeParse({ ...row, occurredAt: new Date(row.occurredAt).toISOString(), createdAt: new Date(row.createdAt).toISOString() }).success).toBe(true);
};
const feedback = (tenantId: string, mailKind: 'marketing' | 'transactional', kind: VerifiedSesEvent['kind']): VerifiedSesEvent => {
  const base = { topicArn: 'topic', messageId: `${tenantId}-${mailKind}`, occurredAt: now, raw: meta.rawProviderPayload, recipient: address };
  if (kind === 'bounce') return { ...base, kind, bounceType: 'Permanent', bounceSubType: 'General', status: '5.1.1', diagnosticCode: null, action: null };
  if (kind === 'click') return { ...base, kind, linkUrl: meta.linkUrl };
  return { ...base, kind };
};
const apply = (tenantId: string, event: VerifiedSesEvent) => createMarketingDeliveryTransaction(database.db).run(tenantId, (repos) =>
  applyVerifiedSesEvent(deliveryWebhookCtx(tenantId), event, { ...repos, hmac, ids: { nextId: () => crypto.randomUUID() }, clock: { nowIso: () => now } }));

it('scrubs linked provider payloads without a literal address and preserves another tenant', async () => {
  await seed('erased');
  await seed('untouched');
  expect(await erase('erased')).not.toBeNull();
  assertScrubbed(await rows('erased'));
  expect(JSON.stringify(await rows('untouched'))).toContain('Private Person');
  const bounce = (await rows('erased')).find((row) => row.type === 'bounced');
  expect(bounce?.meta).toMatchObject({ classification: 'hard', rawProviderPayload: { bounce: { bounceType: 'Permanent', bounceSubType: 'General' } } });
});

it('keeps late feedback scrubbed for both transports and never writes new personal suppressions', async () => {
  await seed('late');
  await erase('late');
  const count = (await rows('late')).length;
  for (const mailKind of ['marketing', 'transactional'] as const) {
    for (const kind of ['delivery', 'bounce', 'complaint', 'open', 'click'] as const) {
      const result = await apply('late', feedback('late', mailKind, kind));
      expect(result).toEqual({ ok: true, value: { kind: mailKind === 'transactional' && (kind === 'open' || kind === 'click') ? 'awaiting_correlation' : 'applied' } });
    }
  }
  const events = await rows('late');
  expect(events).toHaveLength(count + 8);
  assertScrubbed(events);
  expect(await database.db.select().from(suppressions).where(eq(suppressions.tenantId, 'late')))
    .toMatchObject([{ reason: 'erasure', email: null }]);
});

it('scrubs feedback for an address tombstone even without a deleted-member marker', async () => {
  await seed('tombstone');
  await database.db.insert(suppressions).values({
    id: 'address-tombstone', tenantId: 'tombstone', email: null,
    emailHmac: hmac.compute('tombstone', address), reason: 'erasure', createdAt: now,
  });
  const existing = new Set((await rows('tombstone')).map((row) => row.id));
  for (const mailKind of ['marketing', 'transactional'] as const) {
    expect(await apply('tombstone', feedback('tombstone', mailKind, 'complaint')))
      .toEqual({ ok: true, value: { kind: 'applied' } });
  }
  assertScrubbed((await rows('tombstone')).filter((row) => !existing.has(row.id)));
  const preview = await repairErasedEmailEvents(database.db, 'tombstone', hmac, false);
  expect(preview.changed).toEqual(Object.fromEntries(types.map((type) => [type, 2])));
});

it('recognizes a deleted transactional recipient independent of address casing', async () => {
  await seed('deleted-marker');
  await database.db.update(members).set({ deletedAt: now, email: ' PRIVATE@EXAMPLE.TEST ' })
    .where(eq(members.id, 'deleted-marker-member'));
  const existing = new Set((await rows('deleted-marker')).map((row) => row.id));
  expect(await apply('deleted-marker', feedback('deleted-marker', 'transactional', 'delivery')))
    .toEqual({ ok: true, value: { kind: 'applied' } });
  assertScrubbed((await rows('deleted-marker')).filter((row) => !existing.has(row.id)));
});

it('repairs historical metadata by retained HMACs, defaults to no writes and is idempotent and tenant scoped', async () => {
  await seed('history');
  await erase('history');
  await database.db.update(emailEvents).set({ meta }).where(eq(emailEvents.tenantId, 'history'));
  const before = await rows('history');
  const preview = await repairErasedEmailEvents(database.db, 'history', hmac, false);
  expect(preview.matched).toEqual(Object.fromEntries(types.map((type) => [type, 2])));
  expect(preview.changed).toEqual(preview.matched);
  expect(await rows('history')).toEqual(before);
  expect(await repairErasedEmailEvents(database.db, 'history', hmac, true)).toEqual(preview);
  assertScrubbed(await rows('history'));
  expect((await repairErasedEmailEvents(database.db, 'history', hmac, true)).changed).toEqual({});
  expect(JSON.stringify(await rows('untouched'))).toContain('Private Person');
});

it('serializes a concurrent erasure with feedback, including a pre-existing hard bounce suppression', async () => {
  await seed('race');
  await database.db.insert(suppressions).values({ id: 'race-bounce', tenantId: 'race', email: address, emailHmac: hmac.compute('race', address), reason: 'hard_bounce', createdAt: now });
  let unlock: (() => void) | undefined;
  let locked: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { locked = resolve; });
  const release = new Promise<void>((resolve) => { unlock = resolve; });
  const gate = database.db.transaction(async (tx) => {
    await lockEmailEventErasure(tx, 'race');
    locked?.();
    await release;
  });
  await held;
  const erasure = erase('race');
  const receipt = apply('race', feedback('race', 'transactional', 'complaint'));
  unlock?.();
  await Promise.all([gate, erasure, receipt]);
  assertScrubbed(await rows('race'));
  const late = await apply('race', feedback('race', 'transactional', 'bounce'));
  expect(late.ok).toBe(true);
  assertScrubbed(await rows('race'));
});

it.each(['member', 'address'] as const)('follows the contact %s linkage before and after erasure', async (linkage) => {
  const tenantId = `contact-${linkage}`;
  await seed(tenantId);
  await database.db.insert(marketingContacts).values({
    id: `${tenantId}-contact`, tenantId, email: address, emailHmac: hmac.compute(tenantId, address),
    memberId: linkage === 'member' ? `${tenantId}-member` : null, createdAt: now, updatedAt: now,
  });
  await database.db.update(campaignSends).set({
    memberId: null, contactId: `${tenantId}-contact`, email: 'previous@example.test',
  }).where(eq(campaignSends.id, `${tenantId}-send`));
  await erase(tenantId);
  assertScrubbed(await rows(tenantId));
  expect(await apply(tenantId, { ...feedback(tenantId, 'marketing', 'delivery'), recipient: 'previous@example.test' }))
    .toEqual({ ok: true, value: { kind: 'applied' } });
  assertScrubbed(await rows(tenantId));
  await database.db.update(emailEvents).set({ meta }).where(eq(emailEvents.tenantId, tenantId));
  expect((await repairErasedEmailEvents(database.db, tenantId, hmac, true)).matched.delivered).toBe(3);
  assertScrubbed(await rows(tenantId));
});

it('scrubs send linkage even when its email differs from the erased member address', async () => {
  await seed('changed-address');
  await database.db.update(campaignSends).set({ email: 'previous@example.test' }).where(eq(campaignSends.id, 'changed-address-send'));
  await erase('changed-address');
  const event = { ...feedback('changed-address', 'marketing', 'delivery'), recipient: 'previous@example.test' };
  expect(await apply('changed-address', event)).toEqual({ ok: true, value: { kind: 'applied' } });
  assertScrubbed(await rows('changed-address'));
});
