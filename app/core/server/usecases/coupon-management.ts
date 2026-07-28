import {
  couponCreateInputSchema,
  couponEventSchema,
  couponSchema,
  err,
  forbidden,
  normalizeCouponCode,
  notFound,
  ok,
  tenantNotFound,
  validation,
  type AppError,
  type Coupon,
  type CouponCreateInput,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, CouponManagementRepository, IdGenerator } from '../ports.js';

interface CouponManagementDeps {
  coupons: CouponManagementRepository;
  ids: IdGenerator;
  clock: Clock;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound('Select a tenant to manage coupons'));
  if (ctx.identity.staffRole === null) return err(forbidden('Only tenant staff can manage coupons'));
  return ok(ctx.identity.tenantId);
};

export const createCoupon = async (
  ctx: Ctx,
  input: CouponCreateInput,
  deps: CouponManagementDeps,
): Promise<Result<{ coupon: Coupon }, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = couponCreateInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid coupon payload', parsed.error.flatten()));
  const occurredAt = deps.clock.nowIso();
  const coupon = couponSchema.parse({
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    ...parsed.data,
    code: normalizeCouponCode(parsed.data.code),
    status: 'active',
    stripeCouponId: null,
    stripePromotionCodeId: null,
    createdAt: occurredAt,
  });
  const event = couponEventSchema.parse({
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    couponId: coupon.id,
    type: 'created',
    occurredAt,
  });
  const created = await deps.coupons.create(tenant.value, coupon, event);
  return created === null
    ? err(validation('A coupon with this code already exists'))
    : ok({ coupon: created });
};

export const archiveCoupon = async (
  ctx: Ctx,
  input: { id: string },
  deps: CouponManagementDeps,
): Promise<Result<{ coupon: Coupon }, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const occurredAt = deps.clock.nowIso();
  const archived = await deps.coupons.archive(
    tenant.value,
    input.id,
    couponEventSchema.parse({
      id: deps.ids.nextId(),
      tenantId: tenant.value,
      couponId: input.id,
      type: 'archived',
      occurredAt,
    }),
  );
  return archived === null ? err(notFound('Coupon was not found')) : ok({ coupon: archived });
};
