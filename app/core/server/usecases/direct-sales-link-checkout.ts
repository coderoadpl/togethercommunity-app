import { err, notFound, ok, resolveCheckoutBranding, stripeKeyModeConflicts, validation, type AppError, type Result, type Tenant } from '#core/domain/index.js';
import { buildCheckoutLines } from './checkout-lines.js';
import { getPaymentConfig, startCheckoutSession, validateCheckoutSelection, type CheckoutDeps } from './checkout.js';

export const getDirectSalesLinkMode = async (
  tenantId: string,
  requestedMode: 'live' | 'test',
  deps: Pick<CheckoutDeps, 'tenantSecrets' | 'secretCrypto'>,
): Promise<Result<'live' | 'test', AppError>> => {
  if (requestedMode !== 'test') return ok('live');
  const key = await deps.tenantSecrets.findByKey(tenantId, 'stripe.testRestrictedKey');
  if (key === null) return ok('live');
  const decrypted = deps.secretCrypto?.decrypt(key);
  if (decrypted === undefined) return err(validation('Stripe test key decryption is not configured'));
  if (!decrypted.ok) return decrypted;
  if (stripeKeyModeConflicts(decrypted.value, 'test')) return err(validation('The configured test key is not a Stripe test key'));
  return ok('test');
};

export const createDirectSalesLinkCheckout = async (
  tenant: Tenant,
  tenantBaseUrl: string,
  input: {
    slug: string;
    mode: 'live' | 'test';
    termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }, language: 'en' | 'pl') => string;
  },
  deps: CheckoutDeps,
  staffTestSession?: { memberId: string; email: string },
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
  const selectedMode = await getDirectSalesLinkMode(tenant.id, input.mode, deps);
  if (!selectedMode.ok) return selectedMode;
  const mode = selectedMode.value;
  const configured = await getPaymentConfig(tenant.id, deps, mode);
  if (!configured.ok) return configured;
  if (!configured.value.stripeConfigured) return err(validation('Stripe is not configured for this tenant'));
  const built = await buildCheckoutLines(tenant.id, selection.value, deps);
  if (!built.ok) return built;
  if (mode === 'test' && built.value.totalCents === 0) return err(validation('Test checkout requires a paid price without a coupon'));
  const language = settings.defaultLanguage ?? 'en';
  const legal = { termsUrl: settings.termsUrl, privacyUrl: settings.privacyUrl };
  const termsAcceptanceMessage = input.termsAcceptanceMessage(legal, language);
  if (termsAcceptanceMessage.length > 1200) return err(validation('Checkout terms acceptance text exceeds 1200 characters'));
  if (mode === 'test' && staffTestSession !== undefined) {
    return startCheckoutSession(tenant, tenantBaseUrl, { productId, email: staffTestSession.email, language }, selection.value, deps, undefined,
      { mode: 'test', memberId: staffTestSession.memberId }, { ...legal, termsAcceptanceMessage });
  }
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
    successUrl: `${checkoutPath}?status=success${mode === 'test' ? '&test_purchase=1' : ''}&purchase_kind=one_time${checkoutQuery}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${checkoutPath}?status=cancelled${mode === 'test' ? '&test=1' : ''}${checkoutQuery}`,
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
