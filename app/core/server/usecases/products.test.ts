import { describe, expect, it } from 'vitest';

import type {
  Identity,
  Product,
  ProductDownloadAsset,
  ProductPrice,
  Space,
  StaffRole,
} from '#core/domain/index.js';

import type { EntityVersionRecord, ProductMetadataRepository, ProductRepository } from '../ports.js';
import { createProduct, listProducts, publishProduct, unpublishProduct, updateProduct } from './products.js';

const identity = (tenantId: string | null, staffRole: StaffRole | null): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  emailVerified: true,
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
  const entityVersions: EntityVersionRecord[] = [];
  const repo: ProductRepository & ProductMetadataRepository = {
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
    update: async (tenantId, product, version) => {
      const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === product.id);
      if (index === -1) return null;
      store[index] = product;
      entityVersions.push(version);
      return product;
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
  return { repo, store, versions, entityVersions };
};

const deps = <T extends ProductRepository>(repo: T, ids: string[] = ['product-1']) => ({
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

const price = (productId: string): ProductPrice => ({
  id: `price-${productId}`,
  tenantId: 't-acme',
  productId,
  kind: 'one_time',
  interval: null,
  amountCents: 1000,
  currency: 'PLN',
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
});

const download = (productId: string): ProductDownloadAsset => ({
  id: `download-${productId}`,
  tenantId: 't-acme',
  productId,
  fileName: 'workbook.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
  storageKey: `product-downloads/${productId}/workbook.pdf`,
  status: 'ready',
  createdAt: '2026-07-01T00:00:00.000Z',
});

const gatedSpace = (productId: string): Space => ({
  id: `space-${productId}`,
  tenantId: 't-acme',
  slug: `space-${productId}`,
  name: `Space ${productId}`,
  description: null,
  visibility: 'product',
  productIds: [productId],
  position: 0,
  archivedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
});

const publicationDeps = (
  repo: ProductRepository,
  activePrices: ProductPrice[] = [price('p1')],
  readyDownloads: ProductDownloadAsset[] = [],
  spaces: Space[] = [],
) => ({
  products: repo,
  prices: {
    listActiveByProducts: async (tenantId: string, productIds: string[]) =>
      activePrices.filter((candidate) =>
        candidate.tenantId === tenantId && productIds.includes(candidate.productId) && candidate.active),
  },
  downloadAssets: {
    listReadyByProduct: async (tenantId: string, productId: string) =>
      readyDownloads.filter((candidate) =>
        candidate.tenantId === tenantId && candidate.productId === productId && candidate.status === 'ready'),
  },
  spaces: {
    list: async (tenantId: string) => spaces.filter((candidate) => candidate.tenantId === tenantId),
  },
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
    const publishable: Product = {
      ...draft('p1', 't-acme'),
      accessItems: [{ level: 'course', courseId: 'c1' }],
    };
    const { repo, store, versions } = fakeRepo([publishable]);
    const result = await publishProduct(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1' },
      publicationDeps(repo),
    );
    expect(result).toMatchObject({ ok: true, value: { id: 'p1', published: true } });
    expect(store[0]?.published).toBe(true);
    expect(versions.get('t-acme')).toBe(2);
  });

  it('treats publishing an already-published product as a no-op success', async () => {
    const { repo, versions } = fakeRepo([draft('p1', 't-acme', true)]);
    const result = await publishProduct(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1' },
      publicationDeps(repo, []),
    );
    expect(result).toMatchObject({ ok: true, value: { id: 'p1', published: true } });
    expect(versions.has('t-acme')).toBe(false);
  });

  it('returns not_found when publishing an unknown product', async () => {
    const { repo } = fakeRepo();
    const result = await publishProduct(
      { identity: identity('t-acme', 'owner') },
      { id: 'ghost' },
      publicationDeps(repo),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('blocks publishing without a delivery mechanism or active price', async () => {
    const noDelivery = fakeRepo([draft('p1', 't-acme')]);
    expect(await publishProduct(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1' },
      publicationDeps(noDelivery.repo),
    )).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('delivery mechanism') } });

    const withAccess: Product = {
      ...draft('p1', 't-acme'),
      accessItems: [{ level: 'course', courseId: 'c1' }],
    };
    const noPrice = fakeRepo([withAccess]);
    expect(await publishProduct(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1' },
      publicationDeps(noPrice.repo, []),
    )).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('active price') } });
  });

  it('publishes a digital product with a ready download and no course access items', async () => {
    const product: Product = { ...draft('p1', 't-acme'), type: 'digital_download' };
    const { repo } = fakeRepo([product]);

    expect(await publishProduct(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1' },
      publicationDeps(repo, [price('p1')], [download('p1')]),
    )).toMatchObject({ ok: true, value: { id: 'p1', published: true } });
  });

  it('publishes a membership delivered through a product-gated space', async () => {
    const product: Product = { ...draft('p1', 't-acme'), type: 'membership' };
    const recurringPrice: ProductPrice = {
      ...price('p1'),
      kind: 'recurring',
      interval: 'month',
    };
    const { repo } = fakeRepo([product]);

    expect(await publishProduct(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1' },
      publicationDeps(repo, [recurringPrice], [], [gatedSpace('p1')]),
    )).toMatchObject({ ok: true, value: { id: 'p1', published: true } });
  });

  it('returns a published product to draft and bumps the version', async () => {
    const { repo, store, versions } = fakeRepo([draft('p1', 't-acme', true)]);
    const result = await unpublishProduct(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1' },
      { products: repo },
    );
    expect(result).toMatchObject({ ok: true, value: { id: 'p1', published: false } });
    expect(store[0]?.published).toBe(false);
    expect(versions.get('t-acme')).toBe(2);
  });

  it('updates editable metadata, preserves the slug and snapshots the previous product', async () => {
    const { repo, store, entityVersions } = fakeRepo([draft('p1', 't-acme')]);
    const result = await updateProduct(
      { identity: identity('t-acme', 'owner') },
      {
        id: 'p1',
        title: 'Updated product',
        description: 'Updated description',
        coverUrl: 'https://cdn.test/updated.jpg',
      },
      deps(repo, ['version-1']),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        title: 'Updated product',
        description: 'Updated description',
        coverUrl: 'https://cdn.test/updated.jpg',
        slug: 'product-p1',
      },
    });
    expect(store[0]?.slug).toBe('product-p1');
    expect(entityVersions).toHaveLength(1);
    expect(entityVersions[0]).toMatchObject({ id: 'version-1', entityKind: 'product', entityId: 'p1' });
  });
});
