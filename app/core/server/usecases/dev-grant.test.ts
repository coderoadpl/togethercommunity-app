import { describe, expect, it } from 'vitest';

import type { Member, Product, ProductGrant } from '#core/domain/index.js';

import type {
  AuthPort,
  Clock,
  IdGenerator,
  MemberRepository,
  ProductGrantRepository,
  ProductRepository,
} from '../ports.js';
import { devGrantProduct, type DevGrantDeps } from './dev-grant.js';

const NOW = '2026-06-01T00:00:00.000Z';

const product = (id: string): Product => ({
  id,
  tenantId: 't1',
  type: 'course',
  slug: id,
  title: `Product ${id}`,
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const member = (id: string, email: string): Member => ({
  id,
  tenantId: 't1',
  userId: `u-${id}`,
  email,
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
    dmOptOutAt: null,
});

interface Harness {
  deps: DevGrantDeps;
  grants: ProductGrant[];
}

const harness = (options: { products: Product[]; existingMember?: Member }): Harness => {
  const grants: ProductGrant[] = [];
  const members: Member[] = options.existingMember ? [options.existingMember] : [];
  let seq = 0;

  const productsRepo: ProductRepository = {
    listByTenant: async () => options.products,
    listPublishedByTenant: async () => options.products,
    findById: async (_t, id) => options.products.find((p) => p.id === id) ?? null,
    create: async () => 'created',
    updateAccessItems: async () => null,
    setPublished: async () => undefined,
    bumpContentVersion: async () => undefined,
  };
  const membersRepo: MemberRepository = {
    findById: async (_t, id) => members.find((m) => m.id === id) ?? null,
    findByEmail: async (_t, email) => members.find((m) => m.email === email) ?? null,
    listWithProductIds: async () => [],
    create: async (_t, m) => {
      members.push(m);
    },
    updateEmail: async () => null,
    updateDisplayName: async () => null,
    updateDmOptOut: async () => null,
  setBanned: async () => null,
  };
  const grantsRepo: ProductGrantRepository = {
    findById: async (_t, id) => grants.find((g) => g.id === id) ?? null,
    findGrant: async () => null,
    createGrant: async (_t, grant) => {
      if (grants.some((g) => g.memberId === grant.memberId && g.productId === grant.productId)) return false;
      grants.push(grant);
      return true;
    },
    setGrantWindow: async () => null,
    revokeGrant: async () => null,
    listForMemberWithProductNames: async () => [],
    listActiveForMember: async () => [],
    listGrantedProducts: async () => [],
  };
  const authPort: AuthPort = {
    getAuthenticatedUser: async () => null,
    ensureUser: async () => ({ userId: 'u-new', created: true }),
    requestMagicLink: async () => undefined,
    createEnrollmentMagicLink: async () => ({ url: 'https://example.com/magic' }),
  };
  const ids: IdGenerator = { nextId: () => `id-${(seq += 1)}` };
  const clock: Clock = { nowIso: () => NOW };

  return {
    grants,
    deps: { products: productsRepo, grants: grantsRepo, members: membersRepo, authPort, ids, clock },
  };
};

describe('devGrantProduct', () => {
  it('creates a time-boxed grant for an existing member', async () => {
    const past = '2026-01-01T00:00:00.000Z';
    const h = harness({ products: [product('p1')], existingMember: member('m1', 'buyer@together.dev') });
    const result = await devGrantProduct('t1', { email: 'buyer@together.dev', productId: 'p1', expiresAt: past }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { memberId: 'm1', productId: 'p1', granted: true, expiresAt: past } });
    expect(h.grants).toHaveLength(1);
    expect(h.grants[0]?.expiresAt).toBe(past);
    expect(h.grants[0]?.source).toBe('manual');
  });

  it('defaults to a perpetual grant when no expiry is given', async () => {
    const h = harness({ products: [product('p1')], existingMember: member('m1', 'buyer@together.dev') });
    const result = await devGrantProduct('t1', { email: 'buyer@together.dev', productId: 'p1' }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { expiresAt: null } });
    expect(h.grants[0]?.startsAt).toBe(NOW);
  });

  it('creates the member on the fly when absent', async () => {
    const h = harness({ products: [product('p1')] });
    const result = await devGrantProduct('t1', { email: 'fresh@together.dev', productId: 'p1' }, h.deps);
    expect(result.ok).toBe(true);
    expect(h.grants).toHaveLength(1);
  });

  it('is idempotent for a member who already holds the grant', async () => {
    const h = harness({ products: [product('p1')], existingMember: member('m1', 'buyer@together.dev') });
    await devGrantProduct('t1', { email: 'buyer@together.dev', productId: 'p1' }, h.deps);
    const again = await devGrantProduct('t1', { email: 'buyer@together.dev', productId: 'p1' }, h.deps);
    expect(again).toMatchObject({ ok: true, value: { granted: false } });
    expect(h.grants).toHaveLength(1);
  });

  it('is not found for an unknown product', async () => {
    const h = harness({ products: [] });
    const result = await devGrantProduct('t1', { email: 'buyer@together.dev', productId: 'ghost' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
