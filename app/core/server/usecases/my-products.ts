import {
  err,
  forbidden,
  ok,
  type AppError,
  type GrantedProduct,
  type GrantWindowStatus,
  type MemberGrant,
  type MemberSubscription,
  type MemberSubscriptionSummary,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { Clock, MemberSubscriptionRepository, ProductGrantRepository } from '../ports.js';

export interface MyProductsDeps {
  grants: ProductGrantRepository;
  subscriptions: MemberSubscriptionRepository;
  clock: Clock;
}

export type MyProduct = GrantedProduct & { subscription: MemberSubscriptionSummary | null };

const statusRank: Record<GrantWindowStatus, number> = { active: 0, upcoming: 1, expired: 2 };

const grantStatus = (grant: MemberGrant, nowMs: number): GrantWindowStatus => {
  if (grant.active) return 'active';
  if (new Date(grant.startsAt).getTime() > nowMs) return 'upcoming';
  return 'expired';
};

const preferGrant = (a: MemberGrant, b: MemberGrant, nowMs: number): MemberGrant => {
  const rankDiff = statusRank[grantStatus(a, nowMs)] - statusRank[grantStatus(b, nowMs)];
  if (rankDiff !== 0) return rankDiff < 0 ? a : b;
  return a.startsAt >= b.startsAt ? a : b;
};

const toSubscriptionSummary = (subscription: MemberSubscription): MemberSubscriptionSummary => ({
  id: subscription.id,
  status: subscription.status,
  currentPeriodEnd: subscription.currentPeriodEnd,
  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
});

export const listMyProducts = async (
  ctx: Ctx,
  deps: MyProductsDeps,
): Promise<Result<MyProduct[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:product:read');
  if (!tenant.ok) return tenant;
  if (!ctx.identity.memberId) return err(forbidden('Only members can list their products'));

  const tenantId = tenant.value;
  const { memberId } = ctx.identity;
  const now = deps.clock.nowIso();
  const nowMs = new Date(now).getTime();
  const [grants, products, subscriptions] = await Promise.all([
    deps.grants.listForMemberWithProductNames(tenantId, memberId, now),
    deps.grants.listGrantedProducts(tenantId, memberId),
    deps.subscriptions.listForMember(tenantId, memberId),
  ]);

  const bestGrantByProduct = new Map<string, MemberGrant>();
  for (const grant of grants) {
    const current = bestGrantByProduct.get(grant.productId);
    bestGrantByProduct.set(
      grant.productId,
      current ? preferGrant(current, grant, nowMs) : grant,
    );
  }

  const subscriptionByProduct = new Map<string, MemberSubscription>();
  for (const subscription of subscriptions) {
    const current = subscriptionByProduct.get(subscription.productId);
    if (!current || subscription.updatedAt >= current.updatedAt) {
      subscriptionByProduct.set(subscription.productId, subscription);
    }
  }

  const seen = new Set<string>();
  const result: MyProduct[] = [];
  for (const product of products) {
    if (seen.has(product.id)) continue;
    const grant = bestGrantByProduct.get(product.id);
    if (!grant) continue;
    seen.add(product.id);
    const subscription = subscriptionByProduct.get(product.id);
    result.push({
      ...product,
      grantStatus: grantStatus(grant, nowMs),
      grantStartsAt: grant.startsAt,
      grantExpiresAt: grant.expiresAt,
      subscription: subscription ? toSubscriptionSummary(subscription) : null,
    });
  }
  return ok(result);
};
