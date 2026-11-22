import {
  PAYMENT_EVENT_REJECTION_MESSAGE_MAX_LENGTH,
  err,
  ok,
  paymentEventRejectionListQuerySchema,
  resolveEmailLanguage,
  validation,
  type AppError,
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
  event.checkoutSession?.paymentStatus !== 'unpaid';

// An internal message carries a serialized infrastructure error, which can quote stored buyer data.
const storedReason = (error: AppError): string =>
  error.code === 'internal'
    ? 'Payment processing failed unexpectedly'
    : error.message.slice(0, PAYMENT_EVENT_REJECTION_MESSAGE_MAX_LENGTH);

const notifyOwners = async (
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>,
  rejection: PaymentEventRejection,
  deps: PaymentEventRejectionDeps,
): Promise<boolean> => {
  const owners = deps.tenantAccess === undefined
    ? []
    : (await deps.tenantAccess.listStaffForTenant(tenant.id)).filter((staff) => staff.staffRole === 'owner');
  if (owners.length === 0) return false;
  const settings = await deps.tenants.findSettings(tenant.id);
  const studioUrl = `${await resolveTenantOrigin(tenant, deps)}/panel/sales`;
  let queuedAny = false;
  for (const owner of owners) {
    const queued = await deps.emailOutbox.enqueue({
      id: `payment-event-rejected:${tenant.id}:${rejection.eventId}:${owner.userId}`,
      tenantId: tenant.id,
      to: owner.email,
      payload: {
        kind: 'payment-event-rejected',
        language: resolveEmailLanguage(owner.language, settings?.defaultLanguage),
        tenantName: tenant.name,
        eventId: rejection.eventId,
        eventType: rejection.eventType,
        checkoutSessionId: rejection.checkoutSessionId,
        reasonCode: rejection.reasonCode,
        reasonMessage: rejection.reasonMessage,
        firstSeenAt: rejection.firstSeenAt,
        studioUrl,
      },
      now: deps.clock.nowIso(),
      onConflict: 'keep-existing',
    });
    if (queued.ok) queuedAny = true;
    else deps.logger.error(`[payment-webhook-rejected] owner e-mail not queued tenant=${tenant.id} event=${rejection.eventId} error=${queued.error.code}`);
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
  const guarded = async (action: 'resolve' | 'record', run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (cause) {
      deps.logger.error(`[payment-webhook-rejected] ${action} failed tenant=${tenant.id} event=${event.id} error=${serializeErrorChain(cause)}`);
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
  await guarded('record', async () => {
    const checkoutSessionId = event.objectId;
    if (await hasLiveOrder(tenant.id, checkoutSessionId, deps)) return;
    deps.logger.error(`[payment-webhook-rejected] tenant=${tenant.id} event=${event.id} type=${event.type} reason=${error.code}`);
    const recorded = await deps.paymentEventRejections.record(tenant.id, {
      eventId: event.id,
      eventType: event.type,
      checkoutSessionId,
      reasonCode: error.code,
      reasonMessage: storedReason(error),
      seenAt: deps.clock.nowIso(),
    });
    if (await notifyOwners(tenant, recorded, deps)) deps.dispatchEmail();
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
