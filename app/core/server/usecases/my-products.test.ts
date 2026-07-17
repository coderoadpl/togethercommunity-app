import { describe, expect, it } from 'vitest';

import type { Identity, MemberGrant, Product } from '@core/domain/index.js';

import type { Clock } from '../ports.js';
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
  accessItems: [],
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
    });
    expect(result).toMatchObject({
      ok: true,
      value: [{ id: 'p1', grantStatus: 'active' }],
    });
  });

  it('marks an elapsed window as expired', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', 'member-1') }, {
      grants: grants([granted], [
        memberGrant({ expiresAt: '2026-07-08T00:00:00.000Z', active: false }),
      ]),
      clock,
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
    });
    expect(result).toMatchObject({ ok: true, value: [{ id: 'p1', grantStatus: 'active' }] });
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('forbids staff without a member row', async () => {
    const result = await listMyProducts({ identity: identity('t-acme', null) }, {
      grants: grants([granted], []),
      clock,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a resolved tenant', async () => {
    const result = await listMyProducts({ identity: identity(null, null) }, {
      grants: grants([], []),
      clock,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
