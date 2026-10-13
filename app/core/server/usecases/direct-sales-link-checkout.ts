import { err, notFound, ok, resolveCancelReturnUrl, resolveCheckoutBranding, validation, type Tenant } from '#core/domain/index.js';
import { materialisePartnerCode, validatePartnerCodeForCheckout } from './partner-checkout.js';
import { COUPON_UNAVAILABLE_MESSAGE } from './coupon-checkout.js';
import { buildCheckoutLines } from './checkout-lines.js';
import { getPaymentConfig, validateCheckoutSelection, type CheckoutDeps } from './checkout.js';

export const createDirectSalesLinkCheckout = async (
  tenant: Tenant,
  tenantBaseUrl: string,
  input: {
    slug: string;
    returnUrl?: string;
    code?: string;
    termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }, language: 'en' | 'pl') => string;
  },
  deps: CheckoutDeps,
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
  const mode = 'live' as const;
  const configured = await getPaymentConfig(tenant.id, deps, mode);
  if (!configured.ok) return configured;
  if (!configured.value.stripeConfigured) return err(validation('Stripe is not configured for this tenant'));
  const built = await buildCheckoutLines(tenant.id, selection.value, deps);
  if (!built.ok) return built;
  const partner = input.code === undefined ? ok(null) : await validatePartnerCodeForCheckout(tenant.id, { code: input.code, salesLinkId: link.id, amountCents: built.value.totalCents, currency: built.value.currency }, deps);
  if (!partner.ok) return partner;
  if (input.code !== undefined && (!link.allowsCodes || partner.value === null)) return err(validation(COUPON_UNAVAILABLE_MESSAGE));
  const promotion = partner.value === null ? ok({}) : await materialisePartnerCode(tenant.id, partner.value.code, built.value.currency, deps);
  if (!promotion.ok) return promotion;
  const language = settings.defaultLanguage ?? 'en';
  const legal = { termsUrl: settings.termsUrl, privacyUrl: settings.privacyUrl };
  const termsAcceptanceMessage = input.termsAcceptanceMessage(legal, language);
  if (termsAcceptanceMessage.length > 1200) return err(validation('Checkout terms acceptance text exceeds 1200 characters'));
  const checkoutSnapshotId = deps.ids.nextId();
  const checkoutBranding = resolveCheckoutBranding(settings, tenantBaseUrl);
  const checkoutPath = `${tenantBaseUrl}/offer/${encodeURIComponent(input.slug)}`;
  const checkoutQuery = `&salesLinkId=${encodeURIComponent(link.id)}`;
  const snapshot = {
    id: checkoutSnapshotId, tenantId: tenant.id, salesLinkId: link.id,
    ...(partner.value === null ? {} : { partnerCodeId: partner.value.code.id, discountCents: partner.value.breakdown.discountCents, partnerTerms: partner.value.terms }),
    lines: built.value.lines, currency: built.value.currency,
    mode, createdAt: deps.clock.nowIso(),
  };
  if (partner.value !== null) {
    if (deps.partners === undefined) return err(validation('Partner checkout is not configured'));
    const reserved = await deps.partners.reserveCheckout(tenant.id, snapshot);
    if (!reserved.ok) return reserved;
  }
  const created = await deps.payment.createCheckoutSession({
    tenantId: tenant.id,
    ...promotion.value,
    mode,
    productId,
    productName: selection.value.product.title,
    salesLinkId: link.id,
    checkoutSnapshotId,
    lines: built.value.lines,
    priceCents: built.value.totalCents,
    currency: built.value.currency,
    language,
    successUrl: `${checkoutPath}?status=success&purchase_kind=one_time${checkoutQuery}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: resolveCancelReturnUrl(link.cancelReturnUrl, input.returnUrl) ?? `${checkoutPath}?status=cancelled${checkoutQuery}`,
    directCheckout: { ...legal, termsAcceptanceMessage },
    ...(checkoutBranding === undefined ? {} : { checkoutBranding }),
  });
  if (!created.ok) {
    if (partner.value !== null) await deps.partners?.releaseCheckout(tenant.id, checkoutSnapshotId, deps.clock.nowIso());
    return created;
  }
  try {
    if (partner.value !== null) await deps.partners?.attachCheckoutSession(tenant.id, checkoutSnapshotId, created.value.sessionId);
    else await deps.checkoutSnapshots.create(tenant.id, { ...snapshot, providerSessionId: created.value.sessionId });
  } catch (cause) {
    const expired = await deps.payment.expireCheckoutSession({ tenantId: tenant.id, sessionId: created.value.sessionId, mode });
    if (expired.ok && partner.value !== null) await deps.partners?.releaseCheckout(tenant.id, checkoutSnapshotId, deps.clock.nowIso());
    throw cause;
  }
  return ok({ url: created.value.url });
};
