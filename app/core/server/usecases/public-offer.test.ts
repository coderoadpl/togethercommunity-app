import { describe, expect, it } from 'vitest';

import type { Product, Tenant } from '#core/domain/index.js';

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

const product = (id: string, tenantId: string, published: boolean): Product => ({
  id,
  tenantId,
  title: `Product ${id}`,
  description: `Description ${id}`,
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

const fakeTenants = (branding?: {
  logoUrl: string | null;
  accentColor: string | null;
  faviconUrl: string | null;
}): TenantRepository => ({
  findById: async () => null,
  findBySlug: async () => null,
  findSole: async () => null,
  findSettings: async () =>
    branding === undefined
      ? null
      : {
          billingPortalUrl: null,
          bunnyStreamLibraryId: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          supportEmail: null,
          supportUrl: null,
          termsUrl: null,
          privacyUrl: null,
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
  create: async () => undefined,
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
});

describe('getPublicOffer', () => {
  it('returns only public product fields for published products', async () => {
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([
        product('published', 't-acme', true),
        product('draft', 't-acme', false),
        product('other', 't-other', true),
      ]),
      prices: noPrices,
      tenants: fakeTenants(),
    });

    expect(result).toEqual({
      ok: true,
      value: {
        tenant: {
          slug: 'acme',
          name: 'Acme',
          branding: { logoUrl: null, accentColor: null, faviconUrl: null },
          legal: { termsUrl: null, privacyUrl: null },
          support: { url: null },
        },
        contentVersion: 7,
        products: [
          {
            id: 'published',
            title: 'Product published',
            description: 'Description published',
            priceCents: 1000,
            currency: 'PLN',
            prices: [],
            marketingConsents: [],
          },
        ],
      },
    });
  });

  it('takes a resolved tenant instead of an identity-scoped context', async () => {
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([]),
      prices: noPrices,
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
      accentColor: '#0E7490',
      faviconUrl: '/assets/akademia-logo.svg',
    };
    const result = await getPublicOffer(tenant, {
      products: fakeProducts([]),
      prices: noPrices,
      tenants: fakeTenants(branding),
    });

    expect(result).toMatchObject({ ok: true, value: { tenant: { branding } } });
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
