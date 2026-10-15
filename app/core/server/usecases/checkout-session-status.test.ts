import { describe, expect, it, vi } from 'vitest';

import { salesLinkSchema, tenantSettingsSchema, type Order, type Product, type TenantSettings } from '#core/domain/index.js';
import { type PaymentRefundRepository } from '../ports.js';
import { getCheckoutSessionStatus } from './checkout-session-status.js';

const order: Order = {
  id: 'order-1',
  tenantId: 'tenant-1',
  memberId: 'member-1',
  productId: 'product-1',
  priceId: null,
  kind: 'one_time',
  status: 'paid',
  mode: 'live',
  amountCents: 1000,
  currency: 'PLN',
  provider: 'stripe',
  providerObjectIds: { checkoutSession: 'cs_live_paid123' },
  couponId: null,
  discountCents: 0,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const harness = (rows: Order[] = [order], settings: TenantSettings | null = null, product: Product | null = null) => {
  const findOrderByProviderObjectIds = vi.fn<PaymentRefundRepository['findOrderByProviderObjectIds']>(
    async (tenantId, ids, mode) => rows.find((row) => row.tenantId === tenantId
      && row.mode === mode && row.providerObjectIds.checkoutSession === ids.checkoutSession) ?? null,
  );
  return {
    salesLinks: { findById: vi.fn(async () => salesLinkSchema.parse({
      id: 'link-1', tenantId: 'tenant-1', slug: 'workbook', title: 'Workbook', heading: 'Workbook', productIds: ['product-1'],
      active: true, revision: 1, createdAt: order.createdAt, updatedAt: order.createdAt,
    })) },
    tenants: { findSettings: vi.fn(async () => settings) },
    products: { findById: vi.fn(async () => product) },
    paymentRefunds: {
      findOrderByProviderObjectIds,
      findLatestSubscriptionOrder: async () => null,
      listAccessRetainingOrdersForMemberProduct: async () => [],
      markOrderRefunded: async () => null,
      markOrderPartiallyRefunded: async () => null,
    },
  };
};

describe('getCheckoutSessionStatus', () => {
  it.each(['paid', 'partially_refunded', 'refunded'] as const)('reports %s orders as paid without exposing order data', async (status) => {
    const deps = harness([{ ...order, status }]);
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toEqual({
      ok: true, value: { status: 'paid' },
    });
    expect(deps.paymentRefunds.findOrderByProviderObjectIds).toHaveBeenCalledExactlyOnceWith(
      'tenant-1', { checkoutSession: 'cs_live_paid123' }, 'live',
    );
  });

  it.each([
    ['unknown session', order, 'tenant-1', 'cs_live_unknown'],
    ['foreign tenant', order, 'tenant-2', 'cs_live_paid123'],
    ['wrong mode', { ...order, mode: 'test' }, 'tenant-1', 'cs_live_paid123'],
    ['pending order', { ...order, status: 'pending' }, 'tenant-1', 'cs_live_paid123'],
  ] as const)('reports pending for %s', async (_case, row, tenantId, sessionId) => {
    expect(await getCheckoutSessionStatus(tenantId, sessionId, harness([row]))).toEqual({
      ok: true, value: { status: 'pending' },
    });
  });

  it.each([
    ['foreign tenant', { ...order, tenantId: 'tenant-2' }],
    ['wrong mode', { ...order, mode: 'test' }],
    ['another session', { ...order, providerObjectIds: { checkoutSession: 'cs_live_other' } }],
    ['failed payment', { ...order, status: 'failed' }],
  ] as const)('never treats a repository result for %s as paid', async (_case, row) => {
    const deps = harness();
    deps.paymentRefunds.findOrderByProviderObjectIds.mockResolvedValue(row);
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toEqual({
      ok: true, value: { status: 'pending' },
    });
  });

  it('looks up test sessions in test mode', async () => {
    const sessionId = 'cs_test_paid123';
    const deps = harness([{ ...order, mode: 'test', providerObjectIds: { checkoutSession: sessionId } }]);
    expect(await getCheckoutSessionStatus('tenant-1', sessionId, deps)).toEqual({
      ok: true, value: { status: 'paid' },
    });
    expect(deps.paymentRefunds.findOrderByProviderObjectIds).toHaveBeenCalledExactlyOnceWith(
      'tenant-1', { checkoutSession: sessionId }, 'test',
    );
  });

  it.each(['', 'cs_live_', 'cs_test_', 'cs_other_abc', 'cs_live_a-b', 'cs_live_a_b', `cs_live_${'a'.repeat(201)}`])(
    'rejects malformed session ids without a repository lookup: %s', async (sessionId) => {
      const deps = harness();
      expect(await getCheckoutSessionStatus('tenant-1', sessionId, deps)).toMatchObject({
        ok: false, error: { code: 'validation' },
      });
      expect(deps.paymentRefunds.findOrderByProviderObjectIds).not.toHaveBeenCalled();
    },
  );
});

const analyticsSettings = tenantSettingsSchema.parse({
  name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null, analyticsTagId: 'G-ABCDEF',
});

describe('checkout session purchase analytics', () => {
  it.each([
    analyticsSettings,
    { ...analyticsSettings, analyticsTagId: null, analyticsMetaPixelId: '12345678' },
    { ...analyticsSettings, analyticsMetaPixelId: '12345678' },
  ])('returns immutable order lines and gross major units with configured analytics %j', async (settings) => {
    const deps = harness([{ ...order, amountCents: 12999, lines: [
      { productId: 'product-1', name: 'First product', productType: 'digital_download', grossCents: 9900,
        netCents: 9900, vatRate: null, vatCents: 0, vatExemptionBasis: null, issuedCount: null },
      { productId: 'product-2', name: 'Second product', productType: 'digital_download', grossCents: 3099,
        netCents: 3099, vatRate: null, vatCents: 0, vatExemptionBasis: null, issuedCount: null },
    ] }], settings);
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toEqual({
      ok: true, value: { status: 'paid', analytics: {
        fbclid: null, attributionAt: null, transactionId: 'order-1', value: 129.99, currency: 'PLN', offerSlug: null, items: [
          { itemId: 'product-1', itemName: 'First product', price: 99 },
          { itemId: 'product-2', itemName: 'Second product', price: 30.99 },
        ],
      } },
    });
    expect(deps.products.findById).not.toHaveBeenCalled();
    expect(deps.salesLinks.findById).not.toHaveBeenCalled();
  });

  it('resolves the order sales link within its tenant', async () => {
    const deps = harness([{ ...order, salesLinkId: 'link-1' }], analyticsSettings);
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toMatchObject({
      ok: true, value: { analytics: { offerSlug: 'workbook' } },
    });
    expect(deps.salesLinks.findById).toHaveBeenCalledExactlyOnceWith('tenant-1', 'link-1');
  });

  it('does not expose a sales link slug from another tenant', async () => {
    const deps = harness([{ ...order, salesLinkId: 'link-1' }], analyticsSettings);
    deps.salesLinks.findById.mockResolvedValue(salesLinkSchema.parse({
      id: 'link-1', tenantId: 'tenant-2', slug: 'foreign-workbook', title: 'Foreign workbook',
      heading: 'Foreign workbook', productIds: ['product-2'], active: true, revision: 1,
      createdAt: order.createdAt, updatedAt: order.createdAt,
    }));
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toMatchObject({
      ok: true, value: { status: 'paid', analytics: { offerSlug: null } },
    });
    expect(deps.salesLinks.findById).toHaveBeenCalledExactlyOnceWith('tenant-1', 'link-1');
  });

  it('returns a null offer slug when the sales link no longer exists', async () => {
    const deps = { ...harness([{ ...order, salesLinkId: 'deleted-link' }], analyticsSettings),
      salesLinks: { findById: async () => null },
    };
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toMatchObject({
      ok: true, value: { analytics: { offerSlug: null } },
    });
  });

  it('uses the tenant product for historical orders without line snapshots', async () => {
    const product: Product = {
      id: order.productId, tenantId: order.tenantId, type: 'digital_download', slug: 'historical-product',
      title: 'Historical product', description: '', coverUrl: null, priceCents: 9999, currency: 'PLN',
      published: false, visibility: 'listed', accessItems: [], legacyId: null, createdAt: order.createdAt,
    };
    const deps = harness([order], analyticsSettings, product);
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toEqual({
      ok: true, value: { status: 'paid', analytics: { fbclid: null, attributionAt: null, transactionId: 'order-1', value: 10, currency: 'PLN', offerSlug: null,
        items: [{ itemId: 'product-1', itemName: 'Historical product', price: 10 }],
      } },
    });
    expect(deps.products.findById).toHaveBeenCalledExactlyOnceWith('tenant-1', 'product-1');
  });

  it.each(['pending', 'failed'] as const)('does not expose configured analytics for a %s order', async (status) => {
    const deps = harness([{ ...order, status }], analyticsSettings);
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toEqual({
      ok: true, value: { status: 'pending' },
    });
    expect(deps.tenants.findSettings).not.toHaveBeenCalled();
  });

  it('does not expose analytics for an unknown session even when configured', async () => {
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_unknown', harness([order], analyticsSettings))).toEqual({
      ok: true, value: { status: 'pending' },
    });
  });
});


it('includes the saved click id and capture time only in configured paid analytics', async () => {
  const attribution = { fbclid: 'click_123', capturedAt: '2026-10-15T10:00:00.000Z' };
  const deps = harness([{ ...order, attribution }], analyticsSettings);
  expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toMatchObject({
    ok: true, value: { analytics: { fbclid: attribution.fbclid, attributionAt: attribution.capturedAt } },
  });
  expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', harness([{ ...order, attribution }]))).toEqual({
    ok: true, value: { status: 'paid' },
  });
});
