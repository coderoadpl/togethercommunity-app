import { attributionSchema, attributionToSearchParams, type Attribution, type AppError, type Coupon, type CouponCheckoutBreakdown, type Result, err, normalizeCouponCode, notFound, ok, resolveCancelReturnUrl, resolveCheckoutBranding, validation, type Tenant } from '#core/domain/index.js';
import { captureCouponCheckout, ensureCheckoutCouponPromotion, validateSelectionCoupon } from './checkout-coupon.js';
import { buildCheckoutLines } from './checkout-lines.js';
import { getPaymentConfig, validateCheckoutSelection, type CheckoutDeps, type CheckoutSelection } from './checkout.js';

type DirectSalesLinkCoupon =
  | { kind: 'none' | 'invalid' | 'requiresEmail' }
  | { kind: 'applied'; coupon: Coupon; breakdown: CouponCheckoutBreakdown };

const resolveSelectionCoupon = async (
  tenantId: string,
  couponCode: string | undefined,
  selection: CheckoutSelection,
  amount: { totalCents: number; currency: string },
  deps: CheckoutDeps,
): Promise<Result<DirectSalesLinkCoupon, AppError>> => {
  if (couponCode === undefined || normalizeCouponCode(couponCode) === '') return ok({ kind: 'none' });
  const code = normalizeCouponCode(couponCode);
  if (code.length > 64) return ok({ kind: 'invalid' });
  const coupon = await deps.coupons?.findByCode(tenantId, code);
  if (coupon == null) return ok({ kind: 'invalid' });
  if (coupon.maxRedemptionsPerMember !== null) return ok({ kind: 'requiresEmail' });
  const validated = await validateSelectionCoupon(tenantId, {
    code, amountCents: amount.totalCents, currency: amount.currency,
  }, selection, deps);
  return validated.ok ? ok({ kind: 'applied', ...validated.value }) : ok({ kind: 'invalid' });
};

export const resolveDirectSalesLinkCoupon = async (
  tenantId: string,
  input: { slug: string; couponCode?: string },
  deps: CheckoutDeps,
): Promise<Result<DirectSalesLinkCoupon, AppError>> => {
  if (input.couponCode === undefined || normalizeCouponCode(input.couponCode) === '') return ok({ kind: 'none' });
  const link = await deps.salesLinks?.findBySlug(tenantId, input.slug);
  const productId = link?.productIds[0];
  if (productId === undefined) return err(notFound('Sales link not found'));
  const selection = await validateCheckoutSelection(tenantId, { productId, salesLinkSlug: input.slug }, deps);
  if (!selection.ok) return selection;
  const built = await buildCheckoutLines(tenantId, selection.value, deps);
  if (!built.ok) return built;
  return resolveSelectionCoupon(tenantId, input.couponCode, selection.value, built.value, deps);
};

export const createDirectSalesLinkCheckout = async (
  tenant: Tenant,
  tenantBaseUrl: string,
  input: {
    slug: string;
    couponCode?: string;
    attribution?: Attribution;
    returnUrl?: string;
    termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }, language: 'en' | 'pl') => string;
  },
  deps: CheckoutDeps & { logger: { warn(message: string): void } },
) => {
  const link = await deps.salesLinks?.findBySlug(tenant.id, input.slug);
  const productId = link?.productIds[0];
  if (link == null || productId === undefined) return err(notFound('Sales link not found'));
  const selection = await validateCheckoutSelection(tenant.id, { productId, salesLinkSlug: input.slug }, deps);
  if (!selection.ok) return selection;
  if (selection.value.products?.some((product) => (product.checkoutConsentDefinitionIds?.length ?? 0) > 0)) {
    return err(validation('This sales link requires the workspace checkout page'));
  }
  const settings = await deps.tenants?.findSettings(tenant.id);
  if (!settings?.termsUrl || !settings.privacyUrl) return err(validation('Configure terms and privacy URLs before starting checkout'));
  if (deps.checkoutSnapshots === undefined || deps.ids === undefined || deps.clock === undefined) {
    return err(validation('Sales link checkout is not configured'));
  }
  const mode = 'live';
  const configured = await getPaymentConfig(tenant.id, deps, mode);
  if (!configured.ok) return configured;
  if (!configured.value.stripeConfigured) return err(validation('Stripe is not configured for this tenant'));
  const built = await buildCheckoutLines(tenant.id, selection.value, deps);
  if (!built.ok) return built;
  const coupon = await resolveSelectionCoupon(tenant.id, input.couponCode, selection.value, built.value, deps);
  if (!coupon.ok) return coupon;
  if (coupon.value.kind === 'requiresEmail') {
    const query = attributionToSearchParams(input.attribution);
    query.set('checkout', 'together');
    query.set('code', normalizeCouponCode(input.couponCode ?? ''));
    const returnUrl = resolveCancelReturnUrl(link.cancelReturnUrl, input.returnUrl);
    if (returnUrl !== undefined && returnUrl !== null) query.set('return', returnUrl);
    return ok({ url: `${tenantBaseUrl}/offer/${encodeURIComponent(input.slug)}?${query}` });
  }
  let applied: { promotionCodeId: string; couponCheckoutSessionId: string } | undefined;
  if (coupon.value.kind === 'applied') {
    const promotion = await ensureCheckoutCouponPromotion(tenant.id, coupon.value, deps);
    if (!promotion.ok) {
      deps.logger.warn(`[direct-checkout] Coupon promotion unavailable tenant=${tenant.id}: ${promotion.error.message}`);
    } else {
      const captured = await captureCouponCheckout(tenant.id, { ...coupon.value, memberEmail: null }, selection.value, deps);
      if (!captured.ok) {
        deps.logger.warn(`[direct-checkout] Coupon capture unavailable tenant=${tenant.id}: ${captured.error.message}`);
      } else {
        applied = { promotionCodeId: promotion.value.stripePromotionCodeId, couponCheckoutSessionId: captured.value };
      }
    }
  }
  const language = settings.defaultLanguage ?? 'en';
  const legal = { termsUrl: settings.termsUrl, privacyUrl: settings.privacyUrl };
  const termsAcceptanceMessage = input.termsAcceptanceMessage(legal, language);
  if (termsAcceptanceMessage.length > 1200) return err(validation('Checkout terms acceptance text exceeds 1200 characters'));
  const fields = attributionSchema.parse(input.attribution);
  const attribution = fields === undefined ? undefined : { ...fields, capturedAt: deps.clock.nowIso() };
  const checkoutSnapshotId = deps.ids.nextId();
  const checkoutBranding = resolveCheckoutBranding(settings, tenantBaseUrl);
  const checkoutPath = `${tenantBaseUrl}/offer/${encodeURIComponent(input.slug)}`;
  const checkoutQuery = `&salesLinkId=${encodeURIComponent(link.id)}`;
  let cancelUrl = resolveCancelReturnUrl(link.cancelReturnUrl, input.returnUrl) ?? `${checkoutPath}?status=cancelled${checkoutQuery}`;
  if (fields !== undefined) {
    const attributedUrl = new URL(cancelUrl);
    attributionToSearchParams(fields).forEach((value, key) => attributedUrl.searchParams.set(key, value));
    cancelUrl = attributedUrl.toString();
  }
  const created = await deps.payment.createCheckoutSession({
    tenantId: tenant.id,
    mode,
    productId,
    productName: selection.value.product.title,
    salesLinkId: link.id,
    checkoutSnapshotId,
    ...(attribution === undefined ? {} : { attribution }),
    lines: built.value.lines,
    priceCents: built.value.totalCents,
    currency: built.value.currency,
    language,
    successUrl: `${checkoutPath}?status=success&purchase_kind=one_time${checkoutQuery}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl,
    directCheckout: { ...legal, termsAcceptanceMessage },
    ...applied,
    ...(checkoutBranding === undefined ? {} : { checkoutBranding }),
  });
  if (!created.ok) return created;
  try {
    if (applied !== undefined && deps.couponCheckoutSessions !== undefined) {
      await deps.couponCheckoutSessions.attachProviderSession(tenant.id, applied.couponCheckoutSessionId, created.value.sessionId);
    }
    await deps.checkoutSnapshots.create(tenant.id, {
      id: checkoutSnapshotId, tenantId: tenant.id, salesLinkId: link.id,
      attribution: attribution ?? null,
      lines: built.value.lines, currency: built.value.currency,
      mode, providerSessionId: created.value.sessionId, createdAt: deps.clock.nowIso(),
    });
  } catch (cause) {
    await deps.payment.expireCheckoutSession({ tenantId: tenant.id, sessionId: created.value.sessionId, mode });
    throw cause;
  }
  return ok({ url: created.value.url });
};
