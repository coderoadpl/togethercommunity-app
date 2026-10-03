import { describe, expect, it } from 'vitest';

import { emailEventSchema } from './email-event.js';
import { memberEventSchema } from './member-event.js';
import { normalizeEmailTelemetry, normalizeMemberTelemetry, telemetryEventSchema } from './telemetry.js';

const at = '2026-09-13T10:00:00.000Z';
const correlation = { campaignId: 'campaign', contactId: 'contact', memberId: null, sesMessageId: 'ses', trackingPolicyVersion: '1' };
const email = (type: 'opened' | 'clicked' | 'bounced' | 'queued') => emailEventSchema.parse({
  id: 'event', tenantId: 'tenant', mailKind: 'marketing', refId: 'send', type,
  occurredAt: at, createdAt: at, meta: {
    classification: 'hard', linkUrl: 'https://example.com/lesson', rawProviderPayload: { body: 'private', ip: '192.0.2.1' },
    ip: '192.0.2.1', userAgent: 'private', geolocation: 'private', body: 'private',
  },
});
describe('telemetry allowlist', () => {
  it.each(['opened', 'clicked', 'bounced'] as const)('excludes provider data from %s', (type) => {
    const normalized = normalizeEmailTelemetry(email(type), correlation);
    expect(JSON.stringify(normalized)).not.toMatch(/private|rawProviderPayload|userAgent|geolocation|192\.0\.2/);
    expect(normalized?.id).toBe('v1:email:event');
    expect(telemetryEventSchema.parse({ ...normalized, ip: '192.0.2.1', meta: { body: 'private' } })).toEqual(normalized);
  });
  it('excludes operational and transactional email events', () => {
    expect(normalizeEmailTelemetry(email('queued'), correlation)).toBeNull();
    expect(normalizeEmailTelemetry({ ...email('opened'), mailKind: 'transactional' }, correlation)).toBeNull();
  });
  it('only retains purchase identity, without financial or descriptive payload', () => {
    const event = memberEventSchema.parse({ id: 'purchase', tenantId: 'tenant', memberId: 'member', type: 'purchase', occurredAt: at,
      payload: { orderId: 'order', productId: 'product', kind: 'one_time', status: 'paid', amountCents: 100, currency: 'EUR', provider: 'simulated' } });
    const result = normalizeMemberTelemetry(event, { contactId: 'contact', ingestedAt: at, trackingPolicyVersion: '1' });
    expect(result?.orderId).toBe('order');
    expect(result?.campaignId).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/amountCents|currency|payload|productId/);
  });
});
