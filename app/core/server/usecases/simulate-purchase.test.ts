import { describe, expect, it } from 'vitest';

import type { Member, Product, ProductGrant } from '@core/domain/index.js';

import type { AuthPort, ProductRepository, PurchaseRepository } from '../ports.js';
import { simulatePurchase, type SimulatePurchaseDeps } from './simulate-purchase.js';

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
  listByTenant: async (tenantId) => initial.filter((p) => p.tenantId === tenantId),
  listPublishedByTenant: async (tenantId) =>
    initial.filter((p) => p.tenantId === tenantId && p.published),
  findById: async (tenantId, id) =>
    initial.find((p) => p.tenantId === tenantId && p.id === id) ?? null,
  create: async () => undefined,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
});

const fakePurchases = () => {
  const store: Member[] = [];
  const grants: ProductGrant[] = [];
  const repo: PurchaseRepository = {
    createMemberGrant: async (input) => {
      let member = store.find((m) => m.tenantId === input.tenantId && m.userId === input.userId);
      if (!member) {
        member = {
          id: input.memberId,
          tenantId: input.tenantId,
          userId: input.userId,
          email: input.email,
          displayName: null,
          createdAt: input.createdAt,
        };
        store.push(member);
      }
      const existingGrant = grants.find(
        (g) =>
          g.tenantId === input.tenantId &&
          g.memberId === member.id &&
          g.productId === input.productId,
      );
      if (existingGrant) return { member, grantCreated: false };
      grants.push({
        id: input.grantId,
        tenantId: input.tenantId,
        memberId: member.id,
        productId: input.productId,
        source: 'simulated',
        createdAt: input.createdAt,
      });
      return { member, grantCreated: true };
    },
  };
  return { repo, members: store, grants };
};

const fakeAuth = (): AuthPort => ({
  getAuthenticatedUser: async () => null,
  ensureUser: async () => ({ userId: 'user-1', created: true }),
  requestMagicLink: async () => undefined,
});

const seqIds = (ids: string[]): { nextId: () => string } => ({
  nextId: () => {
    const next = ids.shift();
    if (!next) throw new Error('No fake ID available');
    return next;
  },
});

const deps = (
  products: ProductRepository,
  purchases: PurchaseRepository,
  ids: string[],
): SimulatePurchaseDeps => ({
  products,
  purchases,
  authPort: fakeAuth(),
  ids: seqIds(ids),
  clock: { nowIso: () => '2026-07-12T00:00:00.000Z' },
});

describe('simulatePurchase', () => {
  it('provisions exactly one member and one grant when run twice', async () => {
    const products = fakeProducts([product('p1', 't-acme', true)]);
    const purchases = fakePurchases();
    const d = deps(products, purchases.repo, ['member-1', 'grant-1', 'member-2', 'grant-2']);

    const first = await simulatePurchase('t-acme', 'buyer@together.dev', 'p1', d);
    expect(first).toMatchObject({ ok: true, value: { alreadyOwned: false } });

    const second = await simulatePurchase('t-acme', 'buyer@together.dev', 'p1', d);
    expect(second).toMatchObject({ ok: true, value: { alreadyOwned: true } });

    expect(purchases.members).toHaveLength(1);
    expect(purchases.grants).toHaveLength(1);
    expect(first.ok && second.ok && first.value.memberId).toBe(
      second.ok ? second.value.memberId : '',
    );
  });

  it('returns not_found for an unpublished product', async () => {
    const products = fakeProducts([product('p1', 't-acme', false)]);
    const purchases = fakePurchases();

    const result = await simulatePurchase(
      't-acme',
      'buyer@together.dev',
      'p1',
      deps(products, purchases.repo, ['member-1', 'grant-1']),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(purchases.members).toHaveLength(0);
  });

  it('returns not_found for a product owned by another tenant', async () => {
    const products = fakeProducts([product('p1', 't-other', true)]);
    const purchases = fakePurchases();

    const result = await simulatePurchase(
      't-acme',
      'buyer@together.dev',
      'p1',
      deps(products, purchases.repo, ['member-1', 'grant-1']),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
