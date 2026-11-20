import { describe, expect, it, vi } from 'vitest';

import {
  memberTombstone,
  type Identity,
  type Member,
  type MemberSubscription,
  type ProductGrant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { EntitlementSubjectReader } from '../ports.js';
import { checkEntitlements, type EntitlementCheckDeps } from './entitlement-check.js';

const NOW = '2026-11-20T12:00:00.000Z';
const TENANT_ID = 't-acme';

const ownerIdentity: Identity = {
  userId: 'user-owner',
  email: 'owner@acme.example',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantAccess: 'staff',
  tenantId: TENANT_ID,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: null,
};

const keyCtx = (capabilities: Ctx['capabilities'] = ['entitlement:check']): Ctx => ({
  identity: ownerIdentity,
  capabilities,
  machineActor: { kind: 'entitlement_key', apiKeyId: 'ek-1' },
});

const member = (id: string, userId: string, overrides: Partial<Member> = {}): Member => ({
  id,
  tenantId: TENANT_ID,
  userId,
  email: `${id}@example.test`,
  displayName: `Person ${id}`,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
  dmOptOutAt: null,
  ...overrides,
});

const grant = (memberId: string, productId: string, overrides: Partial<ProductGrant> = {}): ProductGrant => ({
  mode: 'live',
  id: `grant-${memberId}-${productId}`,
  tenantId: TENANT_ID,
  memberId,
  productId,
  source: 'stripe',
  startsAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const subscription = (memberId: string, productId: string, overrides: Partial<MemberSubscription> = {}): MemberSubscription => ({
  mode: 'live',
  id: `sub-${memberId}-${productId}`,
  tenantId: TENANT_ID,
  memberId,
  productId,
  priceId: 'price-monthly',
  provider: 'stripe',
  providerSubscriptionId: 'sub_provider',
  status: 'active',
  currentPeriodEnd: '2026-12-20T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  couponId: null,
  couponDiscountCents: 0,
  couponRecurringDuration: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

interface PaidOrder {
  memberId: string;
  productIds: string[];
  status: 'paid' | 'refunded' | 'partially_refunded' | 'pending';
  cancelled?: boolean;
  mode?: 'live' | 'test';
  kind?: 'one_time' | 'recurring';
  provider?: 'stripe' | 'simulated';
  subscriptionId?: string;
}

interface World {
  accounts: { email: string; userId: string; emailVerified: boolean }[];
  members: Member[];
  grants: ProductGrant[];
  subscriptions: MemberSubscription[];
  signedIn?: string[];
  orders?: PaidOrder[];
}

const isActive = (row: ProductGrant, now: string): boolean =>
  row.mode === 'live' && row.startsAt <= now && (row.expiresAt === null || row.expiresAt >= now);

const harness = (world: Partial<World> = {}) => {
  const state: World = { accounts: [], members: [], grants: [], subscriptions: [], ...world };
  const reader: EntitlementSubjectReader = {
    findAccountByEmail: vi.fn(async (email: string) => {
      const found = state.accounts.find((account) => account.email === email);
      return found === undefined ? null : { userId: found.userId, emailVerified: found.emailVerified };
    }),
    findMemberByUser: vi.fn(async (tenantId: string, userId: string) =>
      state.members.find((row) => row.tenantId === tenantId && row.userId === userId) ?? null),
    findMemberById: vi.fn(async (tenantId: string, memberId: string) =>
      state.members.find((row) => row.tenantId === tenantId && row.id === memberId) ?? null),
    findMembersByEmail: vi.fn(async (tenantId: string, email: string) =>
      state.members.filter((row) => row.tenantId === tenantId && row.email.trim().toLowerCase() === email).slice(0, 2)),
    listPaidCheckoutOrders: vi.fn(async (_tenantId: string, memberId: string) =>
      (state.orders ?? [])
        .filter((order) => order.memberId === memberId && order.status === 'paid' && order.cancelled !== true
          && (order.mode ?? 'live') === 'live' && (order.provider ?? 'stripe') === 'stripe')
        .map((order) => ({ kind: order.kind ?? 'one_time', productIds: order.productIds, providerSubscriptionId: order.subscriptionId ?? null }))),
    hasSignedIn: vi.fn(async (tenantId: string, memberId: string) =>
      (state.signedIn ?? state.members.map((row) => row.id)).includes(memberId) && state.members.some((row) => row.tenantId === tenantId && row.id === memberId)),
    listActiveGrants: vi.fn(async (tenantId: string, memberId: string, now: string) =>
      state.grants.filter((row) => row.tenantId === tenantId && row.memberId === memberId && isActive(row, now))),
    listSubscriptions: vi.fn(async (tenantId: string, memberId: string) =>
      state.subscriptions.filter((row) => row.tenantId === tenantId && row.memberId === memberId)),
  };
  const deps: EntitlementCheckDeps = { entitlementSubjects: reader, clock: { nowIso: () => NOW } };
  return { deps, reader };
};

const ADA = { email: 'ada@example.test', userId: 'user-ada', emailVerified: true };

const checkOne = async (
  h: ReturnType<typeof harness>,
  subject: { email: string } | { memberId: string },
  productIds: string[] | null = ['prod-pro'],
  ctx: Ctx = keyCtx(),
  keyProducts: readonly string[] | null = null,
  match: 'verified' | 'purchase-email' = 'verified',
) => {
  const result = await checkEntitlements(ctx, { subjects: [subject], ...(productIds === null ? {} : { productIds }) }, { productIds: keyProducts, match }, h.deps);
  if (!result.ok) throw new Error(result.error.message);
  const [first] = result.value.results;
  if (first === undefined) throw new Error('no result');
  return first;
};

const NO_ACCESS = { productId: 'prod-pro', access: false, source: null, subscription: null, checkedAt: NOW };

describe('checkEntitlements', () => {
  it('answers access from an active grant and reports the subscription that keeps it', async () => {
    const h = harness({
      accounts: [ADA],
      members: [member('m-ada', ADA.userId)],
      grants: [grant('m-ada', 'prod-pro', { expiresAt: '2026-12-23T00:00:00.000Z' })],
      subscriptions: [subscription('m-ada', 'prod-pro')],
    });
    const result = await checkEntitlements(keyCtx(), { subjects: [{ email: ' Ada@Example.test ' }], productIds: ['prod-pro'] }, { productIds: null, match: 'verified' }, h.deps);
    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        results: [{
          subject: { email: 'ada@example.test' },
          identity: 'verified',
          products: [{
            productId: 'prod-pro',
            access: true,
            source: 'subscription',
            subscription: { status: 'active', currentPeriodEnd: '2026-12-20T00:00:00.000Z', cancelAtPeriodEnd: false },
            checkedAt: NOW,
          }],
          member: null,
        }],
      },
    });
  });

  it('never returns a name, an e-mail of the account, orders or amounts', async () => {
    const h = harness({ accounts: [ADA], members: [member('m-ada', ADA.userId)], grants: [grant('m-ada', 'prod-pro')] });
    const serialized = JSON.stringify(await checkOne(h, { email: ADA.email }));
    expect(serialized).not.toContain('Person m-ada');
    expect(serialized).not.toContain('m-ada@example.test');
    expect(serialized).not.toContain('amount');
    expect(serialized).not.toContain('order');
  });

  it('answers an unknown person, an unverified e-mail, a deleted and an erased member exactly like a known person without access', async () => {
    const unverified = { email: 'eve@example.test', userId: 'user-eve', emailVerified: false };
    const deleted = { email: 'dan@example.test', userId: 'user-dan', emailVerified: true };
    const known = { email: 'kim@example.test', userId: 'user-kim', emailVerified: true };
    const h = harness({
      accounts: [unverified, deleted, known],
      members: [
        member('m-eve', unverified.userId),
        member('m-dan', deleted.userId, { deletedAt: '2026-10-01T00:00:00.000Z' }),
        member('m-kim', known.userId),
      ],
      grants: [grant('m-eve', 'prod-pro'), grant('m-dan', 'prod-pro'), grant('m-kim', 'prod-pro', { expiresAt: '2026-11-01T00:00:00.000Z' })],
      subscriptions: [subscription('m-kim', 'prod-pro', { status: 'canceled', currentPeriodEnd: '2026-10-29T00:00:00.000Z' })],
    });
    const answers = await Promise.all([
      checkOne(h, { email: 'nobody@example.test' }),
      checkOne(h, { email: unverified.email }),
      checkOne(h, { email: deleted.email }),
      checkOne(h, { email: known.email }),
    ]);
    expect(answers.map((answer) => answer.products)).toEqual([[NO_ACCESS], [NO_ACCESS], [NO_ACCESS], [NO_ACCESS]]);
    expect(answers.map((answer) => answer.member)).toEqual([null, null, null, null]);
    const withoutProducts = await Promise.all([
      checkOne(h, { email: 'nobody@example.test' }, null),
      checkOne(h, { email: known.email }, null),
    ]);
    expect(withoutProducts.map((answer) => answer.products)).toEqual([[], []]);
  });

  it('runs the same lookups for a person who does not exist as for one who does', async () => {
    const known = harness({ accounts: [ADA], members: [member('m-ada', ADA.userId)] });
    const unknown = harness();
    await checkOne(known, { email: ADA.email });
    await checkOne(unknown, { email: 'nobody@example.test' });
    for (const method of ['findAccountByEmail', 'findMemberByUser', 'hasSignedIn', 'listActiveGrants', 'listSubscriptions'] as const) {
      expect(vi.mocked(unknown.reader[method]).mock.calls.length).toBe(vi.mocked(known.reader[method]).mock.calls.length);
    }
  });

  it('matches a verified address only once the person has signed in to this workspace', async () => {
    const imported = { email: 'imported@example.test', userId: 'user-imported', emailVerified: true };
    const h = harness({
      accounts: [ADA, imported],
      members: [member('m-ada', ADA.userId), member('m-imported', imported.userId)],
      grants: [grant('m-ada', 'prod-pro'), grant('m-imported', 'prod-pro')],
      signedIn: ['m-ada'],
    });
    expect((await checkOne(h, { email: ADA.email })).products[0]?.access).toBe(true);
    expect((await checkOne(h, { email: imported.email })).products).toEqual([NO_ACCESS]);
    const byId = await checkOne(h, { memberId: 'm-imported' }, ['prod-pro'], keyCtx(['entitlement:check', 'entitlement:member:read']));
    expect([byId.member, byId.products]).toEqual([null, [NO_ACCESS]]);
  });

  describe('purchase-email keys', () => {
    const BUYER = { email: 'buyer@example.test', userId: 'user-buyer', emailVerified: false };
    const freshBuyer = (overrides: Partial<World> = {}) => harness({
      accounts: [BUYER],
      members: [member('m-buyer', BUYER.userId, { email: BUYER.email })],
      grants: [grant('m-buyer', 'prod-pro')],
      orders: [{ memberId: 'm-buyer', productIds: ['prod-pro'], status: 'paid' }],
      signedIn: [],
      ...overrides,
    });
    const purchaseCheck = (h: ReturnType<typeof harness>, email: string, productIds: string[] | null = ['prod-pro'], ctx: Ctx = keyCtx()) =>
      checkOne(h, { email }, productIds, ctx, null, 'purchase-email');

    it('matches a fresh unverified buyer with a paid order only on a purchase-email key and says how', async () => {
      const h = freshBuyer();
      expect(await checkOne(h, { email: BUYER.email })).toMatchObject({ identity: null, products: [NO_ACCESS] });
      expect(await purchaseCheck(h, BUYER.email)).toEqual({
        subject: { email: BUYER.email },
        identity: 'purchase-email',
        products: [{ productId: 'prod-pro', access: true, source: 'purchase', subscription: null, checkedAt: NOW }],
        member: null,
      });
    });

    it.each([' Buyer@Example.TEST ', 'BUYER@example.test'])('normalizes the queried address %j the way checkout does', async (email) => {
      expect((await purchaseCheck(freshBuyer(), email)).identity).toBe('purchase-email');
    });

    it.each([
      ['an order cancelled as sold out', { orders: [{ memberId: 'm-buyer', productIds: ['prod-pro'], status: 'paid' as const, cancelled: true }], grants: [] }],
      ['a refunded order', { orders: [{ memberId: 'm-buyer', productIds: ['prod-pro'], status: 'refunded' as const }] }],
      ['a partially refunded order', { orders: [{ memberId: 'm-buyer', productIds: ['prod-pro'], status: 'partially_refunded' as const }] }],
      ['a test-mode order', { orders: [{ memberId: 'm-buyer', productIds: ['prod-pro'], status: 'paid' as const, mode: 'test' as const }] }],
      ['an owner grant without a payment', { orders: [], grants: [grant('m-buyer', 'prod-pro', { source: 'manual' })] }],
      ['an import without a payment', { orders: [], grants: [grant('m-buyer', 'prod-pro', { source: 'import' })] }],
      ['a self-registered account without a payment', { orders: [], grants: [] }],
      ['a paid order for another product', { orders: [{ memberId: 'm-buyer', productIds: ['prod-other'], status: 'paid' as const }] }],
      ['a lapsed subscription', { orders: [], grants: [grant('m-buyer', 'prod-pro', { expiresAt: '2026-11-01T00:00:00.000Z' })], subscriptions: [subscription('m-buyer', 'prod-pro', { status: 'canceled' })] }],
    ])('never matches an unverified address through %s', async (_label, overrides) => {
      const answer = await purchaseCheck(freshBuyer(overrides), BUYER.email);
      expect(answer).toEqual({ subject: { email: BUYER.email }, identity: null, products: [NO_ACCESS], member: null });
    });

    const checkoutSubscription = { memberId: 'm-buyer', productIds: ['prod-pro'], status: 'paid' as const, kind: 'recurring' as const, subscriptionId: 'sub_provider' };

    it('matches an unverified subscriber whose checkout subscription still pays', async () => {
      const h = freshBuyer({ orders: [checkoutSubscription], grants: [grant('m-buyer', 'prod-pro', { expiresAt: '2026-12-23T00:00:00.000Z' })], subscriptions: [subscription('m-buyer', 'prod-pro', { status: 'past_due' })] });
      expect((await purchaseCheck(h, BUYER.email)).products[0]).toMatchObject({ access: true, source: 'subscription' });
    });

    it.each([
      ['an owner grant that renewed the stripe grant of a lapsed checkout subscription', {
        orders: [checkoutSubscription], grants: [grant('m-buyer', 'prod-pro', { expiresAt: '2027-01-01T00:00:00.000Z' })],
        subscriptions: [subscription('m-buyer', 'prod-pro', { status: 'canceled' })],
      }],
      ['an enrollment after a refund, whose order is simulated', {
        orders: [{ memberId: 'm-buyer', productIds: ['prod-pro'], status: 'refunded' as const }, { memberId: 'm-buyer', productIds: ['prod-pro'], status: 'paid' as const, provider: 'simulated' as const }],
      }],
      ['a subscription adopted without a checkout order', {
        orders: [], grants: [grant('m-buyer', 'prod-pro', { expiresAt: '2026-12-23T00:00:00.000Z' })],
        subscriptions: [subscription('m-buyer', 'prod-pro', { status: 'active' })],
      }],
    ])('never matches an unverified address through %s', async (_label, overrides) => {
      expect((await purchaseCheck(freshBuyer(overrides), BUYER.email)).identity).toBeNull();
    });

    it('answers only the products the address paid for, never an owner grant beside them', async () => {
      const h = freshBuyer({ grants: [grant('m-buyer', 'prod-pro'), grant('m-buyer', 'prod-gift', { source: 'manual' })] });
      expect((await purchaseCheck(h, BUYER.email, null)).products.map((entry) => entry.productId)).toEqual(['prod-pro']);
      expect((await purchaseCheck(h, BUYER.email, ['prod-gift'])).products).toEqual([{ ...NO_ACCESS, productId: 'prod-gift' }]);
    });

    it('fails closed when two member rows share the address', async () => {
      const h = freshBuyer({ members: [member('m-buyer', BUYER.userId, { email: BUYER.email }), member('m-twin', 'user-twin', { email: BUYER.email })] });
      expect((await purchaseCheck(h, BUYER.email)).identity).toBeNull();
    });

    it('keeps the verified answer for a person who signed in', async () => {
      const h = freshBuyer({ accounts: [{ ...BUYER, emailVerified: true }], signedIn: ['m-buyer'], grants: [grant('m-buyer', 'prod-pro'), grant('m-buyer', 'prod-gift', { source: 'manual' })] });
      const answer = await purchaseCheck(h, BUYER.email, null);
      expect([answer.identity, answer.products.map((entry) => entry.productId)]).toEqual(['verified', ['prod-gift', 'prod-pro']]);
    });

    it('runs the same lookups for a buyer, a verified person and someone unknown', async () => {
      const buyer = freshBuyer();
      const verified = harness({ accounts: [ADA], members: [member('m-ada', ADA.userId)] });
      const unknown = harness();
      await purchaseCheck(buyer, BUYER.email);
      await purchaseCheck(verified, ADA.email);
      await purchaseCheck(unknown, 'nobody@example.test');
      for (const method of ['findAccountByEmail', 'findMemberByUser', 'hasSignedIn', 'findMembersByEmail', 'listPaidCheckoutOrders', 'listActiveGrants', 'listSubscriptions'] as const) {
        const counts = [buyer, verified, unknown].map((h) => vi.mocked(h.reader[method]).mock.calls.length);
        expect(new Set(counts).size).toBe(1);
      }
    });

    it('hides how a person without access was matched unless the key reads members', async () => {
      const h = freshBuyer();
      expect((await purchaseCheck(h, BUYER.email, ['prod-other'])).identity).toBeNull();
      const withMembers = await purchaseCheck(h, BUYER.email, ['prod-other'], keyCtx(['entitlement:check', 'entitlement:member:read']));
      expect([withMembers.identity, withMembers.member]).toEqual(['purchase-email', { id: 'm-buyer' }]);
    });
  });

  it('never matches an erased member, whose user id is a tombstone, by member id', async () => {
    const tombstone = memberTombstone('m-gone');
    const h = harness({ members: [member('m-gone', tombstone.userId, { email: tombstone.email })], grants: [grant('m-gone', 'prod-pro')] });
    const answer = await checkOne(h, { memberId: 'm-gone' }, ['prod-pro'], keyCtx(['entitlement:check', 'entitlement:member:read']));
    expect(answer.products).toEqual([NO_ACCESS]);
    expect(answer.member).toBeNull();
  });

  it('does not match a member row whose e-mail is stale once the account moved to a new verified address', async () => {
    const moved = { email: 'new@example.test', userId: 'user-moved', emailVerified: true };
    const h = harness({ accounts: [moved], members: [member('m-moved', moved.userId, { email: 'old@example.test' })], grants: [grant('m-moved', 'prod-pro')] });
    expect((await checkOne(h, { email: 'new@example.test' })).products[0]?.access).toBe(true);
    expect((await checkOne(h, { email: 'old@example.test' })).products[0]?.access).toBe(false);
  });

  it.each([
    ['active', false, '2026-12-23T00:00:00.000Z', true],
    ['active', true, '2026-12-20T00:00:00.000Z', true],
    ['past_due', false, '2026-11-22T00:00:00.000Z', true],
    ['past_due', false, '2026-11-19T00:00:00.000Z', false],
    ['canceled', false, '2026-11-25T00:00:00.000Z', true],
    ['canceled', false, '2026-11-10T00:00:00.000Z', false],
  ] as const)('answers a %s subscription (cancelAtPeriodEnd %s) from the grant window ending %s', async (status, cancelAtPeriodEnd, grantEnd, access) => {
    const h = harness({
      accounts: [ADA],
      members: [member('m-ada', ADA.userId)],
      grants: [grant('m-ada', 'prod-pro', { expiresAt: grantEnd })],
      subscriptions: [subscription('m-ada', 'prod-pro', { status, cancelAtPeriodEnd })],
    });
    const [entry] = (await checkOne(h, { email: ADA.email })).products;
    expect(entry?.access).toBe(access);
    expect(entry?.subscription).toEqual(access ? { status, currentPeriodEnd: '2026-12-20T00:00:00.000Z', cancelAtPeriodEnd } : null);
  });

  it('reports a lapsed subscription and the member id only with entitlements:members:read', async () => {
    const h = harness({
      accounts: [ADA],
      members: [member('m-ada', ADA.userId)],
      subscriptions: [subscription('m-ada', 'prod-pro', { status: 'canceled' })],
    });
    const answer = await checkOne(h, { email: ADA.email }, ['prod-pro'], keyCtx(['entitlement:check', 'entitlement:member:read']));
    expect(answer.member).toEqual({ id: 'm-ada' });
    expect(answer.products).toEqual([{ ...NO_ACCESS, subscription: { status: 'canceled', currentPeriodEnd: '2026-12-20T00:00:00.000Z', cancelAtPeriodEnd: false } }]);
  });

  it.each([
    ['manual', 'grant'],
    ['import', 'import'],
    ['stripe', 'purchase'],
    ['simulated', 'purchase'],
  ] as const)('names a %s grant without a subscription as %s', async (grantSource, source) => {
    const h = harness({ accounts: [ADA], members: [member('m-ada', ADA.userId)], grants: [grant('m-ada', 'prod-pro', { source: grantSource })] });
    expect((await checkOne(h, { email: ADA.email })).products[0]).toEqual({ productId: 'prod-pro', access: true, source, subscription: null, checkedAt: NOW });
  });

  it('names an open-ended purchase next to an old cancelled subscription a purchase without the subscription', async () => {
    const h = harness({
      accounts: [ADA],
      members: [member('m-ada', ADA.userId)],
      grants: [grant('m-ada', 'prod-pro', { expiresAt: null })],
      subscriptions: [subscription('m-ada', 'prod-pro', { status: 'canceled', currentPeriodEnd: '2026-03-01T00:00:00.000Z' })],
    });
    expect((await checkOne(h, { email: ADA.email })).products).toEqual([{ productId: 'prod-pro', access: true, source: 'purchase', subscription: null, checkedAt: NOW }]);
  });

  it('ignores test-mode grants and subscriptions', async () => {
    const h = harness({
      accounts: [ADA],
      members: [member('m-ada', ADA.userId)],
      grants: [grant('m-ada', 'prod-pro', { mode: 'test' })],
      subscriptions: [subscription('m-ada', 'prod-pro', { mode: 'test' })],
    });
    expect((await checkOne(h, { email: ADA.email }, ['prod-pro'], keyCtx(['entitlement:check', 'entitlement:member:read']))).products).toEqual([NO_ACCESS]);
  });

  it('answers a staff member from grants only, like anyone else', async () => {
    const staff = { email: 'admin@example.test', userId: 'user-admin', emailVerified: true };
    const h = harness({ accounts: [staff], members: [member('m-admin', staff.userId)] });
    expect((await checkOne(h, { email: staff.email })).products).toEqual([NO_ACCESS]);
  });

  it('lists only products with access when neither the request nor the key names products', async () => {
    const h = harness({
      accounts: [ADA],
      members: [member('m-ada', ADA.userId)],
      grants: [grant('m-ada', 'prod-z'), grant('m-ada', 'prod-a'), grant('m-ada', 'prod-old', { expiresAt: '2026-01-02T00:00:00.000Z' })],
    });
    expect((await checkOne(h, { email: ADA.email }, null)).products.map((entry) => entry.productId)).toEqual(['prod-a', 'prod-z']);
  });

  it('answers every allow-listed product when the request names none', async () => {
    const h = harness({ accounts: [ADA], members: [member('m-ada', ADA.userId)], grants: [grant('m-ada', 'prod-b')] });
    const answer = await checkOne(h, { email: ADA.email }, null, keyCtx(), ['prod-a', 'prod-b']);
    expect(answer.products.map((entry) => [entry.productId, entry.access])).toEqual([['prod-a', false], ['prod-b', true]]);
  });

  it('refuses a product outside the key allow-list without answering for the others', async () => {
    const h = harness({ accounts: [ADA], members: [member('m-ada', ADA.userId)] });
    const result = await checkEntitlements(keyCtx(), { subjects: [{ email: ADA.email }], productIds: ['prod-a', 'prod-secret'] }, { productIds: ['prod-a'], match: 'verified' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.reader.findAccountByEmail).not.toHaveBeenCalled();
  });

  it('refuses a member id subject unless the key holds entitlements:members:read', async () => {
    const h = harness({ members: [member('m-ada', ADA.userId)], grants: [grant('m-ada', 'prod-pro')] });
    const refused = await checkEntitlements(keyCtx(), { subjects: [{ memberId: 'm-ada' }] }, { productIds: null, match: 'verified' }, h.deps);
    expect(refused).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const allowed = await checkOne(h, { memberId: 'm-ada' }, ['prod-pro'], keyCtx(['entitlement:check', 'entitlement:member:read']));
    expect(allowed.products[0]?.access).toBe(true);
    expect(allowed.member).toEqual({ id: 'm-ada' });
  });

  it('refuses a session or a shop management key even when it holds the capability', async () => {
    const h = harness();
    const input = { subjects: [{ email: ADA.email }] };
    expect(await checkEntitlements({ identity: ownerIdentity }, input, { productIds: null, match: 'verified' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await checkEntitlements(
      { identity: ownerIdentity, capabilities: ['entitlement:check'], machineActor: { kind: 'shop_management_key', apiKeyId: 'shop-1', mode: 'direct' } },
      input,
      { productIds: null, match: 'verified' },
      h.deps,
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('rejects a batch above 25 subjects and an invalid e-mail without echoing the input', async () => {
    const h = harness();
    const tooMany = await checkEntitlements(keyCtx(), { subjects: Array.from({ length: 26 }, (_, index) => ({ email: `p${String(index)}@example.test` })) }, { productIds: null, match: 'verified' }, h.deps);
    expect(tooMany).toMatchObject({ ok: false, error: { code: 'validation' } });
    const invalid = await checkEntitlements(keyCtx(), { subjects: [{ email: 'secret-person-at-example' }] }, { productIds: null, match: 'verified' }, h.deps);
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(JSON.stringify(invalid)).not.toContain('secret-person-at-example');
  });
});
