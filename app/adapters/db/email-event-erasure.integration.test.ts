import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, emailEventSchema, memberTombstone, ok } from '#core/domain/index.js';
import { marketingSnsJsonValue, storedSnsEnvelopeSchema, type VerifiedSesEvent } from '#core/domain/marketing-sns-inbox.js';
import { readStoredMarketingSesEvents } from '#core/domain/marketing-sns-erasure.js';
import { processMarketingSnsInbox, recordVerifiedMarketingSnsEnvelope, retryMarketingSnsInbox } from '#core/server/usecases/marketing-sns-inbox.js';
import { applyVerifiedSesEvent } from '#core/server/usecases/marketing-email.js';

import { createSignedSnsNotification } from '../crypto/sns-test-fixture.js';
import { createContentHash } from '../crypto/content-hash.js';
import { createEmailHmac } from '../crypto/email-hmac.js';
import { repairErasedEmailEvents, lockEmailEventErasure } from './email-event-erasure.js';
import { createMarketingDeliveryRepos, createMarketingDeliveryTransaction } from './marketing-delivery-transactions.js';
import { createMemberErasureRepository } from './repositories.js';
import { deliveryCtx, deliveryWebhookCtx } from './marketing-delivery-test-fixture.js';
import { campaignSends, emailEvents, emailOutbox, marketingContacts, marketingOutbox, marketingSnsInbox, members, suppressions, tenants, tenantSesSettings, user } from './schema.js';
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

const inboxDeps = () => ({
  ...createMarketingDeliveryRepos(database.db), hash: createContentHash(), delivery: createMarketingDeliveryTransaction(database.db),
  hmac, ids: { nextId: () => crypto.randomUUID() }, clock: { nowIso: () => now },
  credentials: { resolve: async () => ok({ accessKeyId: 'test', secretAccessKey: 'test', region: 'eu-central-1' }) },
  sns: { verify: async () => { throw new Error('Already verified'); }, confirmSubscription: async () => ok(undefined) },
});
const receipt = (tenantId: string, mailKind: 'marketing' | 'transactional', kind: VerifiedSesEvent['kind']) => {
  const eventType = { delivery: 'Delivery', bounce: 'Bounce', complaint: 'Complaint', open: 'Open', click: 'Click' }[kind];
  const message = JSON.stringify({ eventType,
    mail: { messageId: `${tenantId}-${mailKind}`, destination: [address], commonHeaders: { to: ['Private Person'] },
      ...(mailKind === 'marketing' ? { tags: { 'together-send-id': [`${tenantId}-send`] } } : {}) },
    delivery: { timestamp: now, recipients: [address] },
    bounce: { timestamp: now, bounceType: 'Transient', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: address, status: '5.4.4', diagnosticCode: 'Private Person' }] },
    complaint: { timestamp: now, complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: address }] },
    open: { timestamp: now, ipAddress: '192.0.2.1', userAgent: 'Private client' },
    click: { timestamp: now, ipAddress: '192.0.2.1', userAgent: 'Private client', link: meta.linkUrl },
  });
  const rawBody = JSON.stringify({ Message: message, Subject: 'Private Person' });
  return { rawBody, bodySha256: `${tenantId}-${mailKind}-${kind}`,
    envelope: { type: 'Notification' as const, messageId: `${mailKind}-${kind}`, topicArn: 'topic', timestamp: now, message, subscribeUrl: null } };
};
const inboxRows = (tenantId: string) => database.db.select().from(marketingSnsInbox).where(eq(marketingSnsInbox.tenantId, tenantId));
const assertInboxScrubbed = async (tenantId: string) => {
  const receipts = await inboxRows(tenantId);
  expect(receipts.length).toBeGreaterThan(0);
  const serialized = JSON.stringify(receipts.map((row) => row.rawBody));
  for (const value of ['private', 'PRIVATE', 'Private', '192.0.2.1', 'userAgent', 'commonHeaders', 'emailAddress', '?', '#']) expect(serialized).not.toContain(value);
};
const worker = { workerId: 'worker', deadlineAt: '2026-11-01T12:01:00.000Z', maxEvents: 20 };

it('scrubs late signed receipts at ingestion and through processed, retry and dead-letter saves', async () => {
  const tenantId = 'inbox-late';
  await seed(tenantId);
  await erase(tenantId);
  const deps = inboxDeps();
  for (const mailKind of ['marketing', 'transactional'] as const) {
    for (const kind of ['delivery', 'bounce', 'complaint', 'open', 'click'] as const) {
      expect((await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(tenantId), receipt(tenantId, mailKind, kind), deps)).ok).toBe(true);
    }
  }
  await assertInboxScrubbed(tenantId);
  expect(await processMarketingSnsInbox(deliveryWebhookCtx(tenantId), worker, deps)).toEqual(ok({ processed: 8, retried: 2 }));
  await assertInboxScrubbed(tenantId);
  assertScrubbed(await rows(tenantId));
  const nextDay = '2026-11-02T12:00:00.000Z';
  expect(await processMarketingSnsInbox(deliveryWebhookCtx(tenantId), { ...worker, deadlineAt: '2026-11-02T12:01:00.000Z' },
    { ...deps, clock: { nowIso: () => nextDay } })).toEqual(ok({ processed: 0, retried: 2 }));
  expect((await inboxRows(tenantId)).filter((row) => row.status === 'dead_letter')).toHaveLength(2);
  await assertInboxScrubbed(tenantId);
  expect((await rows(tenantId)).filter((row) => row.type === 'bounced').every((row) => row.meta?.['classification'] === 'hard')).toBe(true);
});

it.each(['processed', 'retry', 'dead_letter'] as const)('does not restore a claimed raw body after concurrent erasure on a %s save', async (status) => {
  const tenantId = `inbox-stale-${status.replace('_', '-')}`;
  await seed(tenantId);
  const deps = inboxDeps();
  const input = receipt(tenantId, status === 'processed' ? 'marketing' : 'transactional', status === 'processed' ? 'delivery' : 'open');
  await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(tenantId), input, deps);
  const time = status === 'dead_letter' ? '2026-11-02T12:00:00.000Z' : now;
  let claimed = false;
  const result = await processMarketingSnsInbox(deliveryWebhookCtx(tenantId), { ...worker, deadlineAt: '2026-11-02T12:01:00.000Z' }, {
    ...deps, clock: { nowIso: () => time }, snsInbox: { ...deps.snsInbox, claim: async (id, lease) => {
      if (claimed) return null;
      claimed = true;
      const row = await deps.snsInbox.claim(id, lease);
      await erase(tenantId);
      return row;
    } },
  });
  expect(result.ok).toBe(true);
  expect((await inboxRows(tenantId))[0]?.status).toBe(status);
  await assertInboxScrubbed(tenantId);
  assertScrubbed(await rows(tenantId));
});

it('scrubs existing inbox receipts during erasure and historical repair, including dead letters', async () => {
  const tenantId = 'inbox-history';
  await seed(tenantId);
  const deps = inboxDeps();
  const input = receipt(tenantId, 'marketing', 'click');
  await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(tenantId), input, deps);
  await database.db.update(marketingSnsInbox).set({ status: 'dead_letter' }).where(eq(marketingSnsInbox.tenantId, tenantId));
  await erase(tenantId);
  await assertInboxScrubbed(tenantId);
  await database.db.update(marketingSnsInbox).set({ rawBody: input.rawBody }).where(eq(marketingSnsInbox.tenantId, tenantId));
  expect((await repairErasedEmailEvents(database.db, tenantId, hmac, false)).inbox).toEqual({ matched: 1, changed: 1 });
  expect((await inboxRows(tenantId))[0]?.rawBody).toBe(input.rawBody);
  expect((await repairErasedEmailEvents(database.db, tenantId, hmac, true)).inbox).toEqual({ matched: 1, changed: 1 });
  await assertInboxScrubbed(tenantId);
  expect((await repairErasedEmailEvents(database.db, tenantId, hmac, true)).inbox).toEqual({ matched: 1, changed: 0 });
});

it.each(['sending', 'uncertain'] as const)('reconciles an erased %s send from a verified tag before provider-id persistence', async (status) => {
  const tenantId = `tag-${status}`;
  await seed(tenantId);
  await erase(tenantId);
  await database.db.update(campaignSends).set({ status: 'sending', sesMessageId: null }).where(eq(campaignSends.id, `${tenantId}-send`));
  await database.db.insert(marketingOutbox).values({ id: `${tenantId}-dispatch`, tenantId, campaignSendId: `${tenantId}-send`,
    status: status === 'sending' ? 'dispatching' : 'uncertain', nextAttemptAt: now, createdAt: now, updatedAt: now });
  expect(await apply(tenantId, { ...feedback(tenantId, 'marketing', 'delivery'), campaignSendId: `${tenantId}-send` }))
    .toEqual(ok({ kind: 'applied' }));
  const [send] = await database.db.select().from(campaignSends).where(eq(campaignSends.id, `${tenantId}-send`));
  expect(send).toMatchObject({ status: 'sent', sesMessageId: `${tenantId}-marketing`, deliveryStatus: 'delivered' });
  const [outbox] = await database.db.select().from(marketingOutbox).where(eq(marketingOutbox.tenantId, tenantId));
  expect(outbox).toMatchObject({ status: 'sent', sesMessageId: `${tenantId}-marketing` });
  assertScrubbed(await rows(tenantId));
  expect(await apply(tenantId, { ...feedback(tenantId, 'marketing', 'delivery'), campaignSendId: `${tenantId}-send`, messageId: 'conflicting' }))
    .toMatchObject({ ok: true, value: { kind: 'ignored' } });
});

it('scrubs destination-only address tombstones before send correlation exists', async () => {
  const tenantId = 'inbox-address';
  await seed(tenantId);
  await database.db.insert(suppressions).values({ id: `${tenantId}-tombstone`, tenantId, email: null,
    emailHmac: hmac.compute(tenantId, address), reason: 'erasure', createdAt: now });
  await database.db.update(campaignSends).set({ sesMessageId: 'other-provider-id' }).where(eq(campaignSends.tenantId, tenantId));
  const input = receipt(tenantId, 'transactional', 'open');
  await database.db.update(emailOutbox).set({ sesMessageId: null }).where(eq(emailOutbox.tenantId, tenantId));
  expect((await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(tenantId), input, inboxDeps())).ok).toBe(true);
  await assertInboxScrubbed(tenantId);
  expect(await processMarketingSnsInbox(deliveryWebhookCtx(tenantId), worker, inboxDeps())).toEqual(ok({ processed: 0, retried: 1 }));
  await assertInboxScrubbed(tenantId);
});

it('retains recipient validation after normalizing an erased send receipt', async () => {
  const tenantId = 'inbox-mismatch';
  await seed(tenantId);
  await erase(tenantId);
  await database.db.update(campaignSends).set({ status: 'sending', sesMessageId: null }).where(eq(campaignSends.tenantId, tenantId));
  const input = receipt(tenantId, 'marketing', 'delivery');
  await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(tenantId), { envelope: { ...input.envelope, message: input.envelope.message.replaceAll(address, 'unrelated@example.test') } }, inboxDeps());
  expect(await processMarketingSnsInbox(deliveryWebhookCtx(tenantId), worker, inboxDeps())).toEqual(ok({ processed: 1, retried: 0 }));
  expect((await inboxRows(tenantId))[0]).toMatchObject({ status: 'ignored', ignoreReason: 'No applicable recipients' });
  const [send] = await database.db.select().from(campaignSends).where(eq(campaignSends.tenantId, tenantId));
  expect(send).toMatchObject({ status: 'sending', sesMessageId: null, deliveryStatus: null });
  await assertInboxScrubbed(tenantId);
});

const sendReceipt = (tenantId: string, linkage: 'message' | 'tag' | 'address') => {
  const message = JSON.stringify({ eventType: 'Send', send: {}, mail: {
    timestamp: now, messageId: linkage === 'message' ? `${tenantId}-marketing` : 'uncorrelated-provider',
    destination: [linkage === 'address' ? address : 'previous@example.test'],
    source: 'sender@example.test', headers: [{ name: 'To', value: 'Private Person <private@example.test>' }],
    commonHeaders: { to: ['Private Person <private@example.test>'], subject: 'Private subject' },
    ...(linkage === 'tag' ? { tags: { 'together-send-id': [`${tenantId}-send`] } } : {}),
  } });
  return { rawBody: JSON.stringify({ Message: message }), bodySha256: `${tenantId}-send-receipt`,
    envelope: { type: 'Notification' as const, messageId: 'send-receipt', topicArn: 'topic', timestamp: now, message, subscribeUrl: null } };
};
const assertSendReceiptScrubbed = async (tenantId: string) => {
  await assertInboxScrubbed(tenantId);
  const [row] = await inboxRows(tenantId);
  expect(row?.status).toBe('ignored');
  expect(row?.rawBody).not.toContain('@');
  expect(row?.rawBody).not.toContain('headers');
  const envelope = storedSnsEnvelopeSchema.parse(marketingSnsJsonValue(row?.rawBody?.slice('together-scrubbed:v1:'.length) ?? ''));
  expect(marketingSnsJsonValue(envelope.Message)).toMatchObject({ eventType: 'Send', mail: { timestamp: now } });
  expect(readStoredMarketingSesEvents(row?.rawBody ?? null, 'topic')).toEqual([]);
};

it.each(['message', 'tag', 'address'] as const)('scrubs ignored Send receipts arriving after erasure through %s correlation', async (linkage) => {
  const tenantId = `send-late-${linkage}`;
  await seed(tenantId);
  await erase(tenantId);
  const result = await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(tenantId), sendReceipt(tenantId, linkage), inboxDeps());
  expect(result).toMatchObject({ ok: true, value: { status: 'ignored', ignoreReason: 'Unsupported verified payload' } });
  await assertSendReceiptScrubbed(tenantId);
});

it.each(['message', 'tag', 'address'] as const)('scrubs historical ignored Send receipts during erasure and repair through %s correlation', async (linkage) => {
  const tenantId = `send-history-${linkage}`;
  await seed(tenantId);
  const input = sendReceipt(tenantId, linkage);
  await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(tenantId), input, inboxDeps());
  expect((await inboxRows(tenantId))[0]?.rawBody).toContain('Private Person');
  await erase(tenantId);
  await assertSendReceiptScrubbed(tenantId);
  await database.db.update(marketingSnsInbox).set({ rawBody: input.rawBody }).where(eq(marketingSnsInbox.tenantId, tenantId));
  expect((await repairErasedEmailEvents(database.db, tenantId, hmac, false)).inbox).toEqual({ matched: 1, changed: 1 });
  expect((await inboxRows(tenantId))[0]?.rawBody).toBe(input.rawBody);
  expect((await repairErasedEmailEvents(database.db, tenantId, hmac, true)).inbox).toEqual({ matched: 1, changed: 1 });
  await assertSendReceiptScrubbed(tenantId);
  expect((await repairErasedEmailEvents(database.db, tenantId, hmac, true)).inbox.changed).toBe(0);
});
it.each((['process', 'retry', 'replay', 'erase', 'repair'] as const).flatMap((stage) =>
  [null, { recipient: 'other@example.test' }].map((subscribeUrl) => ({ stage, subscribeUrl }))))('ignores unsigned fields during $stage and scrubs the signed payload with SubscribeURL=$subscribeUrl', async ({ stage, subscribeUrl }) => {
  const tenantId = `verbatim-${stage}-${subscribeUrl === null ? 'null' : 'object'}`;
  await seed(tenantId);
  await database.db.insert(campaignSends).values({ id: `${tenantId}-unrelated`, tenantId, source: 'api', email: 'other@example.test',
    subject: 'Other news', status: 'sent', sesMessageId: `${tenantId}-other-provider`, sentAt: now, createdAt: now });
  const [unrelated] = await database.db.select().from(campaignSends).where(eq(campaignSends.id, `${tenantId}-unrelated`));
  if (unrelated === undefined) throw new Error('Missing unrelated send');
  if (stage !== 'erase') await erase(tenantId);
  const deps = inboxDeps();
  const input = receipt(tenantId, stage === 'retry' ? 'transactional' : 'marketing', stage === 'retry' ? 'open' : 'delivery');
  const signed = createSignedSnsNotification(input.envelope);
  const rawBody = JSON.stringify({ ...signed.envelope, SubscribeURL: subscribeUrl, serverScrubbed: true,
    correlations: [{ messageId: unrelated.sesMessageId, campaignSendId: unrelated.id, recipients: ['other@example.test'] }],
    erasedSesEvents: ['bounce', 'complaint'].map((kind) => ({ kind, messageId: unrelated.sesMessageId,
      campaignSendId: unrelated.id, occurredAt: now, classification: 'hard', raw: {} })),
  });
  expect((await signed.verifier.verify({ rawBody, headers: {}, region: 'eu-central-1' })).ok).toBe(true);
  const id = `${tenantId}-receipt`;
  expect((await deps.snsInbox.record(tenantId, {
    id, tenantId, topicArn: 'topic', snsMessageId: input.envelope.messageId, messageType: 'Notification',
    rawBody, bodySha256: createContentHash().sha256(rawBody), verifiedAt: now, receivedAt: now,
    status: stage === 'process' || stage === 'retry' ? 'pending' : 'dead_letter', attempts: 0, nextAttemptAt: now,
    lockedBy: null, lockedUntil: null, claimVersion: 0, processedAt: null, lastError: null, ignoreReason: null,
  })).ok).toBe(true);
  expect((await inboxRows(tenantId))[0]?.rawBody).toBe(rawBody);
  if (stage === 'erase') {
    await erase(tenantId);
    await assertInboxScrubbed(tenantId);
  }
  if (stage === 'repair') {
    expect((await repairErasedEmailEvents(database.db, tenantId, hmac, false)).inbox).toEqual({ matched: 1, changed: 1 });
    expect((await inboxRows(tenantId))[0]?.rawBody).toBe(rawBody);
    expect((await repairErasedEmailEvents(database.db, tenantId, hmac, true)).inbox).toEqual({ matched: 1, changed: 1 });
    await assertInboxScrubbed(tenantId);
    expect((await repairErasedEmailEvents(database.db, tenantId, hmac, true)).inbox).toEqual({ matched: 1, changed: 0 });
  }
  if (stage !== 'process' && stage !== 'retry') {
    expect((await retryMarketingSnsInbox(deliveryCtx(tenantId), { inboxId: id }, deps)).ok).toBe(true);
  }
  const existing = new Set((await rows(tenantId)).map((row) => row.id));
  expect(await processMarketingSnsInbox(deliveryWebhookCtx(tenantId), worker, deps))
    .toEqual(ok(stage === 'retry' ? { processed: 0, retried: 1 } : { processed: 1, retried: 0 }));
  await assertInboxScrubbed(tenantId);
  const [stored] = await inboxRows(tenantId);
  expect(stored?.rawBody).toMatch(/^together-scrubbed:v1:/);
  expect(stored?.rawBody).not.toContain(unrelated.id);
  expect(readStoredMarketingSesEvents(stored?.rawBody ?? null, 'topic'))
    .toMatchObject([{ kind: stage === 'retry' ? 'open' : 'delivery', messageId: `${tenantId}-${stage === 'retry' ? 'transactional' : 'marketing'}` }]);
  const added = (await rows(tenantId)).filter((row) => !existing.has(row.id));
  if (stage === 'retry') expect(added).toEqual([]);
  else expect(added).toMatchObject([{ refId: `${tenantId}-send`, type: 'delivered' }]);
  assertScrubbed(await rows(tenantId));
  expect(await database.db.select().from(campaignSends).where(eq(campaignSends.id, unrelated.id))).toEqual([unrelated]);
  expect(await database.db.select().from(suppressions).where(eq(suppressions.tenantId, tenantId)))
    .toMatchObject([{ reason: 'erasure', email: null }]);
});

it.each(['object', 'null', 'malformed'] as const)('does not erase an unrelated Notification from unsigned top-level data with %s SubscribeURL', async (variant) => {
  const tenantId = `unsigned-address-${variant}`;
  await seed(tenantId);
  const rawBody = JSON.stringify({ Type: 'Notification', SubscribeURL: variant === 'null' ? null : { recipient: address },
    ...(variant === 'null' ? { unsignedRecipient: address } : {}),
    Message: variant === 'malformed' ? null : JSON.stringify({ eventType: 'Delivery',
      mail: { messageId: 'unrelated-provider', destination: ['other@example.test'] },
      delivery: { timestamp: now, recipients: ['other@example.test'] } }),
  });
  await database.db.insert(marketingSnsInbox).values({
    id: `${tenantId}-receipt`, tenantId, topicArn: 'topic', snsMessageId: 'unrelated-notification', messageType: 'Notification',
    rawBody, bodySha256: createContentHash().sha256(rawBody), verifiedAt: now, receivedAt: now, status: 'pending', nextAttemptAt: now,
  });
  const before = await inboxRows(tenantId);
  await erase(tenantId);
  expect(await inboxRows(tenantId)).toEqual(before);
  expect((await repairErasedEmailEvents(database.db, tenantId, hmac, true)).inbox).toEqual({ matched: 0, changed: 0 });
  expect(await inboxRows(tenantId)).toEqual(before);
});
