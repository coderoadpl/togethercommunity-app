import {
  err,
  ok,
  paymentEventRejectedEmail,
  paymentEventRejectedOutboxId,
  paymentEventRejectionListQuerySchema,
  prerenderedTransactionalPayload,
  validation,
  type AppError,
  type ErrorCode,
  type PaymentEventRejection,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { serializeErrorChain } from '../log-safety.js';
import type {
  Clock,
  EmailOutboxRepository,
  PaymentEventRejectionRepository,
  PaymentRefundRepository,
  PaymentWebhookEvent,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '../ports.js';
import { resolveTenantOrigin, type TenantUrlDeps } from '../tenant-url.js';
import { tenantStaffRecipients } from './tenant-staff-recipients.js';

export type PaymentEventRejectionDeps = TenantUrlDeps & {
  paymentEventRejections: PaymentEventRejectionRepository;
  paymentRefunds: Pick<PaymentRefundRepository, 'findOrderByProviderObjectIds'>;
  tenantAccess?: Pick<TenantAccessReader, 'listStaffForTenant'> | undefined;
  tenants: Pick<TenantRepository, 'findSettings'>;
  tenantDomains: Pick<TenantDomainRepository, 'listByTenant'>;
  emailOutbox: Pick<EmailOutboxRepository, 'enqueue'>;
  clock: Clock;
  logger: { error: (message: string) => void };
  dispatchEmail: () => void;
};

const PAID_CHECKOUT_EVENT_TYPES = new Set<string>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

const isLivePaidCheckout = (event: PaymentWebhookEvent): boolean =>
  PAID_CHECKOUT_EVENT_TYPES.has(event.type) &&
  event.foreignTenant !== true &&
  (event.mode ?? 'live') === 'live' &&
  event.livemode !== false &&
  event.checkoutSession?.paymentStatus === 'paid';

const CONSTANT_CHECKOUT_REFUSALS = new Set<string>([
  'Payment event is missing its object id',
  'Stripe event metadata does not match the webhook tenant',
  'Stripe checkout event is missing session data',
  'Stripe checkout metadata does not match the webhook tenant',
  'Stripe checkout metadata is missing productId',
  'Checkout snapshot not found',
  'Sales link checkout snapshot does not match',
  'Checkout snapshot product does not match',
  'Direct checkout does not match its recorded session',
  'Direct checkout consent evidence is missing',
  'Stripe checkout terms consent evidence is missing',
  'Checkout total does not match its lines',
  'Checkout snapshot is missing its shipping selection',
  'Checkout shipping cost does not match its shipping line',
  'Stripe checkout session is missing the member email',
  'Stripe checkout metadata references an unknown price',
  'Coupon redemption limit reached',
]);

const FIXED_REASONS: Partial<Record<ErrorCode, string>> = {
  internal: 'Payment processing failed unexpectedly',
  not_found: 'A record the payment refers to was not found',
  validation: 'The payment did not pass validation',
};

// Other messages can quote checkout metadata or a serialized infrastructure error, both of which can carry buyer data.
const storedReason = (error: AppError): string =>
  error.code !== 'internal' && CONSTANT_CHECKOUT_REFUSALS.has(error.message)
    ? error.message
    : FIXED_REASONS[error.code] ?? 'The payment could not be processed';

const PAYMENT_EVENT_REJECTION_EMAIL_SOURCE = 'payment-event-rejections';

const notifyStaff = async (
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>,
  rejection: PaymentEventRejection,
  deps: PaymentEventRejectionDeps,
): Promise<boolean> => {
  const recipients = deps.tenantAccess === undefined
    ? []
    : await tenantStaffRecipients(tenant.id, { tenants: deps.tenants, tenantAccess: deps.tenantAccess });
  if (recipients.length === 0) return false;
  const studioUrl = `${await resolveTenantOrigin(tenant, deps)}/panel/sales`;
  let queuedAny = false;
  for (const recipient of recipients) {
    const queued = await deps.emailOutbox.enqueue({
      id: paymentEventRejectedOutboxId(tenant.id, rejection.eventId, recipient.email),
      tenantId: tenant.id,
      to: recipient.email,
      payload: prerenderedTransactionalPayload(paymentEventRejectedEmail(recipient.language, {
        tenantName: tenant.name,
        eventId: rejection.eventId,
        checkoutSessionId: rejection.checkoutSessionId,
        reasonCode: rejection.reasonCode,
        reasonMessage: rejection.reasonMessage,
        firstSeenAt: rejection.firstSeenAt,
        studioUrl,
      })),
      sourceApp: PAYMENT_EVENT_REJECTION_EMAIL_SOURCE,
      tenantTransportRequired: false,
      now: deps.clock.nowIso(),
      onConflict: 'keep-existing',
    });
    if (queued.ok) queuedAny = true;
    else deps.logger.error(`[payment-webhook-rejected] staff e-mail not queued tenant=${tenant.id} event=${rejection.eventId} error=${queued.error.code}`);
  }
  return queuedAny;
};

const hasLiveOrder = async (tenantId: string, checkoutSessionId: string | null, deps: PaymentEventRejectionDeps): Promise<boolean> =>
  checkoutSessionId !== null &&
  await deps.paymentRefunds.findOrderByProviderObjectIds(tenantId, { checkoutSession: checkoutSessionId }, 'live') !== null;

/** Its own failures are only logged: the answer to Stripe must stay the refusal, so Stripe keeps retrying, or the acceptance. */
export const recordStripeWebhookOutcome = async (
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>,
  event: PaymentWebhookEvent,
  outcome: Result<{ processed: boolean }, AppError>,
  deps: PaymentEventRejectionDeps,
): Promise<void> => {
  if (!isLivePaidCheckout(event)) return;
  const guarded = async <T>(action: 'resolve' | 'record' | 'notify', run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch (cause) {
      deps.logger.error(`[payment-webhook-rejected] ${action} failed tenant=${tenant.id} event=${event.id} error=${serializeErrorChain(cause)}`);
      return undefined;
    }
  };
  if (outcome.ok) {
    await guarded('resolve', async () => {
      if (outcome.value.processed || await hasLiveOrder(tenant.id, event.objectId, deps)) {
        await deps.paymentEventRejections.resolve(tenant.id, event.id, deps.clock.nowIso());
      }
    });
    return;
  }
  const error = outcome.error;
  if (error.code === 'conflict') return;
  const checkoutSessionId = event.objectId;
  const recorded = await guarded('record', async () => {
    if (await hasLiveOrder(tenant.id, checkoutSessionId, deps)) return undefined;
    deps.logger.error(`[payment-webhook-rejected] tenant=${tenant.id} event=${event.id} type=${event.type} reason=${error.code}`);
    const rejection = await deps.paymentEventRejections.record(tenant.id, {
      eventId: event.id,
      eventType: event.type,
      checkoutSessionId,
      reasonCode: error.code,
      reasonMessage: storedReason(error),
      seenAt: deps.clock.nowIso(),
    });
    if (await hasLiveOrder(tenant.id, checkoutSessionId, deps)) {
      await deps.paymentEventRejections.resolve(tenant.id, event.id, deps.clock.nowIso());
      return undefined;
    }
    return rejection;
  });
  if (recorded === undefined) return;
  // Every refusal re-queues: the outbox ids are fixed per event and recipient address, so a retry fills a gap left by a failed or interrupted queue, or a staff member added since, without a second e-mail to anyone, whatever order the staff list comes back in.
  await guarded('notify', async () => {
    if (await notifyStaff(tenant, recorded, deps)) deps.dispatchEmail();
  });
};

export const listPaymentEventRejections = async (
  ctx: Ctx,
  input: unknown,
  deps: { paymentEventRejections: Pick<PaymentEventRejectionRepository, 'listUnresolved'> },
): Promise<Result<{ rejections: PaymentEventRejection[] }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:reconcile');
  if (!tenant.ok) return tenant;
  const parsed = paymentEventRejectionListQuerySchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid payment event rejection query', parsed.error.flatten()));
  }
  return ok({ rejections: await deps.paymentEventRejections.listUnresolved(tenant.value, parsed.data.limit) });
};
