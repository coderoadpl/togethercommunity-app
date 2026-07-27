import {
  graceExpiresAt,
  nextPeriodEnd,
  type GrantSource,
  type CouponRecurringDuration,
  type MemberSubscription,
  type Order,
  type OrderProvider,
  type ProductPrice,
} from '@core/domain/index.js';

import type {
  Clock,
  IdGenerator,
  MemberSubscriptionRepository,
  OrderRepository,
  ProductGrantRepository,
  ProductPriceRepository,
} from '../ports.js';
import { createOrRenewGrant } from './grant-window.js';

export interface SubscriptionLifecycleDeps {
  prices: ProductPriceRepository;
  orders: OrderRepository;
  subscriptions: MemberSubscriptionRepository;
  grants: ProductGrantRepository;
  ids: IdGenerator;
  clock: Clock;
}

const grantSourceFor = (provider: OrderProvider): GrantSource =>
  provider === 'stripe' ? 'stripe' : 'simulated';

export const appendOrder = async (
  tenantId: string,
  input: Omit<Order, 'id' | 'tenantId' | 'createdAt' | 'couponId' | 'discountCents'> & {
    couponId?: string | null;
    discountCents?: number;
  },
  deps: Pick<SubscriptionLifecycleDeps, 'orders' | 'ids' | 'clock'>,
): Promise<Order> => {
  const order: Order = {
    ...input,
    couponId: input.couponId ?? null,
    discountCents: input.discountCents ?? 0,
    id: deps.ids.nextId(),
    tenantId,
    createdAt: deps.clock.nowIso(),
  };
  await deps.orders.create(tenantId, order);
  return order;
};

export interface StartSubscriptionInput {
  memberId: string;
  price: ProductPrice;
  provider: OrderProvider;
  providerSubscriptionId: string | null;
  providerObjectIds: Record<string, string>;
  currentPeriodEnd?: string;
  amountCents?: number;
  couponId?: string;
  couponDiscountCents?: number;
  couponRecurringDuration?: CouponRecurringDuration;
  paidOrder?: Order;
}

export const startSubscription = async (
  tenantId: string,
  input: StartSubscriptionInput,
  deps: SubscriptionLifecycleDeps,
): Promise<{ subscription: MemberSubscription; order: Order }> => {
  const now = deps.clock.nowIso();
  const periodEnd = input.currentPeriodEnd ?? nextPeriodEnd(now, input.price.interval ?? 'month');
  const subscription: MemberSubscription = {
    id: deps.ids.nextId(),
    tenantId,
    memberId: input.memberId,
    productId: input.price.productId,
    priceId: input.price.id,
    provider: input.provider,
    providerSubscriptionId: input.providerSubscriptionId,
    status: 'active',
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    couponId: input.couponId ?? null,
    couponDiscountCents: input.couponDiscountCents ?? 0,
    couponRecurringDuration: input.couponRecurringDuration ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await deps.subscriptions.create(tenantId, subscription);
  await createOrRenewGrant(
    tenantId,
    {
      memberId: input.memberId,
      productId: input.price.productId,
      expiresAt: graceExpiresAt(periodEnd),
      source: grantSourceFor(input.provider),
    },
    deps,
  );
  const order =
    input.paidOrder ??
    (await appendOrder(
      tenantId,
      {
        memberId: input.memberId,
        productId: input.price.productId,
        priceId: input.price.id,
        kind: 'recurring',
        status: 'paid',
        amountCents: input.amountCents ?? input.price.amountCents,
        couponId: input.couponId ?? null,
        discountCents: input.couponDiscountCents ?? 0,
        currency: input.price.currency,
        provider: input.provider,
        providerObjectIds: input.providerObjectIds,
      },
      deps,
    ));
  return { subscription, order };
};

export interface InvoiceCycleInput {
  subscription: MemberSubscription;
  providerObjectIds: Record<string, string>;
  paidOrder?: Order;
  amountCents?: number;
  currency?: string;
  periodEnd?: string;
}

export const renewSubscriptionPeriod = async (
  tenantId: string,
  input: InvoiceCycleInput,
  deps: SubscriptionLifecycleDeps,
): Promise<{ subscription: MemberSubscription; order: Order }> => {
  const now = deps.clock.nowIso();
  const price = await deps.prices.findById(tenantId, input.subscription.priceId);
  const base = input.subscription.currentPeriodEnd > now ? input.subscription.currentPeriodEnd : now;
  const periodEnd = input.periodEnd ?? nextPeriodEnd(base, price?.interval ?? 'month');
  const subscription: MemberSubscription = {
    ...input.subscription,
    status: 'active',
    currentPeriodEnd: periodEnd,
    updatedAt: now,
  };
  await deps.subscriptions.update(tenantId, subscription);
  await createOrRenewGrant(
    tenantId,
    {
      memberId: subscription.memberId,
      productId: subscription.productId,
      expiresAt: graceExpiresAt(periodEnd),
      source: grantSourceFor(subscription.provider),
    },
    deps,
  );
  const order =
    input.paidOrder ??
    (await appendOrder(
      tenantId,
      {
        memberId: subscription.memberId,
        productId: subscription.productId,
        priceId: subscription.priceId,
        kind: 'recurring',
        status: 'paid',
        amountCents:
          input.amountCents ??
          Math.max(
            0,
            (price?.amountCents ?? 0) -
              (subscription.couponRecurringDuration === 'forever'
                ? subscription.couponDiscountCents
                : 0),
          ),
        currency: input.currency ?? price?.currency ?? 'PLN',
        provider: subscription.provider,
        providerObjectIds: input.providerObjectIds,
        couponId: subscription.couponRecurringDuration === 'forever' ? subscription.couponId : null,
        discountCents:
          subscription.couponRecurringDuration === 'forever'
            ? subscription.couponDiscountCents
            : 0,
      },
      deps,
    ));
  return { subscription, order };
};

export const failSubscriptionPayment = async (
  tenantId: string,
  input: Pick<InvoiceCycleInput, 'subscription' | 'providerObjectIds' | 'amountCents' | 'currency'>,
  deps: SubscriptionLifecycleDeps,
): Promise<{ subscription: MemberSubscription; order: Order }> => {
  const now = deps.clock.nowIso();
  const price = await deps.prices.findById(tenantId, input.subscription.priceId);
  const subscription: MemberSubscription = {
    ...input.subscription,
    status: 'past_due',
    updatedAt: now,
  };
  await deps.subscriptions.update(tenantId, subscription);
  const order = await appendOrder(
    tenantId,
    {
      memberId: subscription.memberId,
      productId: subscription.productId,
      priceId: subscription.priceId,
      kind: 'recurring',
      status: 'failed',
      amountCents: input.amountCents ?? price?.amountCents ?? 0,
      currency: input.currency ?? price?.currency ?? 'PLN',
      provider: subscription.provider,
      providerObjectIds: input.providerObjectIds,
    },
    deps,
  );
  return { subscription, order };
};

export const updateSubscriptionFromProvider = async (
  tenantId: string,
  input: {
    subscription: MemberSubscription;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd?: string | null;
    canceled?: boolean;
  },
  deps: Pick<SubscriptionLifecycleDeps, 'subscriptions' | 'clock'>,
): Promise<MemberSubscription> => {
  const subscription: MemberSubscription = {
    ...input.subscription,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    status: input.canceled === true ? 'canceled' : input.subscription.status,
    currentPeriodEnd: input.currentPeriodEnd ?? input.subscription.currentPeriodEnd,
    updatedAt: deps.clock.nowIso(),
  };
  await deps.subscriptions.update(tenantId, subscription);
  return subscription;
};
