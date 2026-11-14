import { metaCapiDefaultCopy as englishCopy } from './meta-capi-copy.en.js';
import { metaCapiDefaultCopy as polishCopy } from './meta-capi-copy.pl.js';
import { metaCapiCopy } from './meta-capi-settings.js';
import { describe, expect, it } from 'vitest';
import { orderSchema } from './commerce.js';
import { buildMetaCapiPayload, metaCapiBlockReason, metaCapiDecisionSchema, metaCapiRetryAt } from './meta-capi.js';

const paidAt = '2026-11-01T10:00:00.000Z';
const order = orderSchema.parse({ id: 'purchase', tenantId: 'workspace', memberId: 'buyer', productId: 'book',
  priceId: null, kind: 'one_time', status: 'paid', amountCents: 9900, currency: 'PLN', provider: 'stripe',
  providerObjectIds: { checkoutSession: 'cs_live_purchase', customerCountry: 'PL' }, couponId: null,
  discountCents: 0, paidAt, createdAt: paidAt });
const granted = { consent: 'granted', withdrawnAt: null } as const;

describe('Meta conversion domain rules', () => {
  it('resolves English and Polish defaults while keeping tenant overrides first', () => {
    expect(metaCapiCopy({})).toEqual({ ...englishCopy, privacyUrl: null });
    expect(metaCapiCopy({}, 'en')).toEqual({ ...englishCopy, privacyUrl: null });
    expect(metaCapiCopy({}, 'pl')).toEqual({ ...polishCopy, privacyUrl: null });
    for (const locale of ['en', 'pl'] as const) {
      expect(metaCapiCopy({ analyticsMetaCapiConsentHeading: 'Custom heading', analyticsMetaCapiConsentBody: 'Custom body',
        analyticsMetaCapiConsentAcceptLabel: 'Accept', analyticsMetaCapiConsentDeclineLabel: 'Decline', privacyUrl: 'https://example.org/privacy' }, locale))
        .toEqual({ heading: 'Custom heading', body: 'Custom body', acceptLabel: 'Accept', declineLabel: 'Decline', privacyUrl: 'https://example.org/privacy' });
    }
  });
  it.each([undefined, 'en', 'pl'] as const)('restores locale-resolved defaults for null overrides and locale %s', (locale) => {
    expect(metaCapiCopy({ analyticsMetaCapiConsentHeading: null, analyticsMetaCapiConsentBody: null,
      analyticsMetaCapiConsentAcceptLabel: null, analyticsMetaCapiConsentDeclineLabel: null }, locale))
      .toEqual({ ...(locale === 'pl' ? polishCopy : englishCopy), privacyUrl: null });
  });
  it('allows only explicit, unwithdrawn grants for real paid purchases', () => {
    expect(metaCapiBlockReason(order, granted, true, paidAt)).toBeNull();
    for (const consent of ['undecided', 'denied'] as const) expect(metaCapiBlockReason(order, { consent, withdrawnAt: null }, true, paidAt)).toBe('blocked');
    expect(metaCapiBlockReason(order, { ...granted, withdrawnAt: paidAt }, true, paidAt)).toBe('blocked');
    expect(metaCapiBlockReason(order, granted, false, paidAt)).toBe('blocked');
    expect(metaCapiBlockReason({ ...order, paidAt: null }, granted, true, paidAt)).toBe('blocked');
    expect(metaCapiBlockReason({ ...order, status: 'pending' }, granted, true, paidAt)).toBe('blocked');
  });
  it('rejects test sessions, test-mode orders, simulated purchases and future timestamps', () => {
    for (const changed of [
      { ...order, mode: 'test' as const }, { ...order, provider: 'simulated' as const },
      { ...order, providerObjectIds: { checkoutSession: 'cs_test_purchase' } },
    ]) expect(metaCapiBlockReason(changed, granted, true, paidAt)).toBe('blocked');
    expect(metaCapiBlockReason(order, granted, true, '2026-10-31T10:00:00.000Z')).toBe('blocked');
  });
  it('expires at seven days without changing the paid time', () => {
    expect(metaCapiBlockReason(order, granted, true, '2026-11-08T09:59:59.000Z')).toBeNull();
    expect(metaCapiBlockReason(order, granted, true, '2026-11-08T10:00:00.000Z')).toBe('expired');
  });
  it('permits three retries only for retryable failures with increasing delays', () => {
    expect([1, 2, 3, 4].map((attempt) => metaCapiRetryAt(attempt, true, paidAt))).toEqual([
      '2026-11-01T10:01:00.000Z', '2026-11-01T10:02:00.000Z', '2026-11-01T10:04:00.000Z', null,
    ]);
    expect(metaCapiRetryAt(1, false, paidAt)).toBeNull();
    expect(metaCapiRetryAt(0, true, paidAt)).toBeNull();
  });
  it('builds the full purchase payload and hashes normalized matching fields', () => {
    const payload = buildMetaCapiPayload({ order: { ...order, attribution: { fbclid: 'click_123', capturedAt: paidAt } },
      email: ' Buyer@Example.org ', sourceUrl: 'https://workspace.example.org/offer/book',
      ip: '192.0.2.1', userAgent: 'Browser', fbp: 'fb.1.1793527200000.123', sha256: (value) => `hash:${value}` });
    expect(payload).toEqual({ event_name: 'Purchase', action_source: 'website', event_time: Date.parse(paidAt) / 1000,
      event_id: 'purchase', event_source_url: 'https://workspace.example.org/offer/book',
      user_data: { em: ['hash:buyer@example.org'], country: ['hash:pl'], client_ip_address: '192.0.2.1', client_user_agent: 'Browser',
        fbp: 'fb.1.1793527200000.123', fbc: `fb.1.${String(Date.parse(paidAt))}.click_123` },
      custom_data: { value: 99, currency: 'PLN', content_type: 'product', content_ids: ['book'],
        contents: [{ id: 'book', quantity: 1, item_price: 99 }], num_items: 1, order_id: 'purchase' } });
  });
  it('omits absent click/browser/country data instead of fabricating identifiers', () => {
    const payload = buildMetaCapiPayload({ order: { ...order, providerObjectIds: { checkoutSession: 'cs_live_purchase' } },
      email: 'buyer@example.org', sourceUrl: 'https://example.org/offer/book', ip: null, userAgent: null, fbp: null,
      sha256: () => 'a'.repeat(64) });
    expect(payload.user_data).toEqual({ em: ['a'.repeat(64)] });
    expect(JSON.stringify(payload)).not.toContain('buyer@example.org');
  });
  it('excludes shipping from products while retaining the full purchase value', () => {
    const withShipping = orderSchema.parse({ ...order, amountCents: 10900, lines: [
      { productId: 'book', productType: 'digital_download', name: 'Book', grossCents: 9900, netCents: 9900, vatCents: 0, vatRate: 'exempt', vatExemptionBasis: null, issuedCount: 0 },
      { productId: 'shipping', productType: 'shipping', name: 'Delivery', grossCents: 1000, netCents: 1000, vatCents: 0, vatRate: 'exempt', vatExemptionBasis: null, issuedCount: 0 },
    ] });
    const payload = buildMetaCapiPayload({ order: withShipping, email: 'buyer@example.org', sourceUrl: 'https://example.org',
      ip: null, userAgent: null, fbp: null, sha256: (value) => value });
    expect(payload.custom_data).toMatchObject({ value: 109, content_ids: ['book'], num_items: 1,
      contents: [{ id: 'book', quantity: 1, item_price: 99 }] });
  });
  it('allows QR credentials only to withdraw even with a current text version', () => {
    for (const decision of ['granted', 'denied']) {
      expect(metaCapiDecisionSchema.safeParse({ orderToken: 'q'.repeat(64), decision, textVersion: 'a'.repeat(64) }).success).toBe(false);
    }
    expect(metaCapiDecisionSchema.safeParse({ orderToken: 'q'.repeat(64), decision: 'withdrawn' }).success).toBe(true);
  });
  it('requires exactly one opaque credential and a text version for grants', () => {
    expect(metaCapiDecisionSchema.safeParse({ sessionId: 'cs_live_purchase', decision: 'granted' }).success).toBe(false);
    expect(metaCapiDecisionSchema.safeParse({ decision: 'denied' }).success).toBe(false);
    expect(metaCapiDecisionSchema.safeParse({ sessionId: 'cs_live_purchase', decision: 'granted', textVersion: 'a'.repeat(64), fbp: 'invalid' })).toMatchObject({ success: true, data: { fbp: null } });
  });
});
