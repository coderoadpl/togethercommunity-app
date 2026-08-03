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
memberBannedAt: null,
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
    create: async (tenantId, product) => {
      if (store.some((candidate) => candidate.tenantId === tenantId && candidate.slug === product.slug)) {
        return 'slug_taken';
      }
      store.push(product);
      return 'created';
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
  type: 'course',
  slug: `product-${id}`,
  title: `Product ${id}`,
  description: '',
  coverUrl: null,
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
      value: {
        tenantId: 't-acme',
        type: 'course',
        slug: 'course',
        title: 'Course',
        description: '',
        coverUrl: null,
        priceCents: 4900,
        currency: 'PLN',
        published: false,
      },
    });
    expect(store).toHaveLength(1);
    expect(versions.has('t-acme')).toBe(false);
  });

  it('creates every product type and rejects a tenant-local duplicate slug', async () => {
    const { repo, store } = fakeRepo();
    const createDeps = deps(repo, ['course-id', 'download-id', 'membership-id', 'duplicate-id']);

    for (const [type, slug] of [
      ['course', 'video-course'],
      ['digital_download', 'workbook'],
      ['membership', 'creator-club'],
    ] as const) {
      expect(await createProduct(
        { identity: identity('t-acme', 'owner') },
        { type, slug, title: slug, description: '<p>Rich description</p>', coverUrl: 'https://cdn.test/cover.jpg', priceCents: 0 },
        createDeps,
      )).toMatchObject({ ok: true, value: { type, slug } });
    }

    expect(store.map(({ type, slug }) => ({ type, slug }))).toEqual([
      { type: 'course', slug: 'video-course' },
      { type: 'digital_download', slug: 'workbook' },
      { type: 'membership', slug: 'creator-club' },
    ]);
    expect(await createProduct(
      { identity: identity('t-acme', 'owner') },
      { type: 'course', slug: 'workbook', title: 'Duplicate', priceCents: 0 },
      createDeps,
    )).toMatchObject({ ok: false, error: { code: 'slug_reserved' } });
  });

  it('maps an atomic duplicate insert to the slug-specific error', async () => {
    const { repo } = fakeRepo();
    repo.create = async () => 'slug_taken';

    expect(await createProduct(
      { identity: identity('t-acme', 'owner') },
      { title: 'Same title', priceCents: 0 },
      deps(repo),
    )).toMatchObject({ ok: false, error: { code: 'slug_reserved' } });
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
