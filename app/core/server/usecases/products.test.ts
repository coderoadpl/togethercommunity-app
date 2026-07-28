import { describe, expect, it } from 'vitest';

import type { Identity, Product, StaffRole } from '#core/domain/index.js';

import type { ProductRepository } from '../ports.js';
import { createProduct, listProducts, publishProduct } from './products.js';

const identity = (tenantId: string | null, staffRole: StaffRole | null): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme Inc' : null,
  staffRole,
  memberId: null,
});

const fakeRepo = (initial: Product[] = []) => {
  const store = [...initial];
  const versions = new Map<string, number>();
  const repo: ProductRepository = {
    listByTenant: async (tenantId) => store.filter((p) => p.tenantId === tenantId),
    listPublishedByTenant: async (tenantId) =>
      store.filter((p) => p.tenantId === tenantId && p.published),
    findById: async (tenantId, id) =>
      store.find((p) => p.tenantId === tenantId && p.id === id) ?? null,
    create: async (_tenantId, product) => {
      store.push(product);
    },
    updateAccessItems: async (tenantId, id, accessItems) => {
      const product = store.find((p) => p.tenantId === tenantId && p.id === id);
      if (!product) return null;
      product.accessItems = accessItems;
      return product;
    },
    setPublished: async (tenantId, id, published) => {
      const product = store.find((p) => p.tenantId === tenantId && p.id === id);
      if (product) product.published = published;
    },
    bumpContentVersion: async (tenantId) => {
      versions.set(tenantId, (versions.get(tenantId) ?? 1) + 1);
    },
  };
  return { repo, store, versions };
};

const deps = (repo: ProductRepository, ids: string[] = ['product-1']) => ({
  products: repo,
  ids: {
    nextId: () => {
      const next = ids.shift();
      if (!next) throw new Error('No fake ID available');
      return next;
    },
  },
  clock: { nowIso: () => '2026-07-12T00:00:00.000Z' },
});

const draft = (id: string, tenantId: string, published = false): Product => ({
  id,
  tenantId,
  title: `Product ${id}`,
  description: '',
  priceCents: 1000,
  currency: 'PLN',
  published,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
});

describe('products use-cases', () => {
  it('lists only the tenant in ctx for staff', async () => {
    const { repo } = fakeRepo([draft('1', 't-acme'), draft('2', 't-globex')]);
    const result = await listProducts({ identity: identity('t-acme', 'owner') }, deps(repo));
    expect(result.ok && result.value.map((p) => p.id)).toEqual(['1']);
  });

  it('refuses to operate without a tenant', async () => {
    const { repo } = fakeRepo();
    const listed = await listProducts({ identity: identity(null, null) }, deps(repo));
    expect(listed).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('forbids non-staff members from listing or creating', async () => {
    const { repo } = fakeRepo([draft('1', 't-acme')]);
    const listed = await listProducts({ identity: identity('t-acme', null) }, deps(repo));
    expect(listed).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const created = await createProduct(
      { identity: identity('t-acme', null) },
      { title: 'Course', priceCents: 100 },
      deps(repo),
    );
    expect(created).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('enforces the declared product capability independently for reads and writes', async () => {
    const { repo } = fakeRepo([draft('1', 't-acme')]);
    const ctx = {
      identity: identity('t-acme', 'owner'),
      capabilities: ['product:read'] as const,
    };
    expect(await listProducts(ctx, deps(repo))).toMatchObject({ ok: true });
    expect(await createProduct(ctx, { title: 'Course', priceCents: 100 }, deps(repo))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('validates input and stamps tenant + defaults on draft create', async () => {
    const { repo, store, versions } = fakeRepo();

    const invalid = await createProduct(
      { identity: identity('t-acme', 'admin') },
      { title: '  ', priceCents: 100 },
      deps(repo),
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });

    const created = await createProduct(
      { identity: identity('t-acme', 'owner') },
      { title: 'Course', priceCents: 4900 },
      deps(repo),
    );
    expect(created).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', title: 'Course', priceCents: 4900, currency: 'PLN', published: false },
    });
    expect(store).toHaveLength(1);
    expect(versions.has('t-acme')).toBe(false);
  });

  it('publishes a draft product and bumps the version', async () => {
    const { repo, store, versions } = fakeRepo([draft('p1', 't-acme')]);
    const result = await publishProduct({ identity: identity('t-acme', 'owner') }, { id: 'p1' }, deps(repo));
    expect(result).toMatchObject({ ok: true, value: { id: 'p1', published: true } });
    expect(store[0]?.published).toBe(true);
    expect(versions.get('t-acme')).toBe(2);
  });

  it('treats publishing an already-published product as a no-op success', async () => {
    const { repo, versions } = fakeRepo([draft('p1', 't-acme', true)]);
    const result = await publishProduct({ identity: identity('t-acme', 'owner') }, { id: 'p1' }, deps(repo));
    expect(result).toMatchObject({ ok: true, value: { id: 'p1', published: true } });
    expect(versions.has('t-acme')).toBe(false);
  });

  it('returns not_found when publishing an unknown product', async () => {
    const { repo } = fakeRepo();
    const result = await publishProduct({ identity: identity('t-acme', 'owner') }, { id: 'ghost' }, deps(repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
