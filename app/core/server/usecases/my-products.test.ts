import { describe, expect, it, vi } from 'vitest';

import type { Identity, MemberGrant, Order, OrderShipping, Product, ProductPrice, ProductDownloadAsset } from '#core/domain/index.js';

import type { Clock } from '../ports.js';
import type { ProductGrantRepository, ProductPriceRepository } from '../ports.js';
import { listMyProducts } from './my-products.js';

const identity = (tenantId: string | null, memberId: string | null): Identity => ({
  userId: 'u1',
  email: 'buyer@together.dev',
  name: 'Buyer',
  emailVerified: true,
  tenantAccess: tenantId === null ? 'none' : 'member',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme' : null,
  staffRole: null,
  memberId,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
});

const granted: Product = {
  id: 'p1',
  tenantId: 't-acme',
  type: 'course',
  slug: 'granted-course',
  title: 'Granted Course',
  description: 'A course you own',
  coverUrl: null,
  priceCents: 9900,
  currency: 'PLN',
  visibility: 'unlisted',
  deliveryMethod: 'pickup',
  published: true,
  accessItems: [{ level: 'course', courseId: 'course-1' }],
  legacyId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
};

const memberGrant = (overrides: Partial<MemberGrant> = {}): MemberGrant => ({
  mode: 'live',
  id: 'g1',
  productId: 'p1',
  productName: 'Granted Course',
  startsAt: '2026-07-01T00:00:00.000Z',
  expiresAt: null,
  source: 'manual',
  active: true,
  ...overrides,
});

const clock: Clock = { nowIso: () => '2026-07-15T00:00:00.000Z' };

const subscriptions = {
  findById: async () => null,
  findByProviderSubscriptionId: async () => null,
  listKnownProviderSubscriptionIds: async () => [],
  listForMember: async () => [],
  create: async () => undefined,
  update: async () => null,
  countActive: async () => 0,
};

const downloadAssets = {
  create: async () => undefined,
  findById: async () => null,
  listByProduct: async () => [],
  listReadyByProduct: async () => [],
  markReady: async () => null,
  delete: async () => false,
};

const publicPrice: ProductPrice = {
  id: 'price-1',
  tenantId: 't-acme',
  productId: 'p1',
  kind: 'one_time',
  interval: null,
  amountCents: 9900,
  currency: 'PLN',
  active: true,
  createdAt: '2026-07-12T00:00:00.000Z',
};

const prices: ProductPriceRepository = {
  listByProduct: async () => [publicPrice],
  listActiveByProducts: async () => [publicPrice],
  findById: async () => publicPrice,
  create: async () => undefined,
  setActive: async () => null,
};

const grants = (products: Product[], memberGrants: MemberGrant[]): ProductGrantRepository => ({
  findById: async () => null,
  findGrant: async () => null,
  createGrant: async () => true,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => memberGrants,
  listActiveForMember: async () => [],
  listGrantedProducts: async () => products,
});

describe('listMyProducts', () => {
  it('includes paid physical lines without creating or requiring an access grant', async () => {
    const physical: Product = { ...granted, type: 'physical', accessItems: [] };
    const orders = { listForMember: vi.fn(async () => [{
      mode: 'live' as const, id: 'order-1', tenantId: 't-acme', memberId: 'm1', productId: physical.id,
      priceId: null, kind: 'one_time' as const, status: 'paid' as const, amountCents: 9900, currency: 'PLN',
      provider: 'stripe' as const, providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: clock.nowIso(),
      memberEmail: 'buyer@example.test', memberName: null, productTitle: physical.title, couponCode: null,
      lines: [{ productId: physical.id, name: physical.title, productType: 'physical' as const, grossCents: 9900, netCents: 9429, vatCents: 471, vatRate: 5 as const, vatExemptionBasis: null, issuedCount: 0 }],
    }]) };
    const products = { findByIds: vi.fn(async () => [physical]) };
    expect(await listMyProducts({ identity: identity('t-acme', 'm1') }, {
      grants: grants([], []), prices, subscriptions, downloadAssets, clock, orders, products,
    })).toMatchObject({ ok: true, value: [{ type: 'physical', downloads: [], subscription: null }] });
    expect(orders.listForMember).toHaveBeenCalledWith('t-acme', 'm1');
    expect(products.findByIds).toHaveBeenCalledWith('t-acme', [physical.id]);
  });

  it('names the parcel locker or city for physical lines of a shipped order', async () => {
    const physical: Product = { ...granted, type: 'physical', accessItems: [] };
    const pickedUp: Product = { ...physical, id: 'collected-item' };
    const line = (product: Product) => ({ productId: product.id, name: product.title, productType: 'physical' as const, grossCents: 9900, netCents: 9429, vatCents: 471, vatRate: 5 as const, vatExemptionBasis: null, issuedCount: 0 });
    const order = (id: string, lines: ReturnType<typeof line>[], shipping: OrderShipping | null) => ({
      mode: 'live' as const, id, tenantId: 't-acme', memberId: 'm1', productId: lines[0]?.productId ?? physical.id,
      priceId: null, kind: 'one_time' as const, status: 'paid' as const, amountCents: 9900, currency: 'PLN',
      provider: 'stripe' as const, providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: clock.nowIso(),
      memberEmail: 'buyer@example.test', memberName: null, productTitle: physical.title, couponCode: null, lines, shipping,
    });
    const shipping: OrderShipping = {
      rateId: 'courier', label: 'Courier', amountCents: 1999, vatRatePercent: 23, carrier: 'other', pickupPoint: null,
      address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' }, phone: null,
    };
    const run = async (shipped: OrderShipping) => listMyProducts({ identity: identity('t-acme', 'm1') }, {
      grants: grants([], []), prices, subscriptions, downloadAssets, clock,
      orders: { listForMember: async () => [order('order-shipped', [line(physical)], shipped), order('order-collected', [line(pickedUp)], null)] },
      products: { findByIds: async () => [physical, pickedUp] },
    });
    expect(await run(shipping)).toMatchObject({ ok: true, value: [{ id: physical.id, shippedTo: 'Warsaw' }, { id: pickedUp.id, shippedTo: null }] });
    expect(await run({ ...shipping, pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null } }))
      .toMatchObject({ ok: true, value: [{ id: physical.id, shippedTo: 'WAW01M' }, { id: pickedUp.id, shippedTo: null }] });
  });

  it('reports the fulfilment status and tracking link of shipped physical lines', async () => {
    const physical: Product = { ...granted, type: 'physical', accessItems: [] };
    const shipping: OrderShipping = {
      rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
      pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
      address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' }, phone: null,
    };
    const order = (fulfilment: Pick<Order, 'fulfilmentStatus' | 'shipment'>) => ({
      mode: 'live' as const, id: 'order-1', tenantId: 't-acme', memberId: 'm1', productId: physical.id,
      priceId: null, kind: 'one_time' as const, status: 'paid' as const, amountCents: 9900, currency: 'PLN',
      provider: 'stripe' as const, providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: clock.nowIso(),
      memberEmail: 'buyer@example.test', memberName: null, productTitle: physical.title, couponCode: null, shipping, ...fulfilment,
      lines: [{ productId: physical.id, name: physical.title, productType: 'physical' as const, grossCents: 9900, netCents: 9429, vatCents: 471, vatRate: 5 as const, vatExemptionBasis: null, issuedCount: 0 }],
    });
    const run = async (fulfilment: Pick<Order, 'fulfilmentStatus' | 'shipment'>) => listMyProducts({ identity: identity('t-acme', 'm1') }, {
      grants: grants([], []), prices, subscriptions, downloadAssets, clock,
      orders: { listForMember: async () => [order(fulfilment)] },
      products: { findByIds: async () => [physical] },
    });
    expect(await run({ fulfilmentStatus: 'to_pack', shipment: null })).toMatchObject({ ok: true, value: [{ fulfilment: {
      status: 'to_pack', shippedAt: null, carrier: null, trackingNumber: null, trackingUrl: null,
    } }] });
    expect(await run({ fulfilmentStatus: 'shipped', shipment: { carrier: 'inpost', trackingNumber: 'ABCD1234', shippedAt: '2026-11-05T10:00:00.000Z', shippedBy: 'staff' } }))
      .toMatchObject({ ok: true, value: [{ fulfilment: {
        status: 'shipped', shippedAt: '2026-11-05T10:00:00.000Z', carrier: 'inpost', trackingNumber: 'ABCD1234',
        trackingUrl: 'https://inpost.pl/sledzenie-przesylek?number=ABCD1234',
      } }] });
    expect(await run({ fulfilmentStatus: null, shipment: null })).toMatchObject({ ok: true, value: [{ fulfilment: null }] });
    const newest = { ...order({ fulfilmentStatus: 'to_pack', shipment: null }), id: 'order-2', shipping: { ...shipping, pickupPoint: { provider: 'inpost' as const, code: 'KRK02M', name: null, address: null } } };
    const oldest = { ...order({ fulfilmentStatus: 'shipped', shipment: { carrier: 'inpost', trackingNumber: 'ABCD1234', shippedAt: '2026-11-05T10:00:00.000Z', shippedBy: 'staff' } }), createdAt: '2026-10-01T10:00:00.000Z' };
    const repeated = await listMyProducts({ identity: identity('t-acme', 'm1') }, {
      grants: grants([], []), prices, subscriptions, downloadAssets, clock,
      orders: { listForMember: async () => [newest, oldest] },
      products: { findByIds: async () => [physical] },
    });
    expect(repeated).toMatchObject({ ok: true, value: [{ shippedTo: 'KRK02M', fulfilment: { status: 'to_pack', trackingNumber: null } }] });
  });

  it('returns the granted products for a member with an active window', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', 'member-1') }, {
      grants: grants([granted], [memberGrant()]),
      clock,
      subscriptions,
      downloadAssets,
      prices,
    });
    expect(result).toMatchObject({
      ok: true,
      value: [{
        id: 'p1',
        grantStatus: 'active',
        accessItems: [{ level: 'course', courseId: 'course-1' }],
      }],
    });
  });

  it.each([
    { published: true, hasPublicPrice: true, purchasable: true },
    { published: false, hasPublicPrice: true, purchasable: false },
    { published: true, hasPublicPrice: false, purchasable: false },
    { published: false, hasPublicPrice: false, purchasable: false },
  ])('reports renewal availability for %j', async ({ published, hasPublicPrice, purchasable }) => {
    const listActiveByProducts = vi.fn(async () => hasPublicPrice ? [publicPrice] : []);
    const result = await listMyProducts({ identity: identity('t-acme', 'member-1') }, {
      grants: grants([{ ...granted, published }], [
        memberGrant({ active: false, expiresAt: '2026-07-08T00:00:00.000Z' }),
      ]),
      clock,
      subscriptions,
      downloadAssets,
      prices: { ...prices, listActiveByProducts },
    });
    expect(result).toMatchObject({ ok: true, value: [{ grantStatus: 'expired', purchasable }] });
    expect(listActiveByProducts).toHaveBeenCalledWith('t-acme', ['p1']);
  });

  it('marks an elapsed window as expired', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', 'member-1') }, {
      grants: grants([granted], [
        memberGrant({ expiresAt: '2026-07-08T00:00:00.000Z', active: false }),
      ]),
      clock,
      subscriptions,
      downloadAssets,
      prices,
    });
    expect(result).toMatchObject({
      ok: true,
      value: [{ id: 'p1', grantStatus: 'expired', grantExpiresAt: '2026-07-08T00:00:00.000Z' }],
    });
  });

  it('marks a future window as upcoming', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', 'member-1') }, {
      grants: grants([granted], [
        memberGrant({ startsAt: '2026-07-20T00:00:00.000Z', active: false }),
      ]),
      clock,
      subscriptions,
      downloadAssets,
      prices,
    });
    expect(result).toMatchObject({
      ok: true,
      value: [{ id: 'p1', grantStatus: 'upcoming', grantStartsAt: '2026-07-20T00:00:00.000Z' }],
    });
  });

  it('prefers an active grant over an expired one for the same product', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', 'member-1') }, {
      grants: grants([granted], [
        memberGrant({ id: 'old', expiresAt: '2026-07-08T00:00:00.000Z', active: false }),
        memberGrant({ id: 'new', startsAt: '2026-07-10T00:00:00.000Z', active: true }),
      ]),
      clock,
      subscriptions,
      downloadAssets,
      prices,
    });
    expect(result).toMatchObject({ ok: true, value: [{ id: 'p1', grantStatus: 'active' }] });
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('forbids staff without a member row', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', null) }, {
      grants: grants([granted], []),
      clock,
      subscriptions,
      downloadAssets,
      prices,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a resolved tenant', async () => {
    const result = await listMyProducts({ identity: identity(null, null) }, {
      grants: grants([], []),
      clock,
      subscriptions,
      downloadAssets,
      prices,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});


it('groups the buyer downloads by lineage with newest ready versions first', async () => {
  const first: ProductDownloadAsset = {
    id: 'pdf-1', tenantId: 't-acme', productId: 'p1', lineageId: 'pdf-1', versionNumber: 1,
    versionNote: null, supersededAt: clock.nowIso(), replacesAssetId: null,
    fileName: 'book.pdf', contentType: 'application/pdf', sizeBytes: 1024,
    storageKey: 'pdf-1', status: 'ready', createdAt: clock.nowIso(),
  };
  const latest = { ...first, id: 'pdf-2', versionNumber: 2, supersededAt: null, versionNote: 'Errata', storageKey: 'pdf-2' };
  const epub = { ...first, id: 'epub', lineageId: 'epub', supersededAt: null, storageKey: 'epub' };
  const result = await listMyProducts({ identity: identity('t-acme', 'member-1') }, {
    grants: grants([{ ...granted, type: 'digital_download' }], [memberGrant()]),
    clock, subscriptions, prices,
    downloadAssets: { ...downloadAssets, listReadyByProduct: async () => [first, epub, latest] },
  });
  expect(result).toMatchObject({ ok: true, value: [{ downloads: [
    { id: 'pdf-2', versionNumber: 2, previousVersions: [first] },
    { id: 'epub', previousVersions: [] },
  ] }] });
});
