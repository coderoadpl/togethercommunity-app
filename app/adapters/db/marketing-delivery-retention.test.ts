import { afterEach, expect, it } from 'vitest';

import { sendMarketingMessages } from '#core/server/usecases/marketing-email.js';
import { dispatchMarketingOutbox } from '#core/server/usecases/marketing-dispatch.js';
import { recordVerifiedMarketingSnsEnvelope } from '#core/server/usecases/marketing-sns-inbox.js';

import { createContentHash } from '../crypto/content-hash.js';
import { createDeliveryFixture, deliveryCtx, deliveryWebhookCtx, deliveryWorkerCtx, DELIVERY_NOW } from './marketing-delivery-test-fixture.js';
import { eraseMarketingDeliveryPayloads } from './marketing-delivery-erasure.js';
import { marketingOutbox, marketingSnsInbox, marketingSnsInboxEvents } from './schema.js';

let fixture: Awaited<ReturnType<typeof createDeliveryFixture>> | undefined;
afterEach(async () => { await fixture?.close(); });

it('purges completed payloads after retention without discarding send receipts', async () => {
  fixture = await createDeliveryFixture();
  await fixture.consent('member@example.test');
  await sendMarketingMessages(deliveryCtx(), [{ to: 'member@example.test', memberId: null, campaignId: null, source: 'api', consentDefinitionId: 'consent', subject: 'Updates', bodyHtml: '<p>Updates</p>', data: {} }], fixture.deps);
  await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'worker', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, fixture.deps);
  expect(await fixture.deps.marketingOutbox.purge('delivery-b', '2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z')).toBe(0);
  expect(await fixture.deps.marketingOutbox.purge('delivery-a', '2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z')).toBe(1);
  expect((await fixture.db.select().from(marketingOutbox))[0]).toMatchObject({ payload: null, status: 'sent', sesMessageId: 'ses-1' });
}, 60000);

it('erases queued bodies and recipient-bearing SNS payloads while preserving audited receipts', async () => {
  fixture = await createDeliveryFixture();
  await fixture.consent('member@example.test');
  await sendMarketingMessages(deliveryCtx(), [{ to: 'member@example.test', memberId: null, campaignId: null, source: 'api', consentDefinitionId: 'consent', subject: 'Updates', bodyHtml: '<p>Updates</p>', data: {} }], fixture.deps);
  const message = JSON.stringify({ eventType: 'Delivery', mail: { messageId: 'provider-id' }, delivery: { timestamp: DELIVERY_NOW, recipients: ['member@example.test'] } });
  const rawBody = JSON.stringify({ Message: message });
  await recordVerifiedMarketingSnsEnvelope(deliveryWebhookCtx(), { envelope: { type: 'Notification', topicArn: 'topic-a', messageId: 'sns-id', timestamp: DELIVERY_NOW, message, subscribeUrl: null }, rawBody, bodySha256: createContentHash().sha256(rawBody) }, fixture.deps);
  await fixture.db.transaction((tx) => eraseMarketingDeliveryPayloads(tx, 'delivery-b', { email: 'member@example.test', deletedAt: DELIVERY_NOW }));
  expect((await fixture.db.select().from(marketingOutbox))[0]?.payload).not.toBeNull();
  await fixture.db.transaction((tx) => eraseMarketingDeliveryPayloads(tx, 'delivery-a', { email: 'member@example.test', deletedAt: DELIVERY_NOW }));
  expect((await fixture.db.select().from(marketingOutbox))[0]).toMatchObject({ payload: null, status: 'skipped' });
  expect((await fixture.db.select().from(marketingSnsInbox))[0]).toMatchObject({ rawBody: null, status: 'ignored', ignoreReason: 'Recipient erasure' });
  expect((await fixture.db.select().from(marketingSnsInboxEvents)).map((event) => event.type)).toContain('payload_erased');
  await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'worker', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, fixture.deps);
  expect(fixture.sent).toHaveLength(0);
}, 60000);
