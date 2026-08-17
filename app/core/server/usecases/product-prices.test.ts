import { describe, expect, it } from 'vitest';

import type { Identity, Product, ProductPrice } from '#core/domain/index.js';

import type { ProductPriceDeps } from './product-prices.js';
import { createProductPrice, deactivateProductPrice, listProductPrices } from './product-prices.js';

const identity = (staffRole: 'owner' | 'admin' | null): Identity => ({
  userId: 'u1',
  email: 'owner@together.dev',
  name: 'Owner',
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole,
  memberId: null,
image: null,
memberDisplayName: null,
memberBannedAt: null,
memberDmOptOutAt: null,
});

const product: Product = {
  id: 'p1',
  tenantId: 't1',
  type: 'course',
  slug: 'course',
  title: 'Course',
  description: '',
  coverUrl: null,
  priceCents: 9900,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const harness = () => {
  const prices: ProductPrice[] = [];
  let sequence = 0;
  const deps: ProductPriceDeps = {
    products: {
      listByTenant: async () => [product],
      listPublishedByTenant: async () => [product],
      findById: async (tenantId, id) => (tenantId === 't1' && id === 'p1' ? product : null),
      create: async () => 'created',
      updateAccessItems: async () => null,
      setPublished: async () => undefined,
      bumpContentVersion: async () => undefined,
    },
    prices: {
      listByProduct: async (_tenantId, productId) => prices.filter((price) => price.productId === productId),
      listActiveByProducts: async () => prices.filter((price) => price.active),
      findById: async (_tenantId, id) => prices.find((price) => price.id === id) ?? null,
      create: async (_tenantId, price) => {
        prices.push(price);
      },
      setActive: async (_tenantId, id, active) => {
        const price = prices.find((candidate) => candidate.id === id);
        if (!price) return null;
        price.active = active;
        return price;
      },
    },
    ids: { nextId: () => `price-${++sequence}` },
    clock: { nowIso: () => '2026-07-14T10:00:00.000Z' },
  };
  return { deps, prices };
};

describe('createProductPrice', () => {
  it('creates an active recurring price with its interval', async () => {
    const h = harness();
    const result = await createProductPrice(
      { identity: identity('owner') },
      { productId: 'p1', kind: 'recurring', interval: 'month', amountCents: 2900 },
      h.deps,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'recurring', interval: 'month', amountCents: 2900, currency: 'PLN', active: true },
    });
    expect(h.prices).toHaveLength(1);
  });

  it('rejects a recurring price without an interval', async () => {
    const h = harness();
    const result = await createProductPrice(
      { identity: identity('owner') },
      { productId: 'p1', kind: 'recurring', amountCents: 2900 },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.prices).toHaveLength(0);
  });

  it('rejects a one-time price with an interval', async () => {
    const h = harness();
    const result = await createProductPrice(
      { identity: identity('owner') },
      { productId: 'p1', kind: 'one_time', interval: 'year', amountCents: 2900 },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects a one-time price for a membership', async () => {
    const h = harness();
    h.deps.products.findById = async () => ({ ...product, type: 'membership' });
    const result = await createProductPrice(
      { identity: identity('owner') },
      { productId: 'p1', kind: 'one_time', amountCents: 2900 },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.prices).toHaveLength(0);
  });

  it('is not found for a product outside the tenant', async () => {
    const h = harness();
    const result = await createProductPrice(
      { identity: identity('owner') },
      { productId: 'p-other', kind: 'one_time', amountCents: 100 },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('is forbidden for non-staff', async () => {
    const h = harness();
    const result = await createProductPrice(
      { identity: identity(null) },
      { productId: 'p1', kind: 'one_time', amountCents: 100 },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('listProductPrices / deactivateProductPrice', () => {
  it('lists prices and deactivates one in place', async () => {
    const h = harness();
    await createProductPrice(
      { identity: identity('admin') },
      { productId: 'p1', kind: 'one_time', amountCents: 9900 },
      h.deps,
    );
    const listed = await listProductPrices({ identity: identity('admin') }, 'p1', h.deps);
    expect(listed).toMatchObject({ ok: true });
    if (listed.ok) expect(listed.value).toHaveLength(1);

    const deactivated = await deactivateProductPrice({ identity: identity('admin') }, { id: 'price-1' }, h.deps);
    expect(deactivated).toMatchObject({ ok: true, value: { active: false } });
  });

  it('is not found when deactivating an unknown price', async () => {
    const h = harness();
    const result = await deactivateProductPrice({ identity: identity('owner') }, { id: 'nope' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
