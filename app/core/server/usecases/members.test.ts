import { describe, expect, it } from 'vitest';

import {
  deletedMemberDisplay,
  err,
  memberTombstone,
  ok,
  validation,
  type Identity,
  type Member,
  type MemberErasureRequest,
  type MemberErasureRequestEvent,
  type MemberErasureRequestWithMember,
  type MemberSubscription,
  type MemberWithProductIds,
} from '#core/domain/index.js';

import type {
  MemberErasurePort,
  MemberErasureRequestRepository,
  MemberPseudonymization,
  MemberRepository,
  MemberSubscriptionRepository,
  PaymentProvider,
} from '../ports.js';
import {
  exportMembers,
  listErasureRequests,
  listMembers,
  rejectErasureRequest,
  removeMember,
  setMemberBanned,
} from './members.js';

const staff = (tenantId: string | null, tenantSlug: string | null): Identity => ({
  userId: 'u-staff',
  email: 'owner@together.dev',
  name: 'Owner',
  emailVerified: true,
  tenantId,
  tenantSlug,
  tenantName: tenantSlug ? 'Acme' : null,
  staffRole: tenantId ? 'owner' : null,
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
});

const plainMember = (tenantId: string): Identity => ({
  userId: 'u-member',
  email: 'buyer@together.dev',
  name: 'Buyer',
  emailVerified: true,
  tenantId,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'member-1',
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
});

const memberRow = (input: Partial<MemberWithProductIds> & { id: string }): MemberWithProductIds => ({
  id: input.id,
  email: input.email ?? `${input.id}@together.dev`,
  displayName: input.displayName ?? null,
  tags: input.tags ?? [],
  marketingConsents: input.marketingConsents ?? {},
  externalCustomerIds: input.externalCustomerIds ?? {},
  createdAt: input.createdAt ?? '1998-07-12T00:00:00.000Z',
  deletedAt: input.deletedAt ?? null,
  bannedAt: input.bannedAt ?? null,
  bannedReason: input.bannedReason ?? null,
  productIds: input.productIds ?? [],
  activeProductIds: input.activeProductIds ?? [],
});

const clock = { nowIso: () => '1998-07-12T12:00:00.000Z' };

const membersFor = (byTenant: Record<string, MemberWithProductIds[]>): MemberRepository => ({
  findById: async (): Promise<Member | null> => null,
  findByEmail: async (): Promise<Member | null> => null,
  create: async () => undefined,
  listWithProductIds: async (tenantId) => byTenant[tenantId] ?? [],
  updateEmail: async () => null,
  updateDisplayName: async () => null,
  updateDmOptOut: async () => null,
  setBanned: async () => null,
});

const erasureFor = (
  byTenant: Record<string, MemberWithProductIds[]>,
  calls: Array<{ tenantId: string; input: MemberPseudonymization }> = [],
  onPseudonymize: (() => void) | undefined = undefined,
): MemberErasurePort => ({
  pseudonymize: async (tenantId, input) => {
    onPseudonymize?.();
    calls.push({ tenantId, input });
    const rows = byTenant[tenantId] ?? [];
    const row = rows.find((member) => member.id === input.memberId);
    if (!row) return null;
    if (row.deletedAt !== null) {
      return {
        alreadyDeleted: true,
        authUserErased: false,
        erasureRequestId: null,
      };
    }
    row.deletedAt = input.deletedAt;
    row.email = input.tombstoneEmail;
    row.displayName = null;
    row.tags = [];
    row.marketingConsents = {};
    row.externalCustomerIds = {};
    return {
      alreadyDeleted: false,
      authUserErased: true,
      erasureRequestId: null,
    };
  },
});

const subscriptionRow = (
  input: Partial<MemberSubscription> & { id: string },
): MemberSubscription => ({
  id: input.id,
  tenantId: input.tenantId ?? 't-acme',
  memberId: input.memberId ?? 'm1',
  productId: input.productId ?? 'p1',
  priceId: input.priceId ?? 'price-1',
  provider: input.provider ?? 'stripe',
  providerSubscriptionId:
    'providerSubscriptionId' in input
      ? input.providerSubscriptionId ?? null
      : `sub_${input.id}`,
  status: input.status ?? 'active',
  currentPeriodEnd: input.currentPeriodEnd ?? '1998-08-12T00:00:00.000Z',
  cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
  couponId: input.couponId ?? null,
  couponDiscountCents: input.couponDiscountCents ?? 0,
  couponRecurringDuration: input.couponRecurringDuration ?? null,
  createdAt: input.createdAt ?? '1998-07-12T00:00:00.000Z',
  updatedAt: input.updatedAt ?? '1998-07-12T00:00:00.000Z',
});

const subscriptionsFor = (rows: MemberSubscription[]): MemberSubscriptionRepository => ({
  findById: async () => null,
  findByProviderSubscriptionId: async () => null,
  listForMember: async (tenantId, memberId) =>
    rows.filter((row) => row.tenantId === tenantId && row.memberId === memberId),
  create: async () => undefined,
  update: async () => null,
  countActive: async () => 0,
});

const paymentFor = (
  cancelSubscription: PaymentProvider['cancelSubscription'] = async () =>
    ok({ canceled: true, alreadySettled: false }),
): PaymentProvider => ({
  test: async () => ok({ code: 'payment.available', message: 'Payment is available.' }),
  createCheckoutSession: async () => ok({ url: 'https://checkout.test', sessionId: 'cs_1' }),
  expireCheckoutSession: async () => ok({ expired: true }),
  cancelSubscription,
  verifyWebhookEvent: async () =>
    ok({ id: 'evt_1', type: 'ignored', objectId: null, checkoutSession: null }),
});

const depsFor = (
  byTenant: Record<string, MemberWithProductIds[]>,
  calls: Array<{ tenantId: string; input: MemberPseudonymization }> = [],
  options: {
    subscriptions?: MemberSubscription[];
    cancelSubscription?: PaymentProvider['cancelSubscription'];
    errors?: string[];
    onPseudonymize?: () => void;
  } = {},
) => ({
  members: membersFor(byTenant),
  memberErasure: erasureFor(byTenant, calls, options.onPseudonymize),
  clock,
  ids: { nextId: () => 'event-1' },
  subscriptions: subscriptionsFor(options.subscriptions ?? []),
  payment: paymentFor(options.cancelSubscription),
  logger: { error: (message: string) => options.errors?.push(message) },
});

describe('listMembers', () => {
  it('requires the declared member read capability', async () => {
    const identity = staff('t-acme', 'acme');
    const deps = depsFor({ 't-acme': [memberRow({ id: 'm1' })] });
    expect(await listMembers({ identity, capabilities: ['member:read'] }, deps)).toMatchObject({
      ok: true,
    });
    expect(await listMembers({ identity, capabilities: ['member:export'] }, deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('forbids a plain member identity', async () => {
    const result = await listMembers(
      { identity: plainMember('t-acme') },
      depsFor({ 't-acme': [memberRow({ id: 'm1' })] }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a resolved tenant', async () => {
    const result = await listMembers({ identity: staff(null, null) }, depsFor({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('scopes members to the staff identity tenant', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'acme-1', email: 'acme@together.dev' })],
      't-globex': [memberRow({ id: 'globex-1', email: 'globex@together.dev' })],
    };

    const acme = await listMembers({ identity: staff('t-acme', 'acme') }, depsFor(byTenant));
    const globex = await listMembers({ identity: staff('t-globex', 'globex') }, depsFor(byTenant));

    expect(acme).toMatchObject({ ok: true, value: [{ id: 'acme-1' }] });
    expect(globex).toMatchObject({ ok: true, value: [{ id: 'globex-1' }] });
  });
});

describe('setMemberBanned', () => {
  const member: Member = {
    id: 'm1',
    tenantId: 't-acme',
    userId: 'u1',
    email: 'member@together.dev',
    displayName: 'Member',
    tags: [],
    marketingConsents: {},
    externalCustomerIds: {},
    createdAt: '1998-07-01T00:00:00.000Z',
    deletedAt: null,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
    dmOptOutAt: null,
  };

  it('writes the projection and event and is idempotent', async () => {
    const events: Array<{ type: 'banned' | 'unbanned'; actorUserId: string; reason: string | null }> = [];
    let stored = member;
    const repository: MemberRepository = {
      findById: async () => stored,
      findByEmail: async () => stored,
      listWithProductIds: async () => [],
      create: async () => undefined,
      updateEmail: async () => stored,
      updateDisplayName: async () => stored,
      updateDmOptOut: async () => stored,
      setBanned: async (_tenantId, input, event) => {
        events.push({
          type: event.type,
          actorUserId: event.payload.actorUserId,
          reason: event.type === 'banned' ? event.payload.reason : null,
        });
        stored = {
          ...stored,
          bannedAt: input.bannedAt,
          bannedReason: input.reason,
          bannedByUserId: input.bannedAt === null ? null : input.actorUserId,
        };
        return stored;
      },
    };
    const deps = {
      members: repository,
      memberErasure: erasureFor({}),
      clock,
      ids: { nextId: () => 'event-1' },
    };
    const first = await setMemberBanned(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1', banned: true, reason: 'spam' },
      deps,
    );
    const second = await setMemberBanned(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1', banned: true, reason: 'ignored' },
      deps,
    );
    const unbanned = await setMemberBanned(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1', banned: false, reason: 'not retained' },
      deps,
    );
    expect(first).toMatchObject({ ok: true, value: { bannedReason: 'spam' } });
    expect(second).toMatchObject({ ok: true, value: { bannedReason: 'spam' } });
    expect(unbanned).toMatchObject({
      ok: true,
      value: { bannedAt: null, bannedReason: null, bannedByUserId: null, dmOptOutAt: null },
    });
    expect(events).toEqual([
      { type: 'banned', actorUserId: 'u-staff', reason: 'spam' },
      { type: 'unbanned', actorUserId: 'u-staff', reason: null },
    ]);
  });

  it.each([
    ['unknown', null],
    ['tombstoned', { ...member, deletedAt: clock.nowIso() }],
  ])('does not ban %s members', async (_label, found) => {
    const repository: MemberRepository = {
      findById: async () => found,
      findByEmail: async () => null,
      listWithProductIds: async () => [],
      create: async () => undefined,
      updateEmail: async () => null,
      updateDisplayName: async () => null,
      updateDmOptOut: async () => null,
      setBanned: async () => null,
    };
    const result = await setMemberBanned(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1', banned: true },
      {
        members: repository,
        memberErasure: erasureFor({}),
        clock,
        ids: { nextId: () => 'event-1' },
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('removeMember', () => {
  it('pseudonymizes the member with tombstone identifiers scoped to the staff tenant', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'm1', displayName: 'Jan Kowalski', tags: ['vip'] })],
      't-globex': [memberRow({ id: 'm1' })],
    };
    const calls: Array<{ tenantId: string; input: MemberPseudonymization }> = [];

    const result = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1' },
      depsFor(byTenant, calls),
    );

    expect(result).toEqual({
      ok: true,
      value: { memberId: 'm1', subscriptionCancellations: [], erasureRequestId: null },
    });
    expect(calls).toEqual([
      {
        tenantId: 't-acme',
        input: {
          memberId: 'm1',
          deletedAt: clock.nowIso(),
          tombstoneEmail: memberTombstone('m1').email,
          severedUserId: memberTombstone('m1').userId,
          postAuthorDisplay: deletedMemberDisplay(),
        },
      },
    ]);
    expect(byTenant['t-acme'][0]).toMatchObject({
      id: 'm1',
      email: memberTombstone('m1').email,
      displayName: null,
      tags: [],
      deletedAt: clock.nowIso(),
    });
    expect(byTenant['t-globex'][0]).toMatchObject({ id: 'm1', deletedAt: null });
  });

  it('keeps the member row so exports and sales history survive removal', async () => {
    const byTenant = { 't-acme': [memberRow({ id: 'm1', productIds: ['p1'] })] };

    await removeMember({ identity: staff('t-acme', 'acme') }, { memberId: 'm1' }, depsFor(byTenant));
    const listed = await listMembers({ identity: staff('t-acme', 'acme') }, depsFor(byTenant));

    expect(listed).toMatchObject({ ok: true, value: [{ id: 'm1', productIds: ['p1'] }] });
  });

  it('stays idempotent for an already pseudonymized member', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'm1', deletedAt: '1998-07-01T00:00:00.000Z' })],
    };

    const result = await removeMember({ identity: staff('t-acme', 'acme') }, { memberId: 'm1' }, depsFor(byTenant));

    expect(result).toEqual({
      ok: true,
      value: { memberId: 'm1', subscriptionCancellations: [], erasureRequestId: null },
    });
    expect(byTenant['t-acme'][0]?.deletedAt).toBe('1998-07-01T00:00:00.000Z');
  });

  it('cancels Stripe subscriptions before pseudonymization with stable idempotency keys', async () => {
    const calls: string[] = [];
    const providerInputs: Parameters<PaymentProvider['cancelSubscription']>[0][] = [];
    const result = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1' },
      depsFor(
        { 't-acme': [memberRow({ id: 'm1' })] },
        [],
        {
          subscriptions: [subscriptionRow({ id: 'subscription-1' })],
          cancelSubscription: async (input) => {
            calls.push('cancel');
            providerInputs.push(input);
            return ok({ canceled: true, alreadySettled: false });
          },
          onPseudonymize: () => calls.push('pseudonymize'),
        },
      ),
    );

    expect(calls).toEqual(['cancel', 'pseudonymize']);
    expect(providerInputs).toEqual([
      {
        tenantId: 't-acme',
        providerSubscriptionId: 'sub_subscription-1',
        idempotencyKey: 'member-removal-subscription-1',
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        subscriptionCancellations: [
          {
            subscriptionId: 'subscription-1',
            providerSubscriptionId: 'sub_subscription-1',
            outcome: 'canceled',
            message: null,
          },
        ],
      },
    });
  });

  it('skips simulated subscriptions and Stripe rows without provider ids', async () => {
    let providerCalls = 0;
    const result = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1' },
      depsFor(
        { 't-acme': [memberRow({ id: 'm1' })] },
        [],
        {
          subscriptions: [
            subscriptionRow({
              id: 'simulated-1',
              provider: 'simulated',
              providerSubscriptionId: 'simulated_subscription',
            }),
            subscriptionRow({ id: 'stripe-null', providerSubscriptionId: null }),
          ],
          cancelSubscription: async () => {
            providerCalls += 1;
            return ok({ canceled: true, alreadySettled: false });
          },
        },
      ),
    );

    expect(providerCalls).toBe(0);
    expect(result).toMatchObject({
      ok: true,
      value: {
        subscriptionCancellations: [
          {
            subscriptionId: 'simulated-1',
            providerSubscriptionId: 'simulated_subscription',
            outcome: 'skipped',
            message: null,
          },
          {
            subscriptionId: 'stripe-null',
            providerSubscriptionId: null,
            outcome: 'skipped',
            message: null,
          },
        ],
      },
    });
  });

  it('logs provider failures and completes pseudonymization', async () => {
    const errors: string[] = [];
    let pseudonymized = false;
    const result = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1' },
      depsFor(
        { 't-acme': [memberRow({ id: 'm1' })] },
        [],
        {
          subscriptions: [subscriptionRow({ id: 'subscription-1' })],
          cancelSubscription: async () => err(validation('Stripe is unavailable')),
          errors,
          onPseudonymize: () => {
            pseudonymized = true;
          },
        },
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        subscriptionCancellations: [
          {
            subscriptionId: 'subscription-1',
            outcome: 'failed',
            message: 'Stripe is unavailable',
          },
        ],
      },
    });
    expect(pseudonymized).toBe(true);
    expect(errors).toEqual([
      '[member-removal] provider cancel failed tenant=t-acme member=m1 subscription=subscription-1 providerSubscriptionId=sub_subscription-1 error=Stripe is unavailable',
    ]);
  });

  it('reports provider subscriptions that were already settled', async () => {
    const result = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1' },
      depsFor(
        { 't-acme': [memberRow({ id: 'm1' })] },
        [],
        {
          subscriptions: [subscriptionRow({ id: 'subscription-1' })],
          cancelSubscription: async () => ok({ canceled: true, alreadySettled: true }),
        },
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        subscriptionCancellations: [{ outcome: 'already_canceled', message: null }],
      },
    });
  });

  it('retries provider cancellation when removal is rerun for a tombstoned member', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'm1', deletedAt: '1998-07-01T00:00:00.000Z' })],
    };
    let providerCalls = 0;
    const deps = depsFor(byTenant, [], {
      subscriptions: [subscriptionRow({ id: 'subscription-1', status: 'canceled' })],
      cancelSubscription: async () => {
        providerCalls += 1;
        return ok({ canceled: true, alreadySettled: providerCalls > 1 });
      },
    });

    const first = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1' },
      deps,
    );
    const second = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'm1' },
      deps,
    );

    expect(providerCalls).toBe(2);
    expect(first).toMatchObject({
      ok: true,
      value: { subscriptionCancellations: [{ outcome: 'canceled' }] },
    });
    expect(second).toMatchObject({
      ok: true,
      value: { subscriptionCancellations: [{ outcome: 'already_canceled' }] },
    });
  });

  it('forbids a plain member identity', async () => {
    const result = await removeMember(
      { identity: plainMember('t-acme') },
      { memberId: 'm1' },
      depsFor({ 't-acme': [memberRow({ id: 'm1' })] }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('returns not_found when the member is absent in this tenant', async () => {
    let providerCalls = 0;
    const result = await removeMember(
      { identity: staff('t-acme', 'acme') },
      { memberId: 'missing' },
      depsFor(
        { 't-acme': [memberRow({ id: 'm1' })] },
        [],
        {
          cancelSubscription: async () => {
            providerCalls += 1;
            return ok({ canceled: true, alreadySettled: false });
          },
        },
      ),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(providerCalls).toBe(0);
  });
});

describe('exportMembers', () => {
  it('quotes and escapes CSV fields and joins productIds with a semicolon', async () => {
    const deps = depsFor({
      't-acme': [
        memberRow({
          id: 'm1',
          email: 'jane@together.dev',
          displayName: 'Doe, "Jane"',
          tags: ['vip', 'trial'],
          marketingConsents: { email: true },
          externalCustomerIds: { stripe: 'cus_123' },
          createdAt: '1998-07-12T09:00:00.000Z',
          productIds: ['p1', 'p2'],
        }),
      ],
    });

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'csv' }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.content.split('\n');
    expect(lines[0]).toBe(
      '"id","email","displayName","tags","marketingConsents","externalCustomerIds","createdAt","deletedAt","productIds"',
    );
    expect(lines[1]).toBe(
      '"m1","jane@together.dev","Doe, ""Jane""","vip;trial","{""email"":true}","{""stripe"":""cus_123""}","1998-07-12T09:00:00.000Z","","p1;p2"',
    );
    expect(result.value.filename).toBe('members-acme.csv');
    expect(result.value.mimeType).toContain('text/csv');
  });

  it('keeps pseudonymized rows in the export with their tombstone marker', async () => {
    const byTenant = {
      't-acme': [memberRow({ id: 'm1', displayName: 'Jan Kowalski', productIds: ['p1'] })],
    };
    await removeMember({ identity: staff('t-acme', 'acme') }, { memberId: 'm1' }, depsFor(byTenant));

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'csv' }, depsFor(byTenant));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.content.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      `"m1","${memberTombstone('m1').email}","","","{}","{}","1998-07-12T00:00:00.000Z","${clock.nowIso()}","p1"`,
    );
  });

  it('neutralizes formula-like CSV cells controlled by members', async () => {
    const deps = depsFor({
      't-acme': [
        memberRow({
          id: 'm1',
          email: '=cmd@together.dev',
          displayName: '+SUM(1,1)',
          tags: ['@tag'],
          externalCustomerIds: { crm: '=abc' },
        }),
      ],
    });

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'csv' }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content.split('\n')[1]).toContain(
      '"\'=cmd@together.dev","\'+SUM(1,1)","\'@tag","{}","{""crm"":""=abc""}"',
    );
  });

  it('serializes the JSON array', async () => {
    const deps = depsFor({ 't-acme': [memberRow({ id: 'm1', productIds: ['p1'] })] });

    const result = await exportMembers({ identity: staff('t-acme', 'acme') }, { format: 'json' }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value.content)).toMatchObject([{ id: 'm1', productIds: ['p1'] }]);
    expect(result.value.filename).toBe('members-acme.json');
  });

  it('forbids a plain member identity', async () => {
    const result = await exportMembers({ identity: plainMember('t-acme') }, { format: 'csv' }, depsFor({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('erasure request administration', () => {
  const request: MemberErasureRequest = {
    id: 'request-1',
    tenantId: 't-acme',
    memberId: 'member-1',
    status: 'open',
    reason: 'privacy',
    requestedAt: clock.nowIso(),
    dueAt: '1998-08-11T12:00:00.000Z',
    resolvedAt: null,
    resolvedByUserId: null,
    resolutionNote: null,
  };
  const listed: MemberErasureRequestWithMember = {
    ...request,
    member: { id: 'member-1', email: 'member@example.com', displayName: 'Member' },
  };
  const repository = (
    calls: Array<{ tenantId: string; event: MemberErasureRequestEvent }>,
  ): MemberErasureRequestRepository => ({
    create: async () => 'created',
    findOpenForMember: async () => request,
    findLatestForMember: async () => request,
    list: async (tenantId) => tenantId === 't-acme' ? [listed] : [],
    resolve: async (tenantId, input, event) => {
      calls.push({ tenantId, event });
      return {
        ...request,
        status: input.status,
        resolvedAt: input.resolvedAt,
        resolvedByUserId: input.resolvedByUserId,
        resolutionNote: input.resolutionNote,
      };
    },
  });

  it('lists tenant requests only with the read capability', async () => {
    const calls: Array<{ tenantId: string; event: MemberErasureRequestEvent }> = [];
    const erasureRequests = repository(calls);
    expect(await listErasureRequests(
      { identity: staff('t-acme', 'acme'), capabilities: ['member:erasure:read'] },
      { status: 'open' },
      { erasureRequests },
    )).toMatchObject({ ok: true, value: [{ id: 'request-1', tenantId: 't-acme' }] });
    expect(await listErasureRequests(
      { identity: staff('t-acme', 'acme'), capabilities: ['member:remove'] },
      {},
      { erasureRequests },
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('rejects an open request only with resolver authority and records the actor', async () => {
    const calls: Array<{ tenantId: string; event: MemberErasureRequestEvent }> = [];
    const erasureRequests = repository(calls);
    const deps = {
      erasureRequests,
      ids: { nextId: () => 'event-1' },
      clock,
    };
    expect(await rejectErasureRequest(
      { identity: staff('t-acme', 'acme'), capabilities: ['member:erasure:read'] },
      { requestId: request.id, note: 'Retained by request' },
      deps,
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await rejectErasureRequest(
      { identity: staff('t-acme', 'acme'), capabilities: ['member:remove'] },
      { requestId: request.id, note: 'Retained by request' },
      deps,
    )).toMatchObject({
      ok: true,
      value: {
        status: 'rejected',
        resolvedByUserId: 'u-staff',
        resolutionNote: 'Retained by request',
      },
    });
    expect(calls).toEqual([{
      tenantId: 't-acme',
      event: expect.objectContaining({
        type: 'rejected',
        actorUserId: 'u-staff',
        meta: { note: 'Retained by request' },
      }),
    }]);
  });
});
