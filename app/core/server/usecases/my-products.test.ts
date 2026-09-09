import { describe, expect, it, vi } from 'vitest';

import type { Identity, MemberGrant, Product, ProductPrice } from '#core/domain/index.js';

import type { Clock } from '../ports.js';
import type { ProductGrantRepository, ProductPriceRepository } from '../ports.js';
import { listMyProducts } from './my-products.js';

const identity = (tenantId: string | null, memberId: string | null): Identity => ({
  userId: 'u1',
  email: 'buyer@together.dev',
  name: 'Buyer',
  emailVerified: true,
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
  published: true,
  accessItems: [{ level: 'course', courseId: 'course-1' }],
  legacyId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
};

const memberGrant = (overrides: Partial<MemberGrant> = {}): MemberGrant => ({
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
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
