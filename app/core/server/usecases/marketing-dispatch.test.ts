import { describe, expect, it } from 'vitest';

import { capabilitiesForPrincipal, ok, type TenantSesSettings } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { createInMemoryMarketingDelivery } from '../testing/marketing-delivery-fakes.js';
import { FakeEmailHmac, InMemoryCampaignRepository, InMemoryCampaignSendRepository, InMemoryConsentDefinitionRepository, InMemoryEmailEventRepository, InMemoryEmailOutboxRepository, InMemoryMarketingConsentRepository, InMemoryMarketingThrottleRepository, InMemorySuppressionRepository, InMemoryTenantSesSettingsRepository, InMemoryUnsubscribeTokenRepository } from '../testing/marketing-fakes.js';
import { dispatchMarketingOutbox, marketingSendBudget } from './marketing-dispatch.js';

const nowIso = '2026-09-09T10:00:00.000Z';
const ctx: Ctx = { identity: { userId: 'worker', email: 'worker@example.test', name: 'Worker', emailVerified: true, image: null, tenantId: 'tenant', tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false }, capabilities: capabilitiesForPrincipal('operator-secret') };
const settings: TenantSesSettings = {
  tenantId: 'tenant', fromAddress: 'sender@example.test', fromName: 'Example', replyTo: 'reply@example.test', identity: 'example.test', identityVerifiedAt: nowIso, identityCheckedAt: nowIso, identityCheckError: null,
  configurationSet: 'marketing', snsTopicArn: 'topic', snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null, trackingEnabled: false, autoPauseOnCritical: false,
  webhookToken: 'webhook_token_123456789012345', quotaRatePerSec: 5, quotaDaily: 10000, quotaRefreshedAt: nowIso, quotaSentLast24Hours: 0, inSandbox: false,
  webhookVerifiedAt: nowIso, footerLegalName: 'Example Company', footerAddress: '123 Example Street', broadcastsEnabled: true, reputationAlertStatus: null, reputationAlertedAt: null,
};

describe('marketing throughput', () => {
  it.each([[5, 225, 14], [14, 630, 5]])('budgets %s recipients/second conservatively', (ratePerSecond, budget, ticks) => {
    const value = marketingSendBudget({ ratePerSecond, sendSeconds: 50, dailyRemaining: 10000, batchCap: 1000 });
    expect(value).toBe(budget);
    expect(Math.ceil(3000 / value)).toBe(ticks);
  });
  it('honors exhausted daily quota and configured batch caps', () => {
    expect(marketingSendBudget({ ratePerSecond: 14, sendSeconds: 50, dailyRemaining: 0, batchCap: 1000 })).toBe(0);
    expect(marketingSendBudget({ ratePerSecond: 14, sendSeconds: 50, dailyRemaining: 10000, batchCap: 100 })).toBe(100);
    expect(marketingSendBudget({ ratePerSecond: 1, sendSeconds: 50, dailyRemaining: 10000, batchCap: 1000 })).toBe(45);
  });
  it('dispatches 3000 recipients within an hour including cron delay, overhead and provider latency', async () => {
    let now = Date.parse(nowIso) + 60_000;
    const starts: number[] = [];
    let sequence = 0;
    const events = new InMemoryEmailEventRepository();
    const definitions = new InMemoryConsentDefinitionRepository();
    const consents = new InMemoryMarketingConsentRepository();
    const repos = { campaigns: new InMemoryCampaignRepository(), sends: new InMemoryCampaignSendRepository(events), events,
      suppressions: new InMemorySuppressionRepository(events), unsubscribes: new InMemoryUnsubscribeTokenRepository(events),
      sesSettings: new InMemoryTenantSesSettingsRepository([settings]), outbox: new InMemoryEmailOutboxRepository(events) };
    const delivery = createInMemoryMarketingDelivery(() => repos);
    await definitions.create('tenant', { id: 'definition', tenantId: 'tenant', key: 'updates', kind: 'optional_marketing', channel: 'email', doubleOptIn: false, documentRef: { mode: 'url', url: 'https://courses.example.org/legal' }, status: 'active', createdAt: nowIso, updatedAt: nowIso }, { id: 'version', tenantId: 'tenant', definitionId: 'definition', version: 1, label: 'Updates', documentVersionRef: { mode: 'url', url: 'https://courses.example.org/legal' }, createdAt: nowIso, createdBy: null });
    for (let index = 0; index < 3000; index += 1) {
      const id = `send-${String(index)}`;
      const to = `recipient-${String(index)}@example.test`;
      await consents.record('tenant', { id: `consent-${String(index)}`, tenantId: 'tenant', memberId: null, email: to, definitionId: 'definition', definitionVersion: 1, wordingSnapshot: 'Updates', documentRefSnapshot: { mode: 'url', url: 'https://courses.example.org/legal' }, status: 'granted', previousId: null, source: 'api', evidence: { collectedAt: nowIso }, occurredAt: nowIso });
      await repos.sends.claimRecipient('tenant', { id, tenantId: 'tenant', runId: null, campaignId: null, memberId: null, source: 'api', email: to, subject: 'Updates', consentRowId: `consent-${String(index)}`, unsubscribeTokenId: null, status: 'pending', skipReason: null, sesMessageId: null, deliveryStatus: null, deliveryOccurredAt: null, idempotencySource: null, renderedBodyPurgedAt: null, createdAt: nowIso, sentAt: null });
      await delivery.marketingOutbox.enqueue('tenant', { id, tenantId: 'tenant', campaignSendId: id,
        payload: { campaignSendId: id, consentDefinitionId: 'definition', to, subject: 'Updates', html: '<p>Updates</p>', text: 'Updates', headers: {}, from: { address: settings.fromAddress, name: settings.fromName }, replyTo: 'reply@example.test', configurationSet: 'marketing' },
        payloadPurgedAt: null, status: 'pending', attempts: 0, nextAttemptAt: nowIso, lockedBy: null, lockedUntil: null, claimVersion: 0, sesMessageId: null, lastError: null, createdAt: nowIso, updatedAt: nowIso });
    }
    const deps = { ...repos, ...delivery, definitions, consents, hmac: new FakeEmailHmac(), throttle: new InMemoryMarketingThrottleRepository(),
      clock: { nowIso: () => new Date(now).toISOString() }, waiter: { wait: async (milliseconds: number) => { now += milliseconds; } },
      ids: { nextId: () => `event-${String(++sequence)}` }, credentials: { resolve: async () => ok({ accessKeyId: 'test', secretAccessKey: 'test', region: 'eu-central-1' }) },
      ses: { send: async () => { starts.push(now); now += 100; return ok({ messageId: `ses-${String(starts.length)}` }); } } };
    let ticks = 0;
    while (starts.length < 3000 && ticks < 60) {
      const tickStart = now;
      now += 5000;
      const dispatched = await dispatchMarketingOutbox(ctx, { workerId: `worker-${String(ticks)}`, deadlineAt: new Date(tickStart + 55_000).toISOString(), maxSends: marketingSendBudget({ ratePerSecond: 5, sendSeconds: 50, dailyRemaining: 10000 - starts.length, batchCap: 1000 }) }, deps);
      expect(dispatched.ok).toBe(true);
      ticks += 1;
      if (starts.length < 3000) now = tickStart + 60_000;
    }
    expect(starts).toHaveLength(3000);
    expect(ticks).toBe(14);
    expect(now - Date.parse(nowIso)).toBeLessThan(60 * 60_000);
    expect(starts.every((start, index) => index === 0 || start - (starts[index - 1] ?? 0) >= 222)).toBe(true);
  });
});
