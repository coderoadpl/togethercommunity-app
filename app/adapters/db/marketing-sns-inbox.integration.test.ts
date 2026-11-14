import { createSignedSnsNotification } from '../crypto/sns-test-fixture.js';
import { marketingSnsJsonValue } from '#core/domain/marketing-sns-inbox.js';
import type { MarketingDeliveryTransaction } from '#core/server/marketing-delivery-ports.js';
import { createContentHash } from '../crypto/content-hash.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendMarketingMessages } from '#core/server/usecases/marketing-email.js';
import { dispatchMarketingOutbox } from '#core/server/usecases/marketing-dispatch.js';
import { listMarketingSnsInbox, processMarketingSnsInbox, recordVerifiedMarketingSnsEnvelope, retryMarketingSnsInbox } from '#core/server/usecases/marketing-sns-inbox.js';

import { repairErasedEmailEvents } from './email-event-erasure.js';
import { createDeliveryFixture, deliveryCtx, deliveryWebhookCtx, deliveryWorkerCtx, DELIVERY_NOW } from './marketing-delivery-test-fixture.js';
import { campaignSends, emailEvents, marketingSnsInbox, suppressions } from './schema.js';

let fixture: Awaited<ReturnType<typeof createDeliveryFixture>> | undefined;
afterEach(async () => { await fixture?.close(); });
const receipt = (id: string, type = 'Delivery') => {
  const message = JSON.stringify({ eventType: type, mail: { messageId: 'ses-1' }, delivery: { timestamp: DELIVERY_NOW }, complaint: { timestamp: DELIVERY_NOW } });
  const envelope = { messageId: id, timestamp: DELIVERY_NOW, topicArn: 'topic-a', type: 'Notification' as const, message, subscribeUrl: null };
  const rawBody = JSON.stringify({ Message: message });
  return { envelope, rawBody, bodySha256: createContentHash().sha256(rawBody) };
};
const worker = { workerId: 'worker', deadlineAt: '2026-09-09T10:00:50.000Z', maxEvents: 10 };

describe('durable SNS inbox', () => {
  it('retains canonical verified content, deduplicates receipt IDs, and rejects conflicting content or tenants', async () => {
    fixture = await createDeliveryFixture();
    const input = receipt('sns-1');
    expect((await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), input, fixture.deps)).ok).toBe(true);
    expect((await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), input, fixture.deps)).ok).toBe(true);
    expect((await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), receipt('sns-1', 'Complaint'), fixture.deps)).ok).toBe(false);
    expect((await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx('delivery-b'), input, fixture.deps)).ok).toBe(false);
    const rows = await fixture.db.select().from(marketingSnsInbox);
    expect(rows).toHaveLength(1);
    expect(marketingSnsJsonValue(rows[0]?.rawBody ?? '')).toEqual({ Type: input.envelope.type, MessageId: input.envelope.messageId,
      TopicArn: input.envelope.topicArn, Timestamp: input.envelope.timestamp, Message: input.envelope.message });
  }, 60000);

  it.each((['ingestion', 'pending', 'retry', 'dead_letter'] as const).flatMap((stage) =>
    [null, { recipient: 'unrelated@example.test' }].map((subscribeUrl) => ({ stage, subscribeUrl }))))('ignores unsigned fields in signed envelopes through $stage with SubscribeURL=$subscribeUrl', async ({ stage, subscribeUrl }) => {
    fixture = await createDeliveryFixture();
    for (const to of ['signed@example.test', 'unrelated@example.test']) {
      await fixture.consent(to);
      await sendMarketingMessages(deliveryCtx(), [{ to, memberId: null, campaignId: null, source: 'api',
        consentDefinitionId: 'consent', subject: 'News', bodyHtml: '<p>News</p>', data: {} }], fixture.deps);
    }
    await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'sender', deadlineAt: worker.deadlineAt, maxSends: 10 }, fixture.deps);
    const sends = await fixture.db.select().from(campaignSends);
    const signedSend = sends.find((send) => send.email === 'signed@example.test');
    const unrelated = sends.find((send) => send.email === 'unrelated@example.test');
    if (signedSend === undefined || unrelated === undefined) throw new Error('Missing sends');
    const message = JSON.stringify({ eventType: 'Delivery', mail: { messageId: signedSend.sesMessageId },
      delivery: { timestamp: DELIVERY_NOW, recipients: ['signed@example.test'] } });
    const signed = createSignedSnsNotification({ message, messageId: 'signed-notification', timestamp: DELIVERY_NOW, topicArn: 'topic-a' });
    const rawBody = JSON.stringify({ ...signed.envelope, SubscribeURL: subscribeUrl,
      serverScrubbed: true, correlations: [{ messageId: unrelated.sesMessageId, campaignSendId: unrelated.id, recipients: ['unrelated@example.test'] }],
      erasedSesEvents: ['delivery', 'bounce', 'complaint'].map((kind) => ({ kind, messageId: unrelated.sesMessageId,
        campaignSendId: unrelated.id, occurredAt: DELIVERY_NOW, classification: 'hard', raw: {} })),
    });
    const verified = await signed.verifier.verify({ rawBody, headers: {}, region: 'eu-central-1' });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error('Expected a valid signature');
    if (stage === 'ingestion') {
      expect((await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), { envelope: verified.value }, fixture.deps)).ok).toBe(true);
      const genuine = await signed.verifier.verify({ rawBody: JSON.stringify(signed.envelope), headers: {}, region: 'eu-central-1' });
      if (!genuine.ok) throw new Error('Expected a valid signature');
      expect((await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), { envelope: genuine.value }, fixture.deps)).ok).toBe(true);
      const stored = (await fixture.deps.snsInbox.list('delivery-a'))[0];
      expect(stored?.rawBody).not.toContain('erasedSesEvents');
      expect(stored?.rawBody).not.toContain('serverScrubbed');
      expect(stored?.bodySha256).toBe(createContentHash().sha256(stored?.rawBody ?? ''));
    } else {
      expect((await fixture.deps.snsInbox.record('delivery-a', {
        id: 'verbatim-receipt', tenantId: 'delivery-a', topicArn: 'topic-a', snsMessageId: verified.value.messageId,
        messageType: 'Notification', rawBody, bodySha256: createContentHash().sha256(rawBody),
        verifiedAt: DELIVERY_NOW, receivedAt: DELIVERY_NOW, status: stage, attempts: 0, nextAttemptAt: DELIVERY_NOW,
        lockedBy: null, lockedUntil: null, claimVersion: 0, processedAt: null, lastError: null, ignoreReason: null,
      })).ok).toBe(true);
      expect((await fixture.deps.snsInbox.list('delivery-a'))[0]?.rawBody).toBe(rawBody);
      if (stage !== 'pending') expect((await retryMarketingSnsInbox(deliveryCtx(), { inboxId: 'verbatim-receipt' }, fixture.deps)).ok).toBe(true);
    }
    expect(await processMarketingSnsInbox(deliveryWebhookCtx(), worker, fixture.deps)).toEqual({ ok: true, value: { processed: 1, retried: 0 } });
    const updated = await fixture.db.select().from(campaignSends);
    expect(updated.find((send) => send.id === signedSend.id)?.deliveryStatus).toBe('delivered');
    expect(updated.find((send) => send.id === unrelated.id)).toEqual(unrelated);
    const feedback = (await fixture.db.select().from(emailEvents)).filter((event) => ['delivered', 'bounced', 'complained'].includes(event.type));
    expect(feedback).toMatchObject([{ refId: signedSend.id, type: 'delivered' }]);
    expect(await fixture.db.select().from(suppressions)).toEqual([]);
  }, 60000);

  it.each([false, true])('accepts authentic redelivery of a legacy raw-body digest with unsigned extensions=%s', async (extensions) => {
    fixture = await createDeliveryFixture();
    const input = receipt('legacy-duplicate');
    const signed = createSignedSnsNotification(input.envelope);
    const rawBody = JSON.stringify({ ...signed.envelope,
      ...(extensions ? { SubscribeURL: { recipient: 'unrelated@example.test' }, serverScrubbed: true, erasedSesEvents: null } : {}),
    }, null, 2);
    await fixture.db.insert(marketingSnsInbox).values({
      id: 'legacy-receipt', tenantId: 'delivery-a', topicArn: 'topic-a', snsMessageId: input.envelope.messageId,
      messageType: 'Notification', rawBody, bodySha256: createContentHash().sha256(rawBody),
      verifiedAt: DELIVERY_NOW, receivedAt: DELIVERY_NOW, status: 'pending', nextAttemptAt: DELIVERY_NOW,
    });
    for (const body of [JSON.stringify(signed.envelope), rawBody]) {
      const verified = await signed.verifier.verify({ rawBody: body, headers: {}, region: 'eu-central-1' });
      if (!verified.ok) throw new Error('Expected a valid signature');
      expect(await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), { envelope: verified.value }, fixture.deps))
        .toMatchObject({ ok: true, value: { id: 'legacy-receipt', rawBody } });
    }
    const changed = createSignedSnsNotification({ ...input.envelope, message: receipt('legacy-duplicate', 'Complaint').envelope.message });
    const verified = await changed.verifier.verify({ rawBody: JSON.stringify(changed.envelope), headers: {}, region: 'eu-central-1' });
    if (!verified.ok) throw new Error('Expected a valid signature');
    expect(await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), { envelope: verified.value }, fixture.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await fixture.db.select().from(marketingSnsInbox)).toHaveLength(1);
  }, 60000);

  it('accepts authentic redelivery of a legacy receipt whose raw body was purged', async () => {
    fixture = await createDeliveryFixture();
    const input = receipt('legacy-purged');
    const signed = createSignedSnsNotification(input.envelope);
    const legacyBody = JSON.stringify(signed.envelope, null, 2);
    await fixture.db.insert(marketingSnsInbox).values({
      id: 'legacy-purged', tenantId: 'delivery-a', topicArn: 'topic-a', snsMessageId: input.envelope.messageId,
      messageType: 'Notification', rawBody: null, bodySha256: createContentHash().sha256(legacyBody),
      verifiedAt: DELIVERY_NOW, receivedAt: DELIVERY_NOW, status: 'processed', nextAttemptAt: DELIVERY_NOW, processedAt: DELIVERY_NOW,
    });
    const verified = await signed.verifier.verify({ rawBody: JSON.stringify(signed.envelope), headers: {}, region: 'eu-central-1' });
    if (!verified.ok) throw new Error('Expected a valid signature');
    expect(await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), { envelope: verified.value }, fixture.deps))
      .toMatchObject({ ok: true, value: { id: 'legacy-purged', status: 'processed', rawBody: null } });
    expect(await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx('delivery-b'), { envelope: verified.value }, fixture.deps)).toMatchObject({ ok: false });
    expect(await fixture.db.select().from(marketingSnsInbox)).toHaveLength(1);
  }, 60000);

  it('keeps a body canonicalised by erasure after a worker claimed the legacy receipt', async () => {
    fixture = await createDeliveryFixture();
    const input = receipt('legacy-claimed');
    const signed = createSignedSnsNotification(input.envelope);
    const rawBody = JSON.stringify({ ...signed.envelope, SubscribeURL: { recipient: 'unrelated@example.test' } }, null, 2);
    await fixture.db.insert(marketingSnsInbox).values({
      id: 'legacy-claimed', tenantId: 'delivery-a', topicArn: 'topic-a', snsMessageId: input.envelope.messageId,
      messageType: 'Notification', rawBody, bodySha256: createContentHash().sha256(rawBody),
      verifiedAt: DELIVERY_NOW, receivedAt: DELIVERY_NOW, status: 'pending', nextAttemptAt: DELIVERY_NOW,
    });
    const claimed = await fixture.deps.snsInbox.claim('delivery-a', { workerId: 'worker', now: DELIVERY_NOW, lockedUntil: worker.deadlineAt });
    if (claimed === null) throw new Error('Expected a claimed receipt');
    expect((await repairErasedEmailEvents(fixture.db, 'delivery-a', fixture.deps.hmac, true)).inbox).toEqual({ matched: 1, changed: 1 });
    const [canonical] = await fixture.db.select().from(marketingSnsInbox);
    expect(canonical?.rawBody).not.toBe(rawBody);

    expect(await fixture.deps.snsInbox.save('delivery-a', { ...claimed, status: 'processed', processedAt: DELIVERY_NOW, lockedBy: null, lockedUntil: null })).toBe(true);
    const [stored] = await fixture.db.select().from(marketingSnsInbox);
    expect(stored).toMatchObject({ status: 'processed', rawBody: canonical?.rawBody, bodySha256: canonical?.bodySha256 });
    expect(stored?.rawBody).not.toContain('unrelated@example.test');
  }, 60000);

  it('retries callback-before-correlation and applies duplicate delivery exactly once', async () => {
    fixture = await createDeliveryFixture();
    const input = receipt('sns-1');
    await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), input, fixture.deps);
    expect((await processMarketingSnsInbox(deliveryWebhookCtx(), worker, fixture.deps))).toEqual({ ok: true, value: { processed: 0, retried: 1 } });
    await fixture.consent('member@example.test');
    await sendMarketingMessages(deliveryCtx(), [{ to: 'member@example.test', memberId: null, campaignId: null, source: 'api', consentDefinitionId: 'consent', subject: 'News', bodyHtml: '<p>News</p>', data: {} }], fixture.deps);
    await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'sender', deadlineAt: worker.deadlineAt, maxSends: 10 }, fixture.deps);
    const stored = (await fixture.deps.snsInbox.list('delivery-a'))[0];
    if (stored === undefined) throw new Error('Missing receipt');
    expect((await retryMarketingSnsInbox(deliveryCtx(), { inboxId: stored.id }, fixture.deps)).ok).toBe(true);
    expect((await processMarketingSnsInbox(deliveryWebhookCtx(), worker, fixture.deps))).toEqual({ ok: true, value: { processed: 1, retried: 0 } });
    await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), input, fixture.deps);
    await processMarketingSnsInbox(deliveryWebhookCtx(), worker, fixture.deps);
    expect((await fixture.db.select().from(emailEvents)).filter((event) => event.type === 'delivered')).toHaveLength(1);
    await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), receipt('sns-2', 'Complaint'), fixture.deps);
    await processMarketingSnsInbox(deliveryWebhookCtx(), worker, fixture.deps);
    await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), receipt('sns-3'), fixture.deps);
    await processMarketingSnsInbox(deliveryWebhookCtx(), worker, fixture.deps);
    expect((await fixture.db.select().from(campaignSends))[0]?.deliveryStatus).toBe('complained');
  }, 60000);

  it('lists only the authorized tenant receipts without exposing raw payloads', async () => {
    fixture = await createDeliveryFixture();
    await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), receipt('sns-1'), fixture.deps);
    const listed = await listMarketingSnsInbox(deliveryCtx(), fixture.deps);
    expect(listed).toMatchObject({ ok: true, value: { receipts: [{ snsMessageId: 'sns-1' }] } });
    if (!listed.ok) throw new Error('Expected authorized diagnostics');
    expect(listed.value.receipts[0]).not.toHaveProperty('rawBody');
    expect(await listMarketingSnsInbox(deliveryCtx('delivery-b'), fixture.deps)).toEqual({ ok: true, value: { receipts: [] } });
    expect(await listMarketingSnsInbox(deliveryWebhookCtx(), fixture.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  }, 60000);

  it('verifies the simulator feedback path once and leaves later quota snapshots untouched', async () => {
    fixture = await createDeliveryFixture();
    const settings = await fixture.deps.sesSettings.findByTenant('delivery-a');
    if (settings === null) throw new Error('Missing settings');
    await fixture.deps.sesSettings.upsert('delivery-a', { ...settings, webhookVerifiedAt: null });
    const upsert = vi.fn();
    const delivery = fixture.deps.delivery;
    const observedDelivery: MarketingDeliveryTransaction = { run: (tenantId, operation) => delivery.run(tenantId,
      (repos) => operation({ ...repos, sesSettings: { ...repos.sesSettings, upsert: async (id, value) => {
        upsert(id, value);
        return repos.sesSettings.upsert(id, value);
      } } })) };
    const deps = { ...fixture.deps, delivery: observedDelivery };
    const recordProbe = async (id: string) => {
      const input = receipt(id);
      const message = JSON.stringify({ eventType: 'Bounce', mail: { messageId: id }, bounce: {
        bounceType: 'Permanent', timestamp: DELIVERY_NOW, bouncedRecipients: [{ emailAddress: 'bounce@simulator.amazonses.com' }],
      } });
      await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), { envelope: { ...input.envelope, message } }, deps);
    };
    await recordProbe('probe-1');
    expect((await processMarketingSnsInbox(deliveryWebhookCtx(), worker, deps)).ok).toBe(true);
    expect(await fixture.deps.sesSettings.findByTenant('delivery-a')).toMatchObject({ webhookVerifiedAt: DELIVERY_NOW });
    await fixture.deps.sesSettings.upsert('delivery-a', { ...settings, quotaDaily: 20000, quotaSentLast24Hours: 3000 });
    await recordProbe('probe-2');
    expect((await processMarketingSnsInbox(deliveryWebhookCtx(), worker, deps)).ok).toBe(true);
    expect(upsert.mock.calls).toHaveLength(1);
    expect(await fixture.deps.sesSettings.findByTenant('delivery-a')).toMatchObject({ webhookVerifiedAt: DELIVERY_NOW, quotaDaily: 20000, quotaSentLast24Hours: 3000 });
  }, 60000);

  it('propagates receipt database failures and keeps subscription failures retryable', async () => {
    fixture = await createDeliveryFixture();
    const delivery = fixture.deps.delivery;
    await expect(recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), receipt('sns-1'), { ...fixture.deps, delivery: { run: (tenantId, operation) => delivery.run(tenantId, (repos) => operation({ ...repos, snsInbox: { ...repos.snsInbox, record: async () => { throw new Error('database unavailable'); } } })) } })).rejects.toThrow('database unavailable');
    const input = receipt('confirmation');
    await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), { ...input, envelope: { ...input.envelope, type: 'SubscriptionConfirmation', subscribeUrl: 'https://sns.eu-central-1.amazonaws.com/confirm' } }, fixture.deps);
    await processMarketingSnsInbox(deliveryWebhookCtx(), worker, { ...fixture.deps, sns: { ...fixture.deps.sns, confirmSubscription: async () => { throw new Error('network unavailable'); } } });
    expect((await fixture.deps.snsInbox.list('delivery-a'))[0]?.status).toBe('retry');
  }, 60000);

  it('rolls back partial feedback application and reports a retryable worker failure', async () => {
    fixture = await createDeliveryFixture();
    await fixture.consent('member@example.test');
    await sendMarketingMessages(deliveryCtx(), [{ to: 'member@example.test', memberId: null, campaignId: null, source: 'api', consentDefinitionId: 'consent', subject: 'News', bodyHtml: '<p>News</p>', data: {} }], fixture.deps);
    await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'sender', deadlineAt: worker.deadlineAt, maxSends: 10 }, fixture.deps);
    await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), receipt('complaint', 'Complaint'), fixture.deps);
    const delivery = fixture.deps.delivery;
    const result = await processMarketingSnsInbox(deliveryWebhookCtx(), worker, { ...fixture.deps,
      delivery: { run: (tenantId, operation) => delivery.run(tenantId, (repos) => operation({ ...repos, suppressions: { ...repos.suppressions, record: async () => { throw new Error('Suppression storage failed'); } } })) },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect((await fixture.db.select().from(campaignSends))[0]?.deliveryStatus).toBeNull();
    expect((await fixture.db.select().from(emailEvents)).filter((event) => event.type === 'complained')).toHaveLength(0);
    expect((await fixture.deps.snsInbox.list('delivery-a'))[0]?.status).toBe('retry');
  }, 60000);

  it('durably ignores unsupported verified payloads and purges only completed raw bodies', async () => {
    fixture = await createDeliveryFixture();
    const input = receipt('unsupported', 'Unsupported');
    const recorded = await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), input, fixture.deps);
    expect(recorded).toMatchObject({ ok: true, value: { status: 'ignored', ignoreReason: 'Unsupported verified payload' } });
    await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), receipt('pending'), fixture.deps);
    expect(await fixture.deps.snsInbox.purge('delivery-a', '2026-10-10T00:00:00.000Z')).toBe(1);
    const rows = await fixture.deps.snsInbox.list('delivery-a');
    expect(rows.find((row) => row.snsMessageId === 'unsupported')?.rawBody).toBeNull();
    expect(rows.find((row) => row.snsMessageId === 'pending')?.rawBody).not.toBeNull();
  }, 60000);

});
