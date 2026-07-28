import { describe, expect, it } from 'vitest';

import type { Member, Product, ProductGrant } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  IdGenerator,
  MemberRepository,
  ProductGrantRepository,
  ProductRepository,
} from '../ports.js';
import {
  grantProductToMember,
  listMemberGrants,
  revokeGrant,
  type GrantProductToMemberDeps,
  type MemberGrantsDeps,
  type RevokeGrantDeps,
} from './grants.js';

const NOW = '2026-06-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2026-12-01T00:00:00.000Z';
const NEW_EXPIRY = '2027-06-01T00:00:00.000Z';

const staff = (tenantId: string | null): Ctx => ({
  identity: {
    userId: 'u-staff',
    email: 'owner@together.dev',
    name: 'Owner',
    tenantId,
    tenantSlug: tenantId ? 'acme' : null,
    tenantName: tenantId ? 'Acme' : null,
    staffRole: tenantId ? 'owner' : null,
    memberId: null,
  },
});

const plainMember = (tenantId: string): Ctx => ({
  identity: {
    userId: 'u-member',
    email: 'buyer@together.dev',
    name: 'Buyer',
    tenantId,
    tenantSlug: 'acme',
    tenantName: 'Acme',
    staffRole: null,
    memberId: 'member-1',
  },
});

const member = (id: string, tenantId: string): Member => ({
  id,
  tenantId,
  userId: `u-${id}`,
  email: `${id}@together.dev`,
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: PAST,
  deletedAt: null,
});

const product = (id: string, tenantId: string): Product => ({
  id,
  tenantId,
  title: `Product ${id}`,
  description: '',
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: PAST,
});

const grantRow = (overrides: Partial<ProductGrant> & { id: string }): ProductGrant => ({
  tenantId: 't-acme',
  memberId: 'm1',
  productId: 'p1',
  source: 'manual',
  startsAt: PAST,
  expiresAt: FUTURE,
  legacyId: null,
  createdAt: PAST,
  ...overrides,
});

interface Harness {
  grants: ProductGrant[];
  deps: GrantProductToMemberDeps & RevokeGrantDeps & MemberGrantsDeps;
}

const harness = (options: { members?: Member[]; products?: Product[]; grants?: ProductGrant[] }): Harness => {
  const members = options.members ?? [];
  const products = options.products ?? [];
  const grants = options.grants ? [...options.grants] : [];
  let seq = 0;

  const membersRepo: MemberRepository = {
    findById: async (tenantId, id) => members.find((m) => m.tenantId === tenantId && m.id === id) ?? null,
    findByEmail: async () => null,
    listWithProductIds: async () => [],
    create: async () => undefined,
    updateEmail: async () => null,
  };

  const productsRepo: ProductRepository = {
    listByTenant: async () => products,
    listPublishedByTenant: async () => products.filter((p) => p.published),
    findById: async (tenantId, id) => products.find((p) => p.tenantId === tenantId && p.id === id) ?? null,
    create: async () => undefined,
    updateAccessItems: async () => null,
    setPublished: async () => undefined,
    bumpContentVersion: async () => undefined,
  };

  const grantsRepo: ProductGrantRepository = {
    findById: async (tenantId, id) => grants.find((g) => g.tenantId === tenantId && g.id === id) ?? null,
    findGrant: async (tenantId, memberId, productId) =>
      grants.find((g) => g.tenantId === tenantId && g.memberId === memberId && g.productId === productId) ?? null,
    createGrant: async (_t, grant) => {
      grants.push(grant);
      return true;
    },
    setGrantWindow: async (tenantId, grantId, window) => {
      const grant = grants.find((g) => g.tenantId === tenantId && g.id === grantId);
      if (!grant) return null;
      grant.startsAt = window.startsAt;
      grant.expiresAt = window.expiresAt;
      return grant;
    },
    revokeGrant: async (tenantId, grantId, expiresAt) => {
      const grant = grants.find((g) => g.tenantId === tenantId && g.id === grantId);
      if (!grant) return null;
      grant.expiresAt = expiresAt;
      return grant;
    },
    listForMemberWithProductNames: async (tenantId, memberId, now) =>
      grants
        .filter((g) => g.tenantId === tenantId && g.memberId === memberId)
        .map((g) => ({
          id: g.id,
          productId: g.productId,
          productName: products.find((p) => p.id === g.productId)?.title ?? 'unknown',
          startsAt: g.startsAt,
          expiresAt: g.expiresAt,
          source: g.source,
          active: g.startsAt <= now && (g.expiresAt === null || g.expiresAt >= now),
        })),
    listActiveForMember: async () => [],
    listGrantedProducts: async () => [],
  };

  const ids: IdGenerator = { nextId: () => `grant-${(seq += 1)}` };
  const clock: Clock = { nowIso: () => NOW };

  return {
    grants,
    deps: { members: membersRepo, products: productsRepo, grants: grantsRepo, ids, clock },
  };
};

describe('listMemberGrants', () => {
  it('returns grants with product name and active flag', async () => {
    const h = harness({
      members: [member('m1', 't-acme')],
      products: [product('p1', 't-acme')],
      grants: [grantRow({ id: 'g1' }), grantRow({ id: 'g2', productId: 'p1', expiresAt: PAST })],
    });
    const result = await listMemberGrants(staff('t-acme'), 'm1', h.deps);
    expect(result).toMatchObject({
      ok: true,
      value: [
        { id: 'g1', productName: 'Product p1', active: true },
        { id: 'g2', active: false },
      ],
    });
  });

  it('forbids a plain member identity', async () => {
    const h = harness({ members: [member('m1', 't-acme')] });
    const result = await listMemberGrants(plainMember('t-acme'), 'm1', h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('is not found for a member of another tenant', async () => {
    const h = harness({ members: [member('m1', 't-globex')] });
    const result = await listMemberGrants(staff('t-acme'), 'm1', h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('grantProductToMember', () => {
  it('creates a grant starting now when none exists', async () => {
    const h = harness({ members: [member('m1', 't-acme')], products: [product('p1', 't-acme')] });
    const result = await grantProductToMember(staff('t-acme'), { memberId: 'm1', productId: 'p1', expiresAt: NEW_EXPIRY }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { memberId: 'm1', renewed: false } });
    expect(h.grants).toHaveLength(1);
    expect(h.grants[0]?.startsAt).toBe(NOW);
    expect(h.grants[0]?.expiresAt).toBe(NEW_EXPIRY);
    expect(h.grants[0]?.source).toBe('manual');
  });

  it('renews an active grant by extending expiry and keeping startsAt (shared window semantics)', async () => {
    const h = harness({
      members: [member('m1', 't-acme')],
      products: [product('p1', 't-acme')],
      grants: [grantRow({ id: 'g1' })],
    });
    const result = await grantProductToMember(staff('t-acme'), { memberId: 'm1', productId: 'p1', expiresAt: NEW_EXPIRY }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { renewed: true, grantId: 'g1' } });
    expect(h.grants).toHaveLength(1);
    expect(h.grants[0]?.startsAt).toBe(PAST);
    expect(h.grants[0]?.expiresAt).toBe(NEW_EXPIRY);
  });

  it('resets the window to now when the existing grant is expired', async () => {
    const h = harness({
      members: [member('m1', 't-acme')],
      products: [product('p1', 't-acme')],
      grants: [grantRow({ id: 'g1', expiresAt: PAST })],
    });
    const result = await grantProductToMember(staff('t-acme'), { memberId: 'm1', productId: 'p1', expiresAt: NEW_EXPIRY }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { renewed: false, grantId: 'g1' } });
    expect(h.grants[0]?.startsAt).toBe(NOW);
    expect(h.grants[0]?.expiresAt).toBe(NEW_EXPIRY);
  });

  it('is not found for a member of another tenant', async () => {
    const h = harness({ members: [member('m1', 't-globex')], products: [product('p1', 't-acme')] });
    const result = await grantProductToMember(staff('t-acme'), { memberId: 'm1', productId: 'p1' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('is not found for a product of another tenant', async () => {
    const h = harness({ members: [member('m1', 't-acme')], products: [product('p1', 't-globex')] });
    const result = await grantProductToMember(staff('t-acme'), { memberId: 'm1', productId: 'p1' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('forbids a plain member identity', async () => {
    const h = harness({ members: [member('m1', 't-acme')], products: [product('p1', 't-acme')] });
    const result = await grantProductToMember(plainMember('t-acme'), { memberId: 'm1', productId: 'p1' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('revokeGrant', () => {
  it('sets expiresAt to now, mirroring cancelEnrollment', async () => {
    const h = harness({ grants: [grantRow({ id: 'g1' })] });
    const result = await revokeGrant(staff('t-acme'), { grantId: 'g1' }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { grantId: 'g1', expiresAt: NOW } });
    expect(h.grants[0]?.expiresAt).toBe(NOW);
  });

  it('is not found for a grant of another tenant', async () => {
    const h = harness({ grants: [grantRow({ id: 'g1', tenantId: 't-globex' })] });
    const result = await revokeGrant(staff('t-acme'), { grantId: 'g1' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('forbids a plain member identity', async () => {
    const h = harness({ grants: [grantRow({ id: 'g1' })] });
    const result = await revokeGrant(plainMember('t-acme'), { grantId: 'g1' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
