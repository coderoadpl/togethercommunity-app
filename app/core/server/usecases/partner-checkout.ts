import { err, normalisePartnerCode, ok, validatePartnerCode, validation, type AppError, type CouponCheckoutBreakdown, type CheckoutSnapshot, type PartnerCode, type Result } from '#core/domain/index.js';
import type { PartnerRepository } from '../partner-ports.js';
import type { Clock, PaymentProvider, ProductPriceHistoryRepository } from '../ports.js';
import { reconcilePartnerReservations } from './partner-reservations.js';
import type { SalesLinkRepository } from '../sales-link-ports.js';

interface PartnerCheckoutDeps {
  partners?: PartnerRepository;
  payment?: Pick<PaymentProvider, 'retrieveCheckoutSession'>;
  salesLinks?: SalesLinkRepository;
  clock?: Clock;
  priceHistory?: ProductPriceHistoryRepository;
}
import { COUPON_UNAVAILABLE_MESSAGE } from './coupon-checkout.js';

export const validatePartnerCodeForCheckout = async (
  tenantId: string,
  input: { code: string; salesLinkId?: string; amountCents: number; currency: string; products?: { productId: string; priceId?: string; amountCents: number }[] },
  deps: PartnerCheckoutDeps,
): Promise<Result<{ code: PartnerCode; breakdown: CouponCheckoutBreakdown; terms: NonNullable<CheckoutSnapshot['partnerTerms']> } | null, AppError>> => {
  const code = await deps.partners?.findCodeByCode(tenantId, normalisePartnerCode(input.code));
  if (code == null) return ok(null);
  if (input.salesLinkId === undefined) return err(validation('Partner codes require a sales-link offer'));
  const link = await deps.salesLinks?.findById(tenantId, input.salesLinkId);
  const now = deps.clock?.nowIso();
  if (deps.partners === undefined || now === undefined || !link?.allowsCodes) return err(validation(COUPON_UNAVAILABLE_MESSAGE));
  const [program, partner, initialRedemptions] = await Promise.all([
    deps.partners.findProgram(tenantId, code.programId), deps.partners.findPartner(tenantId, code.partnerId), deps.partners.countRedemptions(tenantId, code.id),
  ]);
  let totalRedemptions = initialRedemptions;
  if (code.maxRedemptions !== null && totalRedemptions >= code.maxRedemptions && deps.payment?.retrieveCheckoutSession !== undefined && deps.clock !== undefined) {
    const reconciled = await reconcilePartnerReservations(tenantId, code.id, { partners: deps.partners, payment: deps.payment, clock: deps.clock });
    if (!reconciled.ok) return reconciled;
    totalRedemptions = await deps.partners.countRedemptions(tenantId, code.id);
  }
  if (program?.status !== 'active' || partner?.status !== 'active' || code.discountPct > program.commissionPct || !validatePartnerCode(code, { now, salesLinkId: input.salesLinkId, totalRedemptions })) return err(validation(COUPON_UNAVAILABLE_MESSAGE));
  const discountCents = Math.min(input.amountCents, Math.floor((input.amountCents * code.discountPct + 50) / 100));
  const priceHistory = deps.priceHistory;
  const lowestPriceLast30DaysCents = priceHistory === undefined || input.products === undefined ? input.amountCents : (await Promise.all(input.products.map((product) => priceHistory.lowestSince(tenantId, {
    productId: product.productId, priceId: product.priceId ?? null, currentAmountCents: product.amountCents, through: now, since: new Date(Date.parse(now) - 30 * 86400000).toISOString(),
  })))).reduce((sum, amount) => sum + amount, 0);
  return ok({ code, terms: { commissionPct: program.commissionPct, discountPct: code.discountPct, graceDays: program.graceDays }, breakdown: { couponId: code.id, code: code.code, originalCents: input.amountCents, discountCents, finalCents: input.amountCents - discountCents, currency: input.currency, lowestPriceLast30DaysCents } });
};

export const materialisePartnerCode = async (tenantId: string, code: PartnerCode, currency: string, deps: { payment: PaymentProvider; partners?: PartnerRepository }): Promise<Result<{ promotionCodeId?: string }, AppError>> => {
  if (code.discountPct === 0) return ok({});
  if (deps.payment.ensureCouponPromotion === undefined || deps.partners === undefined) return err(validation('Partner checkout is not configured'));
  const promotion = await deps.payment.ensureCouponPromotion({ tenantId, couponId: code.id, code: code.code, kind: 'percent', value: code.discountPct, currency, recurringDuration: 'first_invoice', stripeCouponId: code.stripeCouponId, stripePromotionCodeId: code.stripePromotionCodeId });
  if (!promotion.ok) return promotion;
  const cached = await deps.partners.cacheStripeIds(tenantId, code.id, promotion.value, code.revision);
  if (cached === null) return err(validation(COUPON_UNAVAILABLE_MESSAGE));
  return ok({ promotionCodeId: promotion.value.stripePromotionCodeId });
};
