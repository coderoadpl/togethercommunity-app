import { describe, expect, it } from 'vitest';

import type { Product, Tenant } from '@core/domain/index.js';

import type { ProductRepository, TenantRepository } from '../ports.js';
import { getPublicOffer } from './public-offer.js';

const tenant: Tenant = {
  id: 't-acme',
  slug: 'acme',
  name: 'Acme',
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
  findSettings: async () =>
    branding === undefined
      ? null
      : { billingPortalUrl: null, bunnyStreamLibraryId: null, termsUrl: null, privacyUrl: null, ...branding },
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
});
