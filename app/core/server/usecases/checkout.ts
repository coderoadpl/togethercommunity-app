import {
  checkoutSessionInputSchema,
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type CheckoutSessionInput,
  type CouponCheckoutBreakdown,
  type Product,
  type ProductPrice,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type {
  Clock,
  CouponCheckoutSessionRepository,
  CouponRedemptionRepository,
  CouponRepository,
  IdGenerator,
  PaymentProvider,
  ProductPriceRepository,
  ProductPriceHistoryRepository,
  ProductRepository,
  TenantSecretRepository,
} from '../ports.js';
import { validateCouponForCheckout } from './coupon-checkout.js';

export interface CheckoutDeps {
  products: ProductRepository;
  prices: ProductPriceRepository;
  tenantSecrets: TenantSecretRepository;
  payment: PaymentProvider;
  coupons?: CouponRepository;
  couponRedemptions?: CouponRedemptionRepository;
  couponCheckoutSessions?: CouponCheckoutSessionRepository;
  priceHistory?: ProductPriceHistoryRepository;
  ids?: IdGenerator;
  clock?: Clock;
}

export interface CheckoutSelection {
  product: Product;
  price: ProductPrice | null;
}

export const getPaymentConfig = async (
  tenantId: string,
  deps: Pick<CheckoutDeps, 'tenantSecrets'>,
): Promise<Result<{ stripeConfigured: boolean }, AppError>> => {
  const [key, webhookSecret] = await Promise.all([
    deps.tenantSecrets.findByKey(tenantId, 'stripe.restrictedKey'),
    deps.tenantSecrets.findByKey(tenantId, 'stripe.webhookSecret'),
  ]);
  return ok({ stripeConfigured: key !== null && webhookSecret !== null });
};

export const validateCheckoutSelection = async (
  tenantId: string,
  input: Pick<CheckoutSessionInput, 'productId' | 'priceId'>,
  deps: Pick<CheckoutDeps, 'products' | 'prices'>,
): Promise<Result<CheckoutSelection, AppError>> => {
  const product = await deps.products.findById(tenantId, input.productId);
  if (!product || !product.published) {
    return err(notFound(`No published product "${input.productId}" in this tenant`));
  }

  let price: ProductPrice | null = null;
  if (input.priceId !== undefined) {
    price = await deps.prices.findById(tenantId, input.priceId);
    if (!price || price.productId !== product.id || !price.active) {
      return err(notFound(`No active price "${input.priceId}" for this product`));
    }
  }

  if (product.type === 'membership' && price?.kind !== 'recurring') {
    return err(validation('Membership products require a recurring price'));
  }

  return ok({ product, price });
};

export const startCheckoutSession = async (
  tenant: Tenant,
  tenantBaseUrl: string,
  input: CheckoutSessionInput,
  selection: CheckoutSelection,
  deps: CheckoutDeps,
  checkoutConsentCaptureId?: string,
): Promise<Result<{
  url: string;
  coupon?: CouponCheckoutBreakdown;
  couponCheckoutSessionId?: string;
  free: boolean;
}, AppError>> => {
  const { product, price } = selection;
  const checkoutPath = `${tenantBaseUrl}/checkout/${encodeURIComponent(product.id)}`;
  const purchaseKind = price?.kind === 'recurring' ? 'subscription' : 'one_time';
  let applied:
    | {
        breakdown: CouponCheckoutBreakdown;
        promotionCodeId: string;
        checkoutSessionId: string;
      }
    | undefined;
  if (input.couponCode !== undefined) {
    if (
      deps.coupons === undefined ||
      deps.couponRedemptions === undefined ||
      deps.couponCheckoutSessions === undefined ||
      deps.priceHistory === undefined ||
      deps.ids === undefined ||
      deps.clock === undefined
    ) {
      return err(validation('Coupon checkout is not configured'));
    }
    const validated = await validateCouponForCheckout(
      tenant.id,
      {
        code: input.couponCode,
        ...(input.email === undefined ? {} : { email: input.email }),
        productId: product.id,
        priceId: price?.id ?? null,
        priceKind: price?.kind ?? 'one_time',
        amountCents: price?.amountCents ?? product.priceCents,
        currency: price?.currency ?? product.currency,
      },
      {
        coupons: deps.coupons,
        redemptions: deps.couponRedemptions,
        priceHistory: deps.priceHistory,
        clock: deps.clock,
      },
    );
    if (!validated.ok) return validated;
    if (input.email === undefined) return err(validation('An email is required to use a coupon'));
    const checkoutSessionId = deps.ids.nextId();
    await deps.couponCheckoutSessions.create(tenant.id, {
      id: checkoutSessionId,
      tenantId: tenant.id,
      couponId: validated.value.coupon.id,
      providerSessionId: null,
      memberEmail: input.email,
      productId: product.id,
      priceId: price?.id ?? null,
      originalCents: validated.value.breakdown.originalCents,
      discountCents: validated.value.breakdown.discountCents,
      finalCents: validated.value.breakdown.finalCents,
      currency: validated.value.breakdown.currency,
      startedAt: deps.clock.nowIso(),
    });
    if (validated.value.breakdown.finalCents === 0 && price?.kind !== 'recurring') {
      return ok({
        url: `${checkoutPath}?status=success&purchase_kind=${purchaseKind}`,
        coupon: validated.value.breakdown,
        couponCheckoutSessionId: checkoutSessionId,
        free: true,
      });
    }
    if (deps.payment.ensureCouponPromotion === undefined) {
      return err(validation('Coupon checkout is not configured'));
    }
    const promotion = await deps.payment.ensureCouponPromotion({
      tenantId: tenant.id,
      couponId: validated.value.coupon.id,
      code: validated.value.breakdown.code,
      kind: validated.value.coupon.kind,
      value: validated.value.coupon.value,
      currency: validated.value.breakdown.currency,
      recurringDuration: validated.value.coupon.recurringDuration,
      stripeCouponId: validated.value.coupon.stripeCouponId,
      stripePromotionCodeId: validated.value.coupon.stripePromotionCodeId,
    });
    if (!promotion.ok) return promotion;
    await deps.coupons.cacheStripeIds(tenant.id, validated.value.coupon.id, promotion.value);
    applied = {
      breakdown: validated.value.breakdown,
      promotionCodeId: promotion.value.stripePromotionCodeId,
      checkoutSessionId,
    };
  }
  const created = await deps.payment.createCheckoutSession({
    tenantId: tenant.id,
    productId: product.id,
    productName: product.title,
    priceCents: price?.amountCents ?? product.priceCents,
    currency: price?.currency ?? product.currency,
    successUrl: `${checkoutPath}?status=success&purchase_kind=${purchaseKind}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${checkoutPath}?status=cancelled`,
    ...(input.email === undefined ? {} : { customerEmail: input.email }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(price === null ? {} : { priceId: price.id }),
    ...(price !== null && price.kind === 'recurring' && price.interval !== null
      ? { recurringInterval: price.interval }
      : {}),
    ...(checkoutConsentCaptureId === undefined ? {} : { checkoutConsentCaptureId }),
    ...(applied === undefined
      ? {}
      : {
          promotionCodeId: applied.promotionCodeId,
          couponCheckoutSessionId: applied.checkoutSessionId,
        }),
  });
  if (!created.ok) return created;
  if (applied !== undefined && deps.couponCheckoutSessions !== undefined) {
    await deps.couponCheckoutSessions.attachProviderSession(
      tenant.id,
      applied.checkoutSessionId,
      created.value.sessionId,
    );
  }
  return ok({
    url: created.value.url,
    ...(applied === undefined ? {} : { coupon: applied.breakdown }),
    ...(applied === undefined ? {} : { couponCheckoutSessionId: applied.checkoutSessionId }),
    free: false,
  });
};

export const createCheckoutSession = async (
  tenant: Tenant,
  tenantBaseUrl: string,
  input: CheckoutSessionInput,
  deps: CheckoutDeps,
): Promise<Result<{
  url: string;
  coupon?: CouponCheckoutBreakdown;
  couponCheckoutSessionId?: string;
  free: boolean;
}, AppError>> => {
  const parsed = checkoutSessionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid checkout payload', parsed.error.flatten()));

  const selection = await validateCheckoutSelection(tenant.id, parsed.data, deps);
  if (!selection.ok) return selection;
  if (parsed.data.couponCode === undefined) {
    const configured = await getPaymentConfig(tenant.id, deps);
    if (!configured.ok) return configured;
    if (!configured.value.stripeConfigured) {
      return err(validation('Stripe is not configured for this tenant'));
    }
  }
  return startCheckoutSession(tenant, tenantBaseUrl, parsed.data, selection.value, deps);
};
