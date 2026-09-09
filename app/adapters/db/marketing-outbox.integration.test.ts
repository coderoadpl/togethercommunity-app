import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { appError, err } from '#core/domain/index.js';
import { sendMarketingMessages } from '#core/server/usecases/marketing-email.js';
import { dispatchMarketingOutbox } from '#core/server/usecases/marketing-dispatch.js';

import { createDeliveryFixture, deliveryCtx, deliveryWorkerCtx, DELIVERY_NOW } from './marketing-delivery-test-fixture.js';
import { marketingOutbox, campaignSends, unsubscribeTokens, emailEvents } from './schema.js';

let fixture: Awaited<ReturnType<typeof createDeliveryFixture>> | undefined;
afterEach(async () => { await fixture?.close(); });
const message = (to: string) => ({ to, memberId: null, campaignId: null, source: 'api' as const, consentDefinitionId: 'consent', subject: 'News', bodyHtml: '<p><a href="https://courses.example.org/course">Learn</a></p>', data: {} });

describe('durable marketing outbox', () => {
  it('persists both bodies and Reply-To atomically, and suppresses after enqueue', async () => {
    fixture = await createDeliveryFixture();
    await fixture.consent('member@example.test');
    const queued = await sendMarketingMessages(deliveryCtx(), [message('member@example.test')], fixture.deps);
    expect(queued.ok && queued.value[0]?.status).toBe('queued');
    expect(fixture.sent).toHaveLength(0);
    const [row] = await fixture.db.select().from(marketingOutbox);
    expect(row?.payload?.text).toContain('Learn (https://courses.example.org/course)');
    expect(row?.payload?.text).toContain('Unsubscribe: https://courses.example.org/u/');
    expect(row?.payload?.replyTo).toBe('reply@example.test');
    await fixture.deps.suppressions.record('delivery-a', { id: 'suppression', tenantId: 'delivery-a', email: 'member@example.test', emailHmac: fixture.deps.hmac.compute('delivery-a', 'member@example.test'), reason: 'manual', sourceRef: null, meta: null, createdAt: DELIVERY_NOW, liftedAt: null, liftedBy: null });
    const result = await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'worker', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, fixture.deps);
    expect(result.ok && result.value.skipped).toBe(1);
    expect(fixture.sent).toHaveLength(0);
    expect((await fixture.db.select().from(campaignSends))[0]?.skipReason).toBe('suppressed');
  }, 60000);

  it('rolls back sends and tokens when durable enqueue fails', async () => {
    fixture = await createDeliveryFixture();
    await fixture.consent('member@example.test');
    const delivery = fixture.deps.delivery;
    await expect(sendMarketingMessages(deliveryCtx(), [message('member@example.test')], { ...fixture.deps,
      delivery: { run: (tenantId, operation) => delivery.run(tenantId, (repos) => operation({ ...repos, marketingOutbox: { ...repos.marketingOutbox, enqueue: async () => { throw new Error('storage failure'); } } })) },
    })).rejects.toThrow('storage failure');
    expect(await fixture.db.select().from(campaignSends)).toHaveLength(0);
    expect(await fixture.db.select().from(unsubscribeTokens)).toHaveLength(0);
    expect(await fixture.db.select().from(emailEvents)).toHaveLength(0);
  }, 60000);

  it('fences stale claims and retains uncertain acceptance without resending', async () => {
    fixture = await createDeliveryFixture();
    await fixture.consent('member@example.test');
    await sendMarketingMessages(deliveryCtx(), [message('member@example.test')], fixture.deps);
    const first = await fixture.deps.marketingOutbox.claim('delivery-a', { workerId: 'first', now: DELIVERY_NOW, lockedUntil: '2026-09-09T10:00:01.000Z' });
    const second = await fixture.deps.marketingOutbox.claim('delivery-a', { workerId: 'second', now: '2026-09-09T10:00:02.000Z', lockedUntil: '2026-09-09T10:00:03.000Z' });
    expect(first).not.toBeNull(); expect(second).not.toBeNull();
    if (first === null || second === null) return;
    expect(await fixture.deps.marketingOutbox.save('delivery-a', { ...first, status: 'dispatching' })).toBe(false);
    fixture.setNow('2026-09-09T10:00:04.000Z');
    const result = await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'third', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, { ...fixture.deps, ses: { send: async () => err(appError('integration_unavailable', 'Timeout after submission')) } });
    expect(result.ok && result.value.uncertain).toBe(1);
    await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'fourth', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, fixture.deps);
    expect(fixture.sent).toHaveLength(0);
    expect((await fixture.db.select().from(marketingOutbox).where(eq(marketingOutbox.id, first.id)))[0]?.status).toBe('uncertain');
  }, 60000);
});
