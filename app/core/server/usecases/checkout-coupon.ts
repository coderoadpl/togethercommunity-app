import { err, ok, validation, type Coupon, type CouponCheckoutBreakdown } from '#core/domain/index.js';
import type { Clock, CouponCheckoutSessionRepository, CouponRedemptionRepository, CouponRepository, IdGenerator, PaymentProvider, ProductPriceHistoryRepository } from '../ports.js';
import type { CheckoutSelection } from './checkout-selection.js';
import { evaluateCouponForCheckout, requireCouponEmail } from './coupon-checkout.js';

interface CheckoutCouponDeps {
  coupons?: CouponRepository;
  couponRedemptions?: CouponRedemptionRepository;
  couponCheckoutSessions?: CouponCheckoutSessionRepository;
  priceHistory?: ProductPriceHistoryRepository;
  clock?: Clock;
  ids?: IdGenerator;
  payment: PaymentProvider;
}

type SelectionCouponInput = { code: string; coupon?: Coupon; email?: string; amountCents: number; currency: string };

export const evaluateSelectionCoupon = async (
  tenantId: string,
  input: SelectionCouponInput,
  selection: CheckoutSelection,
  deps: CheckoutCouponDeps,
) => {
  if (deps.coupons === undefined || deps.couponRedemptions === undefined || deps.priceHistory === undefined || deps.clock === undefined) {
    return err(validation('Coupon checkout is not configured'));
  }
  return evaluateCouponForCheckout(tenantId, {
    ...input,
    productId: selection.product.id,
    ...(selection.productPrices === undefined ? {} : {
      productIds: selection.productPrices.map((item) => item.productId),
      products: selection.productPrices.map((item) => ({ productId: item.productId, priceId: item.id, amountCents: item.amountCents })),
    }),
    priceId: selection.price?.id ?? null,
    priceKind: selection.price?.kind ?? 'one_time',
  }, { coupons: deps.coupons, redemptions: deps.couponRedemptions, priceHistory: deps.priceHistory, clock: deps.clock });
};

export const validateSelectionCoupon = async (
  tenantId: string,
  input: SelectionCouponInput,
  selection: CheckoutSelection,
  deps: CheckoutCouponDeps,
) => requireCouponEmail(await evaluateSelectionCoupon(tenantId, input, selection, deps));

export const captureCouponCheckout = async (
  tenantId: string,
  input: { coupon: Coupon; breakdown: CouponCheckoutBreakdown; memberEmail: string | null },
  selection: CheckoutSelection,
  deps: CheckoutCouponDeps,
) => {
  if (deps.couponCheckoutSessions === undefined || deps.ids === undefined || deps.clock === undefined) {
    return err(validation('Coupon checkout is not configured'));
  }
  const checkoutSessionId = deps.ids.nextId();
  await deps.couponCheckoutSessions.create(tenantId, {
    id: checkoutSessionId, tenantId, couponId: input.coupon.id, providerSessionId: null,
    memberEmail: input.memberEmail, productId: selection.product.id, priceId: selection.price?.id ?? null,
    originalCents: input.breakdown.originalCents, discountCents: input.breakdown.discountCents,
    finalCents: input.breakdown.finalCents, currency: input.breakdown.currency, startedAt: deps.clock.nowIso(),
  });
  return ok(checkoutSessionId);
};

export const ensureCheckoutCouponPromotion = async (
  tenantId: string,
  input: { coupon: Coupon; breakdown: CouponCheckoutBreakdown },
  deps: CheckoutCouponDeps,
) => {
  if (deps.payment.ensureCouponPromotion === undefined || deps.coupons === undefined) {
    return err(validation('Coupon checkout is not configured'));
  }
  const promotion = await deps.payment.ensureCouponPromotion({
    tenantId, couponId: input.coupon.id, code: input.breakdown.code,
    kind: input.coupon.kind, value: input.coupon.value, currency: input.breakdown.currency,
    recurringDuration: input.coupon.recurringDuration,
    stripeCouponId: input.coupon.stripeCouponId, stripePromotionCodeId: input.coupon.stripePromotionCodeId,
  });
  if (!promotion.ok) return promotion;
  await deps.coupons.cacheStripeIds(tenantId, input.coupon.id, promotion.value);
  return promotion;
};
