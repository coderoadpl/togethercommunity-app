import {
  checkoutSessionInputSchema,
  err,
  notFound,
  ok,
  stripeKeyModeConflicts,
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
  OrderRepository,
  ProductPriceRepository,
  ProductPriceHistoryRepository,
  ProductRepository,
  SecretCrypto,
  TenantSecretRepository,
  TenantRepository,
} from '../ports.js';
import type { CheckoutSnapshotRepository } from '../checkout-snapshot-ports.js';
import type { SalesLinkRepository } from '../sales-link-ports.js';
import { validateCouponForCheckout } from './coupon-checkout.js';
import { resolveSalesLinkPrices, type CheckoutSelection } from './checkout-selection.js';
import { captureCheckoutSelection } from './checkout-lines.js';

export interface CheckoutDeps {
  salesLinks?: SalesLinkRepository;
  checkoutSnapshots?: CheckoutSnapshotRepository;
  tenants?: TenantRepository;
  products: ProductRepository;
  prices: ProductPriceRepository;
  tenantSecrets: TenantSecretRepository;
  payment: PaymentProvider;
  orders?: OrderRepository;
  coupons?: CouponRepository;
  couponRedemptions?: CouponRedemptionRepository;
  couponCheckoutSessions?: CouponCheckoutSessionRepository;
  priceHistory?: ProductPriceHistoryRepository;
  secretCrypto?: SecretCrypto;
  ids?: IdGenerator;
  clock?: Clock;
}

export type { CheckoutSelection } from './checkout-selection.js';

export const getPaymentConfig = async (
  tenantId: string,
  deps: Pick<CheckoutDeps, 'tenantSecrets' | 'secretCrypto'>,
  mode: 'live' | 'test' = 'live',
): Promise<Result<{ stripeConfigured: boolean }, AppError>> => {
  const [key, webhookSecret] = await Promise.all([
    deps.tenantSecrets.findByKey(tenantId, mode === 'test' ? 'stripe.testRestrictedKey' : 'stripe.restrictedKey'),
    deps.tenantSecrets.findByKey(tenantId, mode === 'test' ? 'stripe.testWebhookSecret' : 'stripe.webhookSecret'),
  ]);
  if (key === null || webhookSecret === null) return ok({ stripeConfigured: false });
  const decrypted = deps.secretCrypto?.decrypt(key);
  const conflicts = decrypted !== undefined && decrypted.ok && stripeKeyModeConflicts(decrypted.value, mode);
  return ok({ stripeConfigured: !conflicts });
};

export const testCheckoutRejection = (
  input: Pick<CheckoutSessionInput, 'couponCode'>,
  selection: CheckoutSelection,
): AppError | null =>
  input.couponCode !== undefined ||
  (selection.productPrices?.reduce((total, price) => total + price.amountCents, 0) ?? selection.price?.amountCents ?? selection.product.priceCents) === 0
    ? validation('Test checkout requires a paid price without a coupon')
    : null;

export const validateCheckoutSelection = async (
  tenantId: string,
  input: Pick<CheckoutSessionInput, 'productId' | 'priceId' | 'salesLinkId' | 'salesLinkSlug'>,
  deps: Pick<CheckoutDeps, 'products' | 'prices' | 'salesLinks' | 'clock'>,
): Promise<Result<CheckoutSelection, AppError>> => {
  if (input.salesLinkId !== undefined || input.salesLinkSlug !== undefined) {
    if (input.salesLinkId !== undefined && input.salesLinkSlug !== undefined) return err(validation('Invalid sales link selection'));
    const link = input.salesLinkSlug === undefined
      ? await deps.salesLinks?.findById(tenantId, input.salesLinkId ?? '')
      : await deps.salesLinks?.findBySlug(tenantId, input.salesLinkSlug);
    const now = deps.clock?.nowIso();
    if (link == null || !link.active || now === undefined ||
      (link.validFrom !== null && link.validFrom > now) || (link.validTo !== null && link.validTo <= now)) {
      return err(notFound('Sales link not found'));
    }
    if (input.priceId !== undefined || link.productIds[0] !== input.productId) return err(validation('Invalid sales link selection'));
    const products: Product[] = [];
    for (const productId of link.productIds) {
      const item = await deps.products.findById(tenantId, productId);
      if (item === null || !item.published) return err(notFound('Sales link not found'));
      if (item.type === 'membership') return err(validation('Subscriptions cannot be included in a sales link'));
      products.push(item);
    }
    const activePrices = await deps.prices.listActiveByProducts(tenantId, link.productIds);
    const resolvedPrices = resolveSalesLinkPrices(products, activePrices);
    if (!resolvedPrices.ok) return resolvedPrices;
    const product = products[0];
    if (product === undefined) return err(notFound('Sales link not found'));
    return ok({ product, price: null, products, productPrices: resolvedPrices.value, salesLinkId: link.id, salesLinkSlug: link.slug });
  }
  const product = await deps.products.findById(tenantId, input.productId);
  if (!product || !product.published) {
    return err(notFound(`No published product "${input.productId}" in this tenant`));
  }

  let price: ProductPrice | null = null;
  if (input.priceId !== undefined) {
    price = await deps.prices.findById(tenantId, input.priceId);
    if (!price || price.productId !== product.id || !price.active || price.imported === true || (price.interval !== null && price.interval !== 'month' && price.interval !== 'year')) {
      return err(notFound(`No active price "${input.priceId}" for this product`));
    }
  }

  if (product.type === 'physical' && price?.kind === 'recurring') {
    return err(validation('Physical products require a one-time price'));
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
  testSession?: { mode: 'test'; memberId: string },
): Promise<Result<{
  url: string;
  coupon?: CouponCheckoutBreakdown;
  couponCheckoutSessionId?: string;
  checkoutSnapshotId?: string;
  free: boolean;
}, AppError>> => {
  const { product, price } = selection;
  const captured = await captureCheckoutSelection(tenant.id, selection, deps);
  if (!captured.ok) return captured;
  const { totalCents, currency, lines, checkoutSnapshotId } = captured.value;
  const mode = testSession?.mode ?? 'live';
  if (mode === 'test') {
    const rejected = testCheckoutRejection(input, selection);
    if (rejected !== null) return err(rejected);
  }
  if (mode === 'test' && (deps.orders === undefined || deps.ids === undefined || deps.clock === undefined)) {
    return err(validation('Test checkout is not configured'));
  }
  const checkoutPath = selection.salesLinkSlug === undefined ? `${tenantBaseUrl}/checkout/${encodeURIComponent(product.id)}` : `${tenantBaseUrl}/offer/${encodeURIComponent(selection.salesLinkSlug)}`;
  const checkoutQuery = selection.salesLinkId === undefined ? '' : `&salesLinkId=${encodeURIComponent(selection.salesLinkId)}`;
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
        ...(selection.productPrices === undefined ? {} : { productIds: selection.productPrices.map((item) => item.productId), products: selection.productPrices.map((item) => ({ productId: item.productId, priceId: item.id, amountCents: item.amountCents })) }),
        priceId: price?.id ?? null,
        priceKind: price?.kind ?? 'one_time',
        amountCents: totalCents,
        currency,
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
        ...(checkoutSnapshotId === undefined ? {} : { checkoutSnapshotId }),
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
  if (totalCents === 0 && price?.kind !== 'recurring') {
    if (input.email === undefined) return err(validation('An email is required for free checkout'));
    return ok({ url: `${checkoutPath}?status=success&purchase_kind=${purchaseKind}`, free: true, ...(checkoutSnapshotId === undefined ? {} : { checkoutSnapshotId }) });
  }
  if (input.couponCode === undefined) {
    const configured = await getPaymentConfig(tenant.id, deps, mode);
    if (!configured.ok) return configured;
    if (!configured.value.stripeConfigured) return err(validation('Stripe is not configured for this tenant'));
  }
  const created = await deps.payment.createCheckoutSession({
    tenantId: tenant.id,
    mode,
    productId: product.id,
    productName: product.title,
    ...(selection.salesLinkId === undefined ? {} : { salesLinkId: selection.salesLinkId }),
    ...(checkoutSnapshotId === undefined ? {} : { checkoutSnapshotId }),
    ...(selection.products === undefined ? {} : { lines }),
    priceCents: totalCents,
    currency,
    successUrl: `${checkoutPath}?status=success${mode === 'test' ? '&test_purchase=1' : ''}&purchase_kind=${purchaseKind}${checkoutQuery}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${checkoutPath}?status=cancelled${checkoutQuery}`,
    ...(input.email === undefined ? {} : { customerEmail: input.email }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(price === null ? {} : { priceId: price.id }),
    ...(price !== null && price.kind === 'recurring' && (price.interval === 'month' || price.interval === 'year')
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
  if (testSession !== undefined && deps.orders !== undefined && deps.ids !== undefined && deps.clock !== undefined) {
    try {
      await deps.orders.create(tenant.id, {
        id: deps.ids.nextId(), tenantId: tenant.id, memberId: testSession.memberId,
        productId: product.id, priceId: price?.id ?? null, mode: 'test',
        kind: price?.kind ?? 'one_time', status: 'pending',
        amountCents: totalCents, currency,
        provider: 'stripe', providerObjectIds: { checkoutSession: created.value.sessionId },
        couponId: null, discountCents: 0, billing: null, lines, salesLinkId: selection.salesLinkId ?? null, createdAt: deps.clock.nowIso(),
      });
    } catch (cause) {
      await deps.payment.expireCheckoutSession({ tenantId: tenant.id, sessionId: created.value.sessionId, mode: 'test' });
      throw cause;
    }
  }
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
  checkoutSnapshotId?: string;
  free: boolean;
}, AppError>> => {
  const parsed = checkoutSessionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid checkout payload', parsed.error.flatten()));

  const selection = await validateCheckoutSelection(tenant.id, parsed.data, deps);
  if (!selection.ok) return selection;
  return startCheckoutSession(tenant, tenantBaseUrl, parsed.data, selection.value, deps);
};
