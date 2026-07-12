import { describe, expect, it } from 'vitest';

import type { Product, Tenant } from '@core/domain/index.js';

import type { ProductRepository } from '../ports.js';
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
  createdAt: '2026-07-12T00:00:00.000Z',
});

const fakeProducts = (initial: Product[]): ProductRepository => ({
  listByTenant: async (tenantId) => initial.filter((candidate) => candidate.tenantId === tenantId),
  listPublishedByTenant: async (tenantId) =>
    initial.filter((candidate) => candidate.tenantId === tenantId && candidate.published),
  findById: async (tenantId, id) =>
    initial.find((candidate) => candidate.tenantId === tenantId && candidate.id === id) ?? null,
  create: async () => undefined,
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
    });

    expect(result).toEqual({
      ok: true,
      value: {
        tenant: { slug: 'acme', name: 'Acme' },
        contentVersion: 7,
        products: [
          {
            id: 'published',
            title: 'Product published',
            description: 'Description published',
            priceCents: 1000,
            currency: 'PLN',
          },
        ],
      },
    });
  });

  it('takes a resolved tenant instead of an identity-scoped context', async () => {
    const result = await getPublicOffer(tenant, { products: fakeProducts([]) });

    expect(result).toMatchObject({
      ok: true,
      value: { tenant: { slug: 'acme' }, products: [] },
    });
  });
});
