import {
  appError, err, forbidden, notFound, ok, validation,
  PURCHASE_SMOKE_DAILY_CHECKOUT_LIMIT, PURCHASE_SMOKE_LOCKER_CODE,
  SMOKE_PURCHASE_PRIVACY_URL, SMOKE_PURCHASE_PRODUCT, SMOKE_PURCHASE_SALES_LINK,
  SMOKE_PURCHASE_SHIPPING_RATES, SMOKE_PURCHASE_TERMS_URL,
  SMOKE_TENANT_COURSE_PRODUCT_ID, SMOKE_TENANT_ID, SMOKE_TENANT_MEMBER_EMAIL, SMOKE_TENANT_SLUG,
  purchaseSmokeCheckoutSchema, purchaseSmokeStartSchema, stripeModeFromKey,
  type AppError, type CheckoutSessionInput, type PurchaseSmokeCheckout, type PurchaseSmokeResult,
  type PurchaseSmokeScenario, type Result, type ShopManagementKey,
} from '#core/domain/index.js';

import type { Clock } from '../ports.js';
import type { PurchaseSmokeRepository, PurchaseSmokeTransaction, PurchaseSmokeWriteDeps } from '../purchase-smoke-ports.js';
import { getPaymentConfig, startCheckoutSession, validateCheckoutSelection, type CheckoutSelection } from './checkout.js';
import { validateTermsConsent } from './terms-consent.js';

export interface PurchaseSmokeDeps {
  purchaseSmoke: PurchaseSmokeRepository;
  purchaseSmokeTransaction: PurchaseSmokeTransaction;
  fixtureBaseUrl: string;
  clock: Clock;
}

const permitsFixture = (key: ShopManagementKey, now: string): boolean =>
  key.revokedAt === null && Date.parse(key.expiresAt) > Date.parse(now) && key.purpose === 'purchase-smoke' && key.tenantId === SMOKE_TENANT_ID && key.mode === 'direct' && key.scopes.length === 0;

const scenarioInput = (scenario: PurchaseSmokeScenario): CheckoutSessionInput => ({
  productId: scenario === 'digital-course' ? SMOKE_TENANT_COURSE_PRODUCT_ID : SMOKE_PURCHASE_PRODUCT.id,
  ...(scenario === 'bundle-locker' ? { salesLinkId: SMOKE_PURCHASE_SALES_LINK.id } : {
    priceId: scenario === 'digital-course' ? `price-${SMOKE_TENANT_COURSE_PRODUCT_ID}` : SMOKE_PURCHASE_PRODUCT.priceId,
  }),
  email: SMOKE_TENANT_MEMBER_EMAIL,
  language: 'en',
  termsAccepted: true,
  ...(scenario === 'digital-course' ? {} : {
    shipping: {
      rateId: scenario === 'parcel-courier' ? SMOKE_PURCHASE_SHIPPING_RATES[1].id : SMOKE_PURCHASE_SHIPPING_RATES[0].id,
      ...(scenario === 'parcel-courier' ? {} : { pickupPoint: { provider: 'inpost', code: PURCHASE_SMOKE_LOCKER_CODE } }),
    },
  }),
});

const fixtureSelectionMatches = (selection: CheckoutSelection, scenario: PurchaseSmokeScenario): boolean => {
  const expectedIds = scenario === 'bundle-locker' ? [...SMOKE_PURCHASE_SALES_LINK.productIds]
    : [scenario === 'digital-course' ? SMOKE_TENANT_COURSE_PRODUCT_ID : SMOKE_PURCHASE_PRODUCT.id];
  const products = selection.products ?? [selection.product];
  const prices = selection.productPrices ?? (selection.price === null ? [] : [selection.price]);
  return products.length === expectedIds.length && prices.length === expectedIds.length
    && products.every((product, index) => product.id === expectedIds[index]
      && product.tenantId === SMOKE_TENANT_ID && product.published && product.vatRate === 23
      && product.currency === 'PLN'
      && product.type === (product.id === SMOKE_PURCHASE_PRODUCT.id ? 'physical' : 'course')
      && (product.id !== SMOKE_PURCHASE_PRODUCT.id || product.deliveryMethod === 'shipping')
      && (product.checkoutConsentDefinitionIds?.length ?? 0) === 0)
    && prices.every((price, index) => price.productId === expectedIds[index]
      && price.id === `price-${price.productId}` && price.tenantId === SMOKE_TENANT_ID
      && price.kind === 'one_time' && price.active && price.currency === 'PLN'
      && price.amountCents === (price.productId === SMOKE_PURCHASE_PRODUCT.id ? SMOKE_PURCHASE_PRODUCT.priceCents : 9900));
};

const startLocked = async (
  key: ShopManagementKey,
  input: { runId: string; scenario: PurchaseSmokeScenario },
  baseUrl: string,
  deps: PurchaseSmokeWriteDeps,
): Promise<Result<PurchaseSmokeCheckout, AppError>> => {
  const current = await deps.shopManagementKeys.findByHash(SMOKE_TENANT_ID, key.keyHash);
  if (current === null || current.id !== key.id || !permitsFixture(current, deps.clock.nowIso()) || current.revokedAt !== null
    || Date.parse(current.expiresAt) <= Date.parse(deps.clock.nowIso())) return err(forbidden('Purchase smoke key is no longer active'));
  const tenant = await deps.tenants.findById(SMOKE_TENANT_ID);
  if (tenant === null || tenant.slug !== SMOKE_TENANT_SLUG) return err(validation('Purchase fixture workspace is unavailable'));
  const liveSlots = await Promise.all((['stripe.restrictedKey', 'stripe.webhookSecret', 'stripe.webhookEndpointId'] as const).map((name) => deps.tenantSecrets.findByKey(SMOKE_TENANT_ID, name)));
  if (liveSlots.some((value) => value !== null)) return err(forbidden('Purchase smoke requires an empty live payment slot'));
  for (const name of ['stripe.restrictedKey', 'stripe.webhookSecret', 'stripe.webhookEndpointId'] as const) {
    const effective = await deps.secretResolver.resolve(SMOKE_TENANT_ID, name);
    if (effective.ok || effective.error.code !== 'not_found') return err(forbidden('Purchase smoke requires an empty effective live payment slot'));
  }
  const testKey = await deps.secretResolver.resolve(SMOKE_TENANT_ID, 'stripe.testRestrictedKey');
  const testWebhook = await deps.secretResolver.resolve(SMOKE_TENANT_ID, 'stripe.testWebhookSecret');
  const testEndpoint = await deps.secretResolver.resolve(SMOKE_TENANT_ID, 'stripe.testWebhookEndpointId');
  if (!testKey.ok || stripeModeFromKey(testKey.value) !== 'test' || !testWebhook.ok || !testEndpoint.ok) {
    return err(validation('Purchase smoke test payment credentials are unavailable'));
  }
  const test = await getPaymentConfig(SMOKE_TENANT_ID, deps, 'test');
  if (!test.ok) return test;
  if (!test.value.stripeConfigured) return err(validation('Purchase smoke test payments are not configured'));
  const settings = await deps.tenants.findSettings(SMOKE_TENANT_ID);
  if (settings?.termsUrl !== SMOKE_PURCHASE_TERMS_URL || settings.privacyUrl !== SMOKE_PURCHASE_PRIVACY_URL
    || SMOKE_PURCHASE_SHIPPING_RATES.some((rate) => !settings.shippingRates?.some((candidate) =>
      candidate.id === rate.id && candidate.active && candidate.amountCents === rate.amountCents
      && candidate.vatRatePercent === rate.vatRatePercent && candidate.carrier === rate.carrier && candidate.pickupPoint === rate.pickupPoint))) {
    return err(validation('Purchase fixture settings do not match'));
  }
  const member = await deps.members.findByEmail(SMOKE_TENANT_ID, SMOKE_TENANT_MEMBER_EMAIL);
  if (member?.id !== 'member-acme-smoke' || member.tenantId !== SMOKE_TENANT_ID || member.email !== SMOKE_TENANT_MEMBER_EMAIL || member.bannedAt !== null) {
    return err(validation('Synthetic smoke member is unavailable'));
  }
  const checkoutInput = scenarioInput(input.scenario);
  const selection = await validateCheckoutSelection(SMOKE_TENANT_ID, checkoutInput, deps);
  if (!selection.ok) return selection;
  if (!fixtureSelectionMatches(selection.value, input.scenario)) return err(validation('Purchase fixture products or prices do not match'));
  const consent = await validateTermsConsent(SMOKE_TENANT_ID, true, deps.tenants, { requireLegalUrls: true });
  if (!consent.ok) return consent;
  const existing = await deps.purchaseSmoke.findRun(SMOKE_TENANT_ID, key.id, input);
  if (existing !== null) return ok(existing);
  const now = deps.clock.nowIso();
  const since = new Date(Math.floor(Date.parse(now) / 86_400_000) * 86_400_000).toISOString();
  if (await deps.purchaseSmoke.countSince(SMOKE_TENANT_ID, since) >= PURCHASE_SMOKE_DAILY_CHECKOUT_LIMIT) {
    return err(appError('rate_limited', 'Purchase smoke daily checkout limit reached'));
  }
  const reference = deps.ids.nextId();
  const captureId = deps.ids.nextId();
  await deps.checkoutConsentCaptures.create(SMOKE_TENANT_ID, {
    id: captureId, createdAt: now,
    capture: { termsAccepted: true, termsUrl: settings.termsUrl, privacyUrl: settings.privacyUrl,
      selectedDefinitionIds: [], attachedDefinitionIds: [], collectedAt: now,
      confirmationBaseUrl: `${baseUrl}/marketing/confirm` },
  });
  const checkout = await startCheckoutSession(tenant, baseUrl, { ...checkoutInput, clientReference: reference }, selection.value,
    deps, captureId, { mode: 'test', memberId: member.id });
  if (!checkout.ok) return checkout;
  const parsed = purchaseSmokeCheckoutSchema.safeParse({ ...input, reference, sessionId: checkout.value.sessionId, url: checkout.value.url });
  if (!parsed.success) return err(validation('Provider returned an invalid test checkout'));
  await deps.purchaseSmoke.create(SMOKE_TENANT_ID, key.id, parsed.data, now);
  return ok(parsed.data);
};

export const startPurchaseSmokeCheckout = async (
  key: ShopManagementKey,
  input: unknown,
  deps: PurchaseSmokeDeps,
): Promise<Result<PurchaseSmokeCheckout, AppError>> => {
  if (!permitsFixture(key, deps.clock.nowIso())) return err(forbidden('An exclusive fixture purchase key is required'));
  const parsed = purchaseSmokeStartSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid purchase smoke scenario', parsed.error.flatten()));
  return deps.purchaseSmokeTransaction.run(SMOKE_TENANT_ID, (transaction) => startLocked(key, parsed.data, deps.fixtureBaseUrl, transaction));
};

export const getPurchaseSmokeResult = async (
  key: ShopManagementKey,
  reference: string,
  deps: Pick<PurchaseSmokeDeps, 'purchaseSmoke' | 'clock'>,
): Promise<Result<PurchaseSmokeResult, AppError>> => {
  if (!permitsFixture(key, deps.clock.nowIso())) return err(forbidden('An exclusive fixture purchase key is required'));
  const result = await deps.purchaseSmoke.result(SMOKE_TENANT_ID, key.id, reference);
  return result === null ? err(notFound('Purchase smoke checkout not found')) : ok(result);
};
