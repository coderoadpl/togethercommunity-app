import { describe, expect, it } from 'vitest';

import type { Identity, Product } from '@core/domain/index.js';

import type { ProductGrantRepository } from '../ports.js';
import { listMyProducts } from './my-products.js';

const identity = (tenantId: string | null, memberId: string | null): Identity => ({
  userId: 'u1',
  email: 'buyer@together.dev',
  name: 'Buyer',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme' : null,
  staffRole: null,
  memberId,
});

const granted: Product = {
  id: 'p1',
  tenantId: 't-acme',
  title: 'Granted Course',
  description: 'A course you own',
  priceCents: 9900,
  currency: 'PLN',
  published: true,
  createdAt: '2026-07-12T00:00:00.000Z',
};

const grants = (products: Product[]): ProductGrantRepository => ({
  findGrant: async () => null,
  createGrant: async () => undefined,
  listGrantedProducts: async () => products,
});

describe('listMyProducts', () => {
  it('returns the granted products for a member', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', 'member-1') }, {
      grants: grants([granted]),
    });
    expect(result).toMatchObject({ ok: true, value: [{ id: 'p1' }] });
  });

  it('forbids staff without a member row', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', null) }, {
      grants: grants([granted]),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a resolved tenant', async () => {
    const result = await listMyProducts({ identity: identity(null, null) }, {
      grants: grants([]),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
