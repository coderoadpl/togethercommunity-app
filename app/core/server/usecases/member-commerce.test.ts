import { describe, expect, it } from 'vitest';

import type {
  Identity,
  Member,
  MemberSubscription,
  OrderListItem,
  Product,
} from '#core/domain/index.js';
import type {
  MemberRepository,
  MemberOrderListReader,
  MemberSubscriptionRepository,
  OrderRepository,
  ProductBatchReader,
  ProductRepository,
} from '../ports.js';
import { getMemberCommerceOverview } from './member-commerce.js';

const TENANT_ID = 'tenant-1';

const identity: Identity = {
  userId: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  tenantId: TENANT_ID,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  memberBannedAt: null,
};

const member: Member = {
  id: 'member-1',
  tenantId: TENANT_ID,
  userId: 'user-1',
  email: 'member@example.test',
  displayName: 'Member',
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '1998-08-01T10:00:00.000Z',
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
};

const product: Product = {
  id: 'product-1',
  tenantId: TENANT_ID,
  type: 'course',
  slug: 'advanced-course',
  coverUrl: null,
  title: 'Advanced course',
  description: '',
  priceCents: 4900,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: '1998-07-01T10:00:00.000Z',
};

const purchase: OrderListItem = {
  id: 'order-1',
  tenantId: TENANT_ID,
  memberId: member.id,
  productId: product.id,
  priceId: 'price-1',
  kind: 'recurring',
  status: 'paid',
  amountCents: 4900,
  currency: 'PLN',
  provider: 'stripe',
  providerObjectIds: { subscription: 'sub_stripe_1' },
  couponId: null,
  discountCents: 0,
  createdAt: '1998-08-02T10:00:00.000Z',
  memberEmail: member.email,
  memberName: member.displayName,
  productTitle: product.title,
  couponCode: null,
};

const subscription = (status: MemberSubscription['status']): MemberSubscription => ({
  id: `subscription-${status}`,
  tenantId: TENANT_ID,
  memberId: member.id,
  productId: product.id,
  priceId: 'price-1',
  provider: 'stripe',
  providerSubscriptionId: `sub_${status}`,
  status,
  currentPeriodEnd: '1998-09-02T10:00:00.000Z',
  cancelAtPeriodEnd: false,
  couponId: null,
  couponDiscountCents: 0,
  couponRecurringDuration: null,
  createdAt: '1998-08-02T10:00:00.000Z',
  updatedAt: '1998-08-02T10:00:00.000Z',
});

const members: MemberRepository = {
  findById: async (tenantId, memberId) => tenantId === TENANT_ID && memberId === member.id ? member : null,
  findByEmail: async () => null,
  listWithProductIds: async () => [],
  create: async () => undefined,
  updateEmail: async () => null,
  setBanned: async () => null,
};

const products: ProductRepository & ProductBatchReader = {
  listByTenant: async () => [product],
  listPublishedByTenant: async () => [product],
  findById: async () => product,
  findByIds: async (_tenantId, ids) => ids.includes(product.id) ? [product] : [],
  create: async () => 'created',
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
};

const subscriptions: MemberSubscriptionRepository = {
  findById: async () => null,
  findByProviderSubscriptionId: async () => null,
  listForMember: async () => [subscription('active'), subscription('past_due'), subscription('canceled')],
  create: async () => undefined,
  update: async () => null,
  countActive: async () => 0,
};

const orders = (queries: Array<[string, string]>): OrderRepository & MemberOrderListReader => ({
  create: async () => undefined,
  list: async () => ({ orders: [purchase], total: 1 }),
  listForMember: async (tenantId, memberId) => {
    queries.push([tenantId, memberId]);
    return [purchase];
  },
  revenueSince: async () => [],
  countSince: async () => 0,
  listPaidWithoutGrant: async () => [],
});

describe('getMemberCommerceOverview', () => {
  it('returns exact-member purchases and current Stripe subscription projections', async () => {
    const queries: Array<[string, string]> = [];
    const result = await getMemberCommerceOverview(
      { identity },
      { memberId: member.id },
      { members, orders: orders(queries), products, subscriptions },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        purchases: [purchase],
        activeSubscriptions: [
          { ...subscription('active'), productTitle: product.title },
          { ...subscription('past_due'), productTitle: product.title },
        ],
      },
    });
    expect(queries).toEqual([[TENANT_ID, member.id]]);
  });

  it('does not query commerce for a member outside the tenant', async () => {
    const queries: Array<[string, string]> = [];
    const result = await getMemberCommerceOverview(
      { identity: { ...identity, tenantId: 'tenant-2' } },
      { memberId: member.id },
      { members, orders: orders(queries), products, subscriptions },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(queries).toEqual([]);
  });

  it('forbids member principals from reading commerce data', async () => {
    const queries: Array<[string, string]> = [];
    const result = await getMemberCommerceOverview(
      {
        identity: {
          ...identity,
          staffRole: null,
          memberId: member.id,
        },
      },
      { memberId: member.id },
      { members, orders: orders(queries), products, subscriptions },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(queries).toEqual([]);
  });
});
