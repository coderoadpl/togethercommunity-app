import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type GrantedProduct,
  type GrantWindowStatus,
  type MemberGrant,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, ProductGrantRepository } from '../ports.js';

export interface MyProductsDeps {
  grants: ProductGrantRepository;
  clock: Clock;
}

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

export const listMyProducts = async (
  ctx: Ctx,
  deps: MyProductsDeps,
): Promise<Result<GrantedProduct[], AppError>> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to see your products'));
  if (!ctx.identity.memberId) return err(forbidden('Only members can list their products'));

  const { tenantId, memberId } = ctx.identity;
  const now = deps.clock.nowIso();
  const nowMs = new Date(now).getTime();
  const [grants, products] = await Promise.all([
    deps.grants.listForMemberWithProductNames(tenantId, memberId, now),
    deps.grants.listGrantedProducts(tenantId, memberId),
  ]);

  const bestGrantByProduct = new Map<string, MemberGrant>();
  for (const grant of grants) {
    const current = bestGrantByProduct.get(grant.productId);
    bestGrantByProduct.set(
      grant.productId,
      current ? preferGrant(current, grant, nowMs) : grant,
    );
  }

  const seen = new Set<string>();
  const result: GrantedProduct[] = [];
  for (const product of products) {
    if (seen.has(product.id)) continue;
    const grant = bestGrantByProduct.get(product.id);
    if (!grant) continue;
    seen.add(product.id);
    result.push({
      ...product,
      grantStatus: grantStatus(grant, nowMs),
      grantStartsAt: grant.startsAt,
      grantExpiresAt: grant.expiresAt,
    });
  }
  return ok(result);
};
