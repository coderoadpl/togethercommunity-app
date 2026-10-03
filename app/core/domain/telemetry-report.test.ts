import { describe, expect, it } from 'vitest';

import { campaignWithoutStatisticsSchema, sendWithoutEngagement } from './telemetry-report.js';
import { campaignSchema } from './marketing-email.js';
import { emailEventSchema } from './email-event.js';

const campaign = campaignSchema.parse({ id: 'campaign', tenantId: 'tenant', name: 'Campaign', subject: 'Subject', bodyHtml: '<p>Message</p>', bodySource: 'Message', layoutId: null, consentDefinitionId: 'consent', audienceFilter: null, status: 'finished', sendAt: null, snapshotMaxMemberId: null, cursorMemberId: null, toSend: 40, sent: 30, failed: 2, lockedUntil: null, lockedBy: null, errorCount: 1, pausedReason: null, audienceNameSnapshot: null, consentLabelSnapshot: null, startedAt: null, finishedAt: null, createdAt: '2026-09-13T10:00:00.000Z' });
describe('campaign reports without a connected store', () => {
  it('omits statistics instead of returning zeros', () => {
    const result = campaignWithoutStatisticsSchema.parse({ ...campaign, statisticsUnavailable: true, engagement: { totalOpens: 20 }, results: { sent: 30 }, queued: 5, unresolved: 3 });
    expect(result).toMatchObject({ id: 'campaign', status: 'finished', statisticsUnavailable: true });
    for (const field of ['candidateCount', 'skipped', 'toSend', 'sent', 'failed', 'errorCount', 'engagement', 'results', 'queued', 'unresolved']) expect(result).not.toHaveProperty(field);
  });
  it('drops engagement rows from per-send detail while keeping delivery records', () => {
    const meta: Record<string, Record<string, unknown>> = { clicked: { linkUrl: 'https://example.test/offer' }, bounced: { classification: 'hard' } };
    const event = (type: 'opened' | 'clicked' | 'delivered' | 'bounced') => emailEventSchema.parse({ id: `event-${type}`, tenantId: 'tenant', mailKind: 'marketing', refId: 'send', type, occurredAt: '2026-09-13T10:00:00.000Z', createdAt: '2026-09-13T10:00:00.000Z', meta: meta[type] ?? {} });
    const detail = sendWithoutEngagement({ send: { id: 'send' }, events: [event('delivered'), event('opened'), event('clicked'), event('bounced')] });
    expect(detail.events.map((row) => row.type)).toEqual(['delivered', 'bounced']);
    expect(JSON.stringify(detail)).not.toMatch(/example\.test\/offer/);
  });
});
