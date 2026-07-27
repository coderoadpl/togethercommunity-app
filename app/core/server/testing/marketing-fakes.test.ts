import { describe, expect, it } from 'vitest';

import type { Campaign, CampaignSend, MarketingConsent, UnsubscribeToken } from '@core/domain/index.js';

import {
  InMemoryCampaignRepository,
  InMemoryCampaignSendRepository,
  InMemoryMarketingConsentRepository,
  InMemoryUnsubscribeTokenRepository,
} from './marketing-fakes.js';

const consent = (id: string, status: MarketingConsent['status'], occurredAt: string): MarketingConsent => ({
  id,
  tenantId: 'tenant-1',
  memberId: 'member-1',
  email: 'member@example.com',
  definitionId: 'definition-1',
  definitionVersion: 1,
  wordingSnapshot: 'News',
  documentRefSnapshot: { mode: 'url', url: 'https://tenant.test/privacy' },
  status,
  previousId: null,
  source: 'checkout',
  evidence: { collectedAt: occurredAt },
  occurredAt,
});

const campaign = (): Campaign => ({
  id: 'campaign-1', tenantId: 'tenant-1', name: 'Weekly', subject: 'Hello', bodyHtml: '<p>Hello</p>',
  bodySource: '<p>Hello</p>', layoutId: null, consentDefinitionId: 'definition-1', audienceFilter: null,
  status: 'running', sendAt: null, snapshotMaxMemberId: 'member-9', cursorMemberId: null, toSend: 2,
  sent: 0, failed: 0, lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null,
  audienceNameSnapshot: null, consentLabelSnapshot: null, startedAt: null, finishedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
});

const send = (): CampaignSend => ({
  id: 'send-1', tenantId: 'tenant-1', campaignId: 'campaign-1', source: 'broadcast', memberId: 'member-1',
  email: 'member@example.com', subject: 'Hello', consentRowId: 'consent-1',
  unsubscribeTokenId: null, status: 'pending',
  skipReason: null, sesMessageId: null, deliveryStatus: null, deliveryOccurredAt: null,
  idempotencySource: null, renderedBodyPurgedAt: null, createdAt: '2026-07-01T00:00:00.000Z', sentAt: null,
});

describe('marketing in-memory fakes', () => {
  it('keeps consent evidence append-only and returns the latest normalized-email row', async () => {
    const repository = new InMemoryMarketingConsentRepository();
    await repository.record('tenant-1', consent('consent-1', 'granted', '2026-07-01T00:00:00.000Z'));
    await repository.record('tenant-1', consent('consent-2', 'confirmed', '2026-07-02T00:00:00.000Z'));
    await expect(repository.latestByEmail('tenant-1', ' MEMBER@EXAMPLE.COM ', 'definition-1'))
      .resolves.toMatchObject({ id: 'consent-2', status: 'confirmed' });
    await expect(repository.record('tenant-1', consent('consent-1', 'withdrawn', '2026-07-03T00:00:00.000Z')))
      .rejects.toThrow('append-only');
  });

  it('consumes unsubscribe tokens once while repeated use stays successful', async () => {
    const repository = new InMemoryUnsubscribeTokenRepository();
    const token: UnsubscribeToken = {
      id: 'token-1', tenantId: 'tenant-1', token: '0123456789abcdef0123456789abcdef',
      email: 'member@example.com', memberId: 'member-1', campaignSendId: 'send-1', scope: 'all_marketing',
      createdAt: '2026-07-01T00:00:00.000Z', usedAt: null,
    };
    await repository.create('tenant-1', token);
    await expect(repository.consume('tenant-1', token.token, '2026-07-02T00:00:00.000Z'))
      .resolves.toMatchObject({ token: { usedAt: '2026-07-02T00:00:00.000Z' }, newlyUsed: true });
    await expect(repository.consume('tenant-1', token.token, '2026-07-03T00:00:00.000Z'))
      .resolves.toMatchObject({ token: { usedAt: '2026-07-02T00:00:00.000Z' }, newlyUsed: false });
  });

  it('implements campaign leases, cursors, recipient claims, and SES correlation', async () => {
    const campaigns = new InMemoryCampaignRepository([campaign()]);
    expect(await campaigns.acquireLease('tenant-1', 'campaign-1', {
      workerId: 'worker-1', now: '2026-07-01T00:00:00.000Z', lockedUntil: '2026-07-01T00:01:00.000Z',
    })).toBe(true);
    expect(await campaigns.acquireLease('tenant-1', 'campaign-1', {
      workerId: 'worker-2', now: '2026-07-01T00:00:30.000Z', lockedUntil: '2026-07-01T00:02:00.000Z',
    })).toBe(false);
    await campaigns.advanceCursor('tenant-1', 'campaign-1', { cursorMemberId: 'member-1', sentDelta: 1, failedDelta: 0 });
    await expect(campaigns.findById('tenant-1', 'campaign-1')).resolves.toMatchObject({ cursorMemberId: 'member-1', sent: 1 });

    const sends = new InMemoryCampaignSendRepository();
    expect(await sends.claimRecipient('tenant-1', send())).toBe(true);
    expect(await sends.claimRecipient('tenant-1', { ...send(), id: 'send-2' })).toBe(false);
    await sends.update('tenant-1', { ...send(), status: 'sent', sesMessageId: 'ses-1' });
    await expect(sends.correlateBySesMessageId('tenant-1', 'ses-1')).resolves.toMatchObject({ id: 'send-1' });
  });
});
