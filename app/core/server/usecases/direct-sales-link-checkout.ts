import { err, notFound, ok, resolveCancelReturnUrl, resolveCheckoutBranding, validation, type Tenant } from '#core/domain/index.js';
import { buildCheckoutLines } from './checkout-lines.js';
import { getPaymentConfig, validateCheckoutSelection, type CheckoutDeps } from './checkout.js';

export const createDirectSalesLinkCheckout = async (
  tenant: Tenant,
  tenantBaseUrl: string,
  input: {
    slug: string;
    returnUrl?: string;
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
  const mode = 'live';
  const configured = await getPaymentConfig(tenant.id, deps, mode);
  if (!configured.ok) return configured;
  if (!configured.value.stripeConfigured) return err(validation('Stripe is not configured for this tenant'));
  const built = await buildCheckoutLines(tenant.id, selection.value, deps);
  if (!built.ok) return built;
  const language = settings.defaultLanguage ?? 'en';
  const legal = { termsUrl: settings.termsUrl, privacyUrl: settings.privacyUrl };
  const termsAcceptanceMessage = input.termsAcceptanceMessage(legal, language);
  if (termsAcceptanceMessage.length > 1200) return err(validation('Checkout terms acceptance text exceeds 1200 characters'));
  const checkoutSnapshotId = deps.ids.nextId();
  const checkoutBranding = resolveCheckoutBranding(settings, tenantBaseUrl);
  const checkoutPath = `${tenantBaseUrl}/offer/${encodeURIComponent(input.slug)}`;
  const checkoutQuery = `&salesLinkId=${encodeURIComponent(link.id)}`;
  const created = await deps.payment.createCheckoutSession({
    tenantId: tenant.id,
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
  if (!created.ok) return created;
  try {
    await deps.checkoutSnapshots.create(tenant.id, {
      id: checkoutSnapshotId, tenantId: tenant.id, salesLinkId: link.id,
      lines: built.value.lines, currency: built.value.currency,
      mode, providerSessionId: created.value.sessionId, createdAt: deps.clock.nowIso(),
    });
  } catch (cause) {
    await deps.payment.expireCheckoutSession({ tenantId: tenant.id, sessionId: created.value.sessionId, mode });
    throw cause;
  }
  return ok({ url: created.value.url });
};
