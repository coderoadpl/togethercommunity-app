import { err, validation, ok, type AppError, type Result, type Order, type Tenant } from '#core/domain/index.js';

import type { CheckoutConsentCaptureRepository, ConsentDefinitionRepository, PaymentTransactionPort, PaymentWebhookEvent, TokenGenerator } from '../ports.js';
import { recordCheckoutMarketingConsents } from './marketing-email.js';
import { enforceTermsConsent, type TermsConsentDeps } from './terms-consent.js';

export interface FulfilledCheckoutConsentDeps extends Pick<TermsConsentDeps, 'tenants' | 'ids' | 'clock'> {
  consentTokens: TokenGenerator;
  checkoutConsentCaptures?: CheckoutConsentCaptureRepository;
  marketing?: { definitions: ConsentDefinitionRepository };
}

export const recordFulfilledCheckoutConsents = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  order: Pick<Order, 'id' | 'productId'>,
  deps: FulfilledCheckoutConsentDeps,
  transaction: Parameters<Parameters<PaymentTransactionPort['run']>[0]>[0],
): Promise<Result<void, AppError>> => {
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return ok(undefined);
  }
  const checkout = event.checkoutSession;
  const captureId = checkout?.metadata.checkoutConsentCaptureId;
  if (checkout === null || captureId === undefined || captureId === null) return ok(undefined);
  const capture = await deps.checkoutConsentCaptures?.findById(tenant.id, captureId);
  if (capture === null || capture === undefined) return err(validation('Checkout consent capture is missing'));
  const email = checkout.email ?? checkout.metadata.memberEmail;
  const terms = await enforceTermsConsent(tenant.id, {
    accepted: capture.termsAccepted,
    userId: null,
    email,
    source: 'checkout',
  }, { ...deps, consents: transaction.consents });
  if (!terms.ok) return terms;
  if (email === null || capture.selectedDefinitionIds.length === 0) return ok(undefined);
  if (deps.marketing === undefined) return err(validation('Checkout marketing consent is not configured'));
  const recorded = await recordCheckoutMarketingConsents({
    identity: {
      userId: 'checkout',
      email: 'checkout@invalid.test',
      name: 'Checkout',
      emailVerified: true,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      staffRole: null,
      memberId: null,
      image: null,
      memberDisplayName: null,
      memberBannedAt: null,
      memberDmOptOutAt: null,
      memberLanguage: null,
      memberVideoAutoplay: false,
    },
  }, {
    email,
    selectedDefinitionIds: capture.selectedDefinitionIds,
    attachedDefinitionIds: capture.attachedDefinitionIds,
    evidence: {
      collectedAt: capture.collectedAt,
      proofRef: `product:${order.productId};order:${order.id}`,
      ...(capture.ip === undefined ? {} : { ip: capture.ip }),
      ...(capture.userAgent === undefined ? {} : { userAgent: capture.userAgent }),
    },
    confirmationBaseUrl: capture.confirmationBaseUrl,
  }, {
    definitions: deps.marketing.definitions,
    consents: transaction.marketingConsents,
    confirmations: transaction.confirmations,
    members: transaction.members,
    tenants: deps.tenants,
    outbox: transaction.emailOutbox,
    ids: deps.ids,
    tokens: deps.consentTokens,
    clock: deps.clock,
  });
  return recorded.ok ? ok(undefined) : recorded;
};
