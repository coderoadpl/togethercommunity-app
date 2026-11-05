import {
  attributionSchema,
  attributionToSearchParams,
  checkoutSessionInputSchema,
  checkoutShippingInputSchema,
  err,
  FREE_ORDER_DELIVERY_UNAVAILABLE,
  normalizeCouponCode,
  notFound,
  ok,
  productLines,
  resolveCheckoutBranding,
  resolveCheckoutShipping,
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
import { captureCouponCheckout, ensureCheckoutCouponPromotion, validateSelectionCoupon } from './checkout-coupon.js';
import { resolveSalesLinkPrices, type CheckoutSelection } from './checkout-selection.js';
import { buildCheckoutLines, captureCheckoutSelection } from './checkout-lines.js';

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

const selectCheckoutProducts = async (
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

  if ((product.type === 'physical' || product.deliveryMethod === 'shipping') && price?.kind === 'recurring') {
    return err(validation('Physical products require a one-time price'));
  }
  if (product.type === 'membership' && price?.kind !== 'recurring') {
    return err(validation('Membership products require a recurring price'));
  }

  return ok({ product, price });
};

export const validateCheckoutSelection = async (
  tenantId: string,
  input: Pick<CheckoutSessionInput, 'productId' | 'priceId' | 'salesLinkId' | 'salesLinkSlug' | 'shipping'>,
  deps: Pick<CheckoutDeps, 'products' | 'prices' | 'salesLinks' | 'clock' | 'tenants'>,
  options: { shipping: 'resolve' | 'ignore' } = { shipping: 'resolve' },
): Promise<Result<CheckoutSelection, AppError>> => {
  const selection = await selectCheckoutProducts(tenantId, input, deps);
  if (!selection.ok || options.shipping === 'ignore') return selection;
  const shippingInput = input.shipping === undefined ? undefined : checkoutShippingInputSchema.safeParse(input.shipping);
  if (shippingInput !== undefined && !shippingInput.success) return err(validation('Invalid delivery selection', shippingInput.error.flatten()));
  const products = selection.value.products ?? [selection.value.product];
  const settings = products.some((product) => product.deliveryMethod === 'shipping') ? await deps.tenants?.findSettings(tenantId) : null;
  const shipping = resolveCheckoutShipping(products, settings?.shippingRates, shippingInput?.data);
  if (!shipping.ok) return shipping;
  return ok(shipping.value === null ? selection.value : { ...selection.value, shipping: shipping.value });
};

const freeShippedOrder = async (
  tenantId: string,
  input: Pick<CheckoutSessionInput, 'couponCode' | 'email'>,
  selection: CheckoutSelection,
  deps: CheckoutDeps,
): Promise<boolean> => {
  if (selection.shipping === undefined || selection.shipping.amountCents > 0 || selection.price?.kind === 'recurring') return false;
  const built = await buildCheckoutLines(tenantId, selection, deps);
  if (!built.ok) return false;
  if (built.value.totalCents === 0) return true;
  if (input.couponCode === undefined) return false;
  const coupon = await validateSelectionCoupon(tenantId, {
    code: input.couponCode,
    ...(input.email === undefined ? {} : { email: input.email }),
    amountCents: built.value.totalCents, currency: built.value.currency,
  }, selection, deps);
  return coupon.ok && coupon.value.breakdown.finalCents === 0;
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
  const fields = attributionSchema.parse(input.attribution);
  if (fields !== undefined && deps.clock === undefined) return err(validation('Checkout clock is not configured'));
  const attribution = fields === undefined || deps.clock === undefined ? undefined : { ...fields, capturedAt: deps.clock.nowIso() };
  if (await freeShippedOrder(tenant.id, input, selection, deps)) return err(validation(FREE_ORDER_DELIVERY_UNAVAILABLE));
  const captured = await captureCheckoutSelection(tenant.id, selection, deps, attribution);
  if (!captured.ok) return captured;
  const { totalCents, currency, lines, checkoutSnapshotId } = captured.value;
  const shippingCents = captured.value.shippingCents ?? 0;
  const shipping = selection.shipping;
  const mode = testSession?.mode ?? 'live';
  if (mode === 'test') {
    const rejected = testCheckoutRejection(input, selection);
    if (rejected !== null) return err(rejected);
  }
  if (testSession !== undefined && (deps.orders === undefined || deps.ids === undefined || deps.clock === undefined)) {
    return err(validation('Test checkout is not configured'));
  }
  const checkoutPath = selection.salesLinkSlug === undefined ? `${tenantBaseUrl}/checkout/${encodeURIComponent(product.id)}` : `${tenantBaseUrl}/offer/${encodeURIComponent(selection.salesLinkSlug)}`;
  const checkoutQuery = selection.salesLinkId === undefined ? '' : `&salesLinkId=${encodeURIComponent(selection.salesLinkId)}`;
  const campaignQuery = attributionToSearchParams(fields).toString();
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
    const validated = await validateSelectionCoupon(tenant.id, {
      code: input.couponCode,
      ...(input.email === undefined ? {} : { email: input.email }),
      amountCents: totalCents, currency,
    }, selection, deps);
    if (!validated.ok) return validated;
    if (input.email === undefined) return err(validation('An email is required to use a coupon'));
    const capturedCoupon = await captureCouponCheckout(tenant.id, { ...validated.value, memberEmail: input.email }, selection, deps);
    if (!capturedCoupon.ok) return capturedCoupon;
    const checkoutSessionId = capturedCoupon.value;
    if (validated.value.breakdown.finalCents === 0 && shippingCents === 0 && price?.kind !== 'recurring') {
      if (shipping !== undefined) return err(validation(FREE_ORDER_DELIVERY_UNAVAILABLE));
      return ok({
        url: `${checkoutPath}?status=success&purchase_kind=${purchaseKind}`,
        coupon: validated.value.breakdown,
        couponCheckoutSessionId: checkoutSessionId,
        ...(checkoutSnapshotId === undefined ? {} : { checkoutSnapshotId }),
        free: true,
      });
    }
    const promotion = await ensureCheckoutCouponPromotion(tenant.id, validated.value, deps);
    if (!promotion.ok) return promotion;
    applied = {
      breakdown: validated.value.breakdown,
      promotionCodeId: promotion.value.stripePromotionCodeId,
      checkoutSessionId,
    };
  }
  if (totalCents === 0 && shippingCents === 0 && price?.kind !== 'recurring') {
    if (shipping !== undefined) return err(validation(FREE_ORDER_DELIVERY_UNAVAILABLE));
    if (input.email === undefined) return err(validation('An email is required for free checkout'));
    return ok({ url: `${checkoutPath}?status=success&purchase_kind=${purchaseKind}`, free: true, ...(checkoutSnapshotId === undefined ? {} : { checkoutSnapshotId }) });
  }
  if (input.couponCode === undefined) {
    const configured = await getPaymentConfig(tenant.id, deps, mode);
    if (!configured.ok) return configured;
    if (!configured.value.stripeConfigured) return err(validation('Stripe is not configured for this tenant'));
  }
  const tenantSettings = await deps.tenants?.findSettings(tenant.id);
  const checkoutBranding = tenantSettings == null ? undefined : resolveCheckoutBranding(tenantSettings, tenantBaseUrl);
  const couponQuery = applied === undefined || input.couponCode === undefined ? '' : `&code=${encodeURIComponent(normalizeCouponCode(input.couponCode))}`;
  const created = await deps.payment.createCheckoutSession({
    tenantId: tenant.id,
    ...(attribution === undefined ? {} : { attribution }),
    ...(checkoutBranding === undefined ? {} : { checkoutBranding }),
    mode,
    productId: product.id,
    productName: product.title,
    ...(selection.salesLinkId === undefined ? {} : { salesLinkId: selection.salesLinkId }),
    ...(checkoutSnapshotId === undefined ? {} : { checkoutSnapshotId }),
    ...(selection.products === undefined ? {} : { lines: productLines(lines) }),
    ...(shipping === undefined ? {} : {
      shipping: {
        allowedCountries: shipping.allowedCountries,
        phone: true,
        option: {
          label: shipping.label,
          amountCents: shipping.amountCents,
          currency,
          ...(shipping.deliveryEstimateDays === undefined ? {} : { deliveryEstimateDays: shipping.deliveryEstimateDays }),
        },
      },
    }),
    priceCents: totalCents,
    currency,
    successUrl: `${checkoutPath}?status=success${mode === 'test' ? '&test_purchase=1' : ''}&purchase_kind=${purchaseKind}${checkoutQuery}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${checkoutPath}?status=cancelled${selection.salesLinkId !== undefined ? '&checkout=together' : ''}${checkoutQuery}${couponQuery}${campaignQuery === '' ? '' : `&${campaignQuery}`}`,
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
  if (checkoutSnapshotId !== undefined && deps.checkoutSnapshots !== undefined) {
    try {
      await deps.checkoutSnapshots.attachProviderSession(tenant.id, checkoutSnapshotId, created.value.sessionId);
    } catch (cause) {
      await deps.payment.expireCheckoutSession({ tenantId: tenant.id, sessionId: created.value.sessionId, mode });
      throw cause;
    }
  }
  if (testSession !== undefined && deps.orders !== undefined && deps.ids !== undefined && deps.clock !== undefined) {
    try {
      await deps.orders.create(tenant.id, {
        id: deps.ids.nextId(), tenantId: tenant.id, memberId: testSession.memberId,
        productId: product.id, priceId: price?.id ?? null, mode: 'test',
        kind: price?.kind ?? 'one_time', status: 'pending', attribution: attribution ?? null,
        amountCents: totalCents + shippingCents, currency,
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
