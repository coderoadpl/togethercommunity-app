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

interface World {
  accounts: { email: string; userId: string; emailVerified: boolean }[];
  members: Member[];
  grants: ProductGrant[];
  subscriptions: MemberSubscription[];
  signedIn?: string[];
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
) => {
  const result = await checkEntitlements(ctx, { subjects: [subject], ...(productIds === null ? {} : { productIds }) }, { productIds: keyProducts }, h.deps);
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
    const result = await checkEntitlements(keyCtx(), { subjects: [{ email: ' Ada@Example.test ' }], productIds: ['prod-pro'] }, { productIds: null }, h.deps);
    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        results: [{
          subject: { email: 'ada@example.test' },
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
    const result = await checkEntitlements(keyCtx(), { subjects: [{ email: ADA.email }], productIds: ['prod-a', 'prod-secret'] }, { productIds: ['prod-a'] }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.reader.findAccountByEmail).not.toHaveBeenCalled();
  });

  it('refuses a member id subject unless the key holds entitlements:members:read', async () => {
    const h = harness({ members: [member('m-ada', ADA.userId)], grants: [grant('m-ada', 'prod-pro')] });
    const refused = await checkEntitlements(keyCtx(), { subjects: [{ memberId: 'm-ada' }] }, { productIds: null }, h.deps);
    expect(refused).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const allowed = await checkOne(h, { memberId: 'm-ada' }, ['prod-pro'], keyCtx(['entitlement:check', 'entitlement:member:read']));
    expect(allowed.products[0]?.access).toBe(true);
    expect(allowed.member).toEqual({ id: 'm-ada' });
  });

  it('refuses a session or a shop management key even when it holds the capability', async () => {
    const h = harness();
    const input = { subjects: [{ email: ADA.email }] };
    expect(await checkEntitlements({ identity: ownerIdentity }, input, { productIds: null }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await checkEntitlements(
      { identity: ownerIdentity, capabilities: ['entitlement:check'], machineActor: { kind: 'shop_management_key', apiKeyId: 'shop-1', mode: 'direct' } },
      input,
      { productIds: null },
      h.deps,
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('rejects a batch above 25 subjects and an invalid e-mail without echoing the input', async () => {
    const h = harness();
    const tooMany = await checkEntitlements(keyCtx(), { subjects: Array.from({ length: 26 }, (_, index) => ({ email: `p${String(index)}@example.test` })) }, { productIds: null }, h.deps);
    expect(tooMany).toMatchObject({ ok: false, error: { code: 'validation' } });
    const invalid = await checkEntitlements(keyCtx(), { subjects: [{ email: 'secret-person-at-example' }] }, { productIds: null }, h.deps);
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(JSON.stringify(invalid)).not.toContain('secret-person-at-example');
  });
});
