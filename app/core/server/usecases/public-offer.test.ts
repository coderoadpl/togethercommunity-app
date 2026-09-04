import { describe, expect, it } from 'vitest';

import type { Course, Product, ProductType, Tenant } from '#core/domain/index.js';

import type { ConsentDefinitionRepository, ProductRepository, TenantRepository } from '../ports.js';
import { getPublicOffer } from './public-offer.js';

const tenant: Tenant = {
  id: 't-acme',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'hosted',
  contentVersion: 7,
};

const product = (
  id: string,
  tenantId: string,
  published: boolean,
  type: ProductType = 'course',
): Product => ({
  id,
  tenantId,
  type,
  slug: `${type.replaceAll('_', '-')}-${id}`,
  title: `Product ${id}`,
  description: `<p>Description ${id}</p>`,
  coverUrl: `https://cdn.test/${id}.jpg`,
  priceCents: 1000,
  currency: 'PLN',
  published,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
});

const noPrices = {
  listByProduct: async () => [],
  listActiveByProducts: async () => [],
  findById: async () => null,
  create: async () => undefined,
  setActive: async () => null,
};

const noLessons = { listPreviews: async () => [] };

const course = (id: string, publiclyVisible: boolean): Course => ({
  id,
  tenantId: 't-acme',
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  moduleOrder: [],
  publiclyVisible,
  legacyId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
});

const fakeCourses = (initial: Course[]) => ({
  list: async (tenantId: string) => initial.filter((candidate) => candidate.tenantId === tenantId),
});

const noCourses = fakeCourses([]);

const fakeTenants = (branding?: {
  logoUrl: string | null;
  logoDarkUrl: string | null;
  accentColor: string | null;
  faviconUrl: string | null;
  socialLinks?: Array<{ label: string; url: string }>;
}): TenantRepository => ({
  findById: async () => null,
  findBySlug: async () => null,
  findSole: async () => null,
  hasAny: async () => false,
  findSettings: async () =>
    branding === undefined
      ? null
      : {
          name: 'Acme',
          socialLinks: [],
          billingPortalUrl: null,
          bunnyStreamLibraryId: null,
          bunnyStreamCdnHostname: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          supportEmail: null,
          supportUrl: null,
          termsUrl: null,
          privacyUrl: null,
          defaultHomeSpaceId: null,
          ...branding,
        },
  updateSettings: async (_tenantId, next) => next,
  createTenantWithOwnerGrant: async () => {
    throw new Error('not used');
  },
});

const fakeProducts = (initial: Product[]): ProductRepository => ({
  listByTenant: async (tenantId) => initial.filter((candidate) => candidate.tenantId === tenantId),
  listPublishedByTenant: async (tenantId) =>
    initial.filter((candidate) => candidate.tenantId === tenantId && candidate.published),
  findById: async (tenantId, id) =>
    initial.find((candidate) => candidate.tenantId === tenantId && candidate.id === id) ?? null,
  create: async () => 'created',
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
});

describe('getPublicOffer', () => {
  it('returns only public product fields for published products', async () => {
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([
        product('published', 't-acme', true, 'course'),
        product('download', 't-acme', true, 'digital_download'),
        product('club', 't-acme', true, 'membership'),
        product('draft', 't-acme', false),
        product('other', 't-other', true),
      ]),
      prices: noPrices,
      lessons: noLessons,
      courses: noCourses,
      tenants: fakeTenants(),
    });

    expect(result).toEqual({
      ok: true,
      value: {
        tenant: {
          slug: 'acme',
          name: 'Acme',
          branding: { logoUrl: null, logoDarkUrl: null, accentColor: null, faviconUrl: null },
          socialLinks: [],
          legal: { termsUrl: null, privacyUrl: null },
          support: { url: null },
        },
        contentVersion: 7,
        previewLessons: [],
        products: [
          {
            id: 'published',
            type: 'course',
            slug: 'course-published',
            title: 'Product published',
            description: '<p>Description published</p>',
            coverUrl: 'https://cdn.test/published.jpg',
            priceCents: 1000,
            currency: 'PLN',
            prices: [],
            marketingConsents: [],
          },
          {
            id: 'download',
            type: 'digital_download',
            slug: 'digital-download-download',
            title: 'Product download',
            description: '<p>Description download</p>',
            coverUrl: 'https://cdn.test/download.jpg',
            priceCents: 1000,
            currency: 'PLN',
            prices: [],
            marketingConsents: [],
          },
          {
            id: 'club',
            type: 'membership',
            slug: 'membership-club',
            title: 'Product club',
            description: '<p>Description club</p>',
            coverUrl: 'https://cdn.test/club.jpg',
            priceCents: 1000,
            currency: 'PLN',
            prices: [],
            marketingConsents: [],
          },
        ],
      },
    });
  });

  it('exposes only lessons marked as free previews', async () => {
    const lessons = [{ id: 'preview', name: 'Try for free', courseId: 'course-1' }];
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([]),
      prices: noPrices,
      lessons: { listPreviews: async () => lessons },
      courses: fakeCourses([course('course-1', true)]),
      tenants: fakeTenants(),
    });

    expect(result).toMatchObject({
      ok: true,
      value: { previewLessons: [{ id: 'preview', name: 'Try for free', courseId: 'course-1' }] },
    });
  });

  it('drops previews of courses that are not publicly visible', async () => {
    const lessons = [
      { id: 'open', name: 'Open preview', courseId: 'course-public' },
      { id: 'hidden', name: 'Hidden preview', courseId: 'course-private' },
    ];
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([]),
      prices: noPrices,
      lessons: { listPreviews: async () => lessons },
      courses: fakeCourses([course('course-public', true), course('course-private', false)]),
      tenants: fakeTenants(),
    });

    expect(result).toMatchObject({
      ok: true,
      value: { previewLessons: [{ id: 'open', courseId: 'course-public' }] },
    });
  });

  it('takes a resolved tenant instead of an identity-scoped context', async () => {
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([]),
      prices: noPrices,
      lessons: noLessons,
      courses: noCourses,
      tenants: fakeTenants(),
    });

    expect(result).toMatchObject({
      ok: true,
      value: { tenant: { slug: 'acme' }, products: [] },
    });
  });

  it('exposes the tenant branding pointers to the public surface', async () => {
    const branding = {
      logoUrl: '/assets/akademia-logo.svg',
      logoDarkUrl: null,
      accentColor: '#0E7490',
      faviconUrl: '/assets/akademia-logo.svg',
    };
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([]),
      prices: noPrices,
      lessons: noLessons,
      courses: noCourses,
      tenants: fakeTenants(branding),
    });

    expect(result).toMatchObject({ ok: true, value: { tenant: { branding } } });
  });

  it('exposes the dark logo variant so clients can match the active theme', async () => {
    const branding = {
      logoUrl: '/api/public/assets/logo/light.png',
      logoDarkUrl: '/api/public/assets/logo-dark/dark.png',
      accentColor: null,
      faviconUrl: null,
    };
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([]),
      prices: noPrices,
      lessons: noLessons,
      courses: noCourses,
      tenants: fakeTenants(branding),
    });

    expect(result).toMatchObject({ ok: true, value: { tenant: { branding } } });
  });

  it('exposes social profiles to public and member clients', async () => {
    const socialLinks = [
      { label: 'Instagram', url: 'https://instagram.com/akademia' },
      { label: 'YouTube', url: 'https://youtube.com/@akademia' },
    ];
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([]),
      prices: noPrices,
      lessons: noLessons,
      courses: noCourses,
      tenants: fakeTenants({ logoUrl: null, logoDarkUrl: null, accentColor: null, faviconUrl: null, socialLinks }),
    });

    expect(result).toMatchObject({ ok: true, value: { tenant: { socialLinks } } });
  });

  it('exposes current wording for active checkout consent definitions', async () => {
    const attached = {
      ...product('published', 't-acme', true),
      checkoutConsentDefinitionIds: ['definition-news'],
    };
    const definitions: ConsentDefinitionRepository = {
      create: async () => undefined,
      findById: async () => ({
        id: 'definition-news',
        tenantId: 't-acme',
        key: 'news',
        kind: 'optional_marketing',
        channel: 'email',
        doubleOptIn: true,
        documentRef: { mode: 'url', url: 'https://acme.test/news' },
        status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
      list: async () => [],
      update: async () => null,
      appendVersion: async () => undefined,
      listVersions: async () => [
        {
          id: 'version-1',
          tenantId: 't-acme',
          definitionId: 'definition-news',
          version: 1,
          label: 'Old wording',
          documentVersionRef: { mode: 'url', url: 'https://acme.test/news-v1' },
          createdAt: '2026-07-01T00:00:00.000Z',
          createdBy: null,
        },
        {
          id: 'version-2',
          tenantId: 't-acme',
          definitionId: 'definition-news',
          version: 2,
          label: 'Current wording',
          documentVersionRef: { mode: 'url', url: 'https://acme.test/news-v2' },
          createdAt: '2026-07-02T00:00:00.000Z',
          createdBy: null,
        },
      ],
    };
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([attached]),
      prices: noPrices,
      lessons: noLessons,
      courses: noCourses,
      tenants: fakeTenants(),
      definitions,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        products: [{
          marketingConsents: [{
            definitionId: 'definition-news',
            label: 'Current wording',
            doubleOptIn: true,
            documentUrl: 'https://acme.test/news-v2',
          }],
        }],
      },
    });
  });

  it('links a hosted consent to its immutable public document version', async () => {
    const attached = {
      ...product('course', 't-acme', true),
      checkoutConsentDefinitionIds: ['definition-hosted'],
    };
    const definitions: ConsentDefinitionRepository = {
      findById: async () => ({
        id: 'definition-hosted',
        tenantId: 't-acme',
        key: 'hosted-news',
        kind: 'optional_marketing',
        channel: 'email',
        doubleOptIn: true,
        documentRef: { mode: 'hosted', documentId: 'document-news' },
        status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
      list: async () => [],
      create: async () => undefined,
      update: async () => null,
      appendVersion: async () => undefined,
      listVersions: async () => [{
        id: 'definition-version-hosted',
        tenantId: 't-acme',
        definitionId: 'definition-hosted',
        version: 1,
        label: 'Hosted checkout wording',
        documentVersionRef: { mode: 'hosted', documentVersionId: 'document-version-3' },
        createdAt: '2026-07-01T00:00:00.000Z',
        createdBy: null,
      }],
    };

    const result = await getPublicOffer(tenant, {
      products: fakeProducts([attached]),
      prices: noPrices,
      lessons: noLessons,
      courses: noCourses,
      tenants: fakeTenants(),
      definitions,
      documents: {
        findPublishedVersionById: async () => ({
          document: {
            id: 'document-news',
            tenantId: 't-acme',
            slug: 'newsletter-rules',
            title: 'Newsletter rules',
            status: 'published',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
          version: {
            id: 'document-version-3',
            tenantId: 't-acme',
            documentId: 'document-news',
            version: 3,
            content: 'Rules',
            publishedAt: '2026-07-01T00:00:00.000Z',
            createdAt: '2026-07-01T00:00:00.000Z',
            createdBy: 'owner',
          },
        }),
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        products: [{
          marketingConsents: [{
            documentUrl: '/legal/newsletter-rules/v/3',
          }],
        }],
      },
    });
  });
});
