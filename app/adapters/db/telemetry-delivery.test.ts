import { afterEach, expect, it } from 'vitest';

import { applyVerifiedSesEvent, sendMarketingMessages } from '#core/server/usecases/marketing-email.js';
import { dispatchMarketingOutbox } from '#core/server/usecases/marketing-dispatch.js';

import { createDeliveryFixture, deliveryCtx, deliveryWebhookCtx, deliveryWorkerCtx, DELIVERY_NOW } from './marketing-delivery-test-fixture.js';
import { createTelemetryOutbox, createTelemetrySettingsRepository } from './telemetry-outbox.js';
import { campaignSends } from './schema.js';

let fixture: Awaited<ReturnType<typeof createDeliveryFixture>> | undefined;
afterEach(async () => { await fixture?.close(); });
it('replicates applied delivery through the operational transaction without copying the body', async () => {
  fixture = await createDeliveryFixture();
  await createTelemetrySettingsRepository(fixture.db).save('delivery-a', { provider: 'mongodb', region: 'EU', connectedAt: DELIVERY_NOW, lastProbeAt: DELIVERY_NOW, lastProbeResult: 'ok', egressMode: 'unknown' });
  await fixture.consent('member@example.test');
  await sendMarketingMessages(deliveryCtx(), [{ to: 'member@example.test', memberId: null, campaignId: null, source: 'api', consentDefinitionId: 'consent', subject: 'Private subject', bodyHtml: '<p>Private body</p>', data: {} }], fixture.deps);
  await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'worker', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, fixture.deps);
  const [send] = await fixture.db.select().from(campaignSends);
  if (send === undefined) throw new Error('Missing operational send');
  const result = await applyVerifiedSesEvent(deliveryWebhookCtx(), { kind: 'delivery', topicArn: 'topic-a', messageId: 'ses-1', occurredAt: DELIVERY_NOW, raw: { body: 'Private body', ip: '192.0.2.1' } }, fixture.deps);
  expect(result).toEqual({ ok: true, value: { kind: 'applied' } });
  const rows = await createTelemetryOutbox(fixture.db).pending('delivery-a', fixture.deps.clock.nowIso(), 100);
  expect(rows.map((row) => row.event.type)).toEqual(['delivered']);
  expect(rows[0]?.event.sendId).toBe(send.id);
  expect(JSON.stringify(rows)).not.toMatch(/Private|192\.0\.2|rawProviderPayload/);
  expect(await createTelemetryOutbox(fixture.db).pending('delivery-b', DELIVERY_NOW, 100)).toEqual([]);
});
