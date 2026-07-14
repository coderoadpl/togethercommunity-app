import {
  err,
  ok,
  validation,
  type AppError,
  type ProcessedPaymentEvent,
  type Result,
  type Tenant,
} from '@core/domain/index.js';

import type { PaymentWebhookEvent, ProcessedPaymentEventRepository } from '../ports.js';
import { fulfillEnrollment, type FulfillEnrollmentDeps } from './fulfill-enrollment.js';

export interface StripeWebhookDeps extends FulfillEnrollmentDeps {
  processedPaymentEvents: ProcessedPaymentEventRepository;
}

export const fulfillStripeWebhook = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
): Promise<Result<{ processed: boolean }, AppError>> => {
  if (event.type !== 'checkout.session.completed') return ok({ processed: false });
  if (!event.objectId || !event.checkoutSession) return err(validation('Stripe checkout event is missing session data'));

  const priorEvent = await deps.processedPaymentEvents.findByEventId(tenant.id, event.id);
  if (priorEvent) return ok({ processed: false });
  const priorObject = await deps.processedPaymentEvents.findByObjectAndType(tenant.id, event.objectId, event.type);
  if (priorObject) return ok({ processed: false });

  const metadata = event.checkoutSession.metadata;
  if (metadata.tenantId !== tenant.id) return err(validation('Stripe checkout metadata does not match the webhook tenant'));
  if (!metadata.productId) return err(validation('Stripe checkout metadata is missing productId'));
  const email = event.checkoutSession.email ?? metadata.memberEmail;
  if (!email) return err(validation('Stripe checkout session is missing the member email'));

  const fulfilled = await fulfillEnrollment(
    tenant,
    {
      email,
      productId: metadata.productId,
      expiresAt: null,
      language: metadata.language ?? 'pl',
      source: 'stripe',
      sendEmail: true,
    },
    deps,
  );
  if (!fulfilled.ok) return fulfilled;

  const processedEvent: ProcessedPaymentEvent = {
    id: event.id,
    tenantId: tenant.id,
    type: event.type,
    objectId: event.objectId,
    processedAt: deps.clock.nowIso(),
  };
  const created = await deps.processedPaymentEvents.create(tenant.id, processedEvent);
  return ok({ processed: created });
};
