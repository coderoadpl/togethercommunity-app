import { err, forbidden, ok, tenantNotFound, type AppError, type Result } from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../ports.js';

export const testStripeConnection = async (
  ctx: Ctx,
  input: { appBaseUrl: string },
  payment: PaymentProvider,
): Promise<Result<{ ok: true; diagnostic: string }, AppError>> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to test Stripe'));
  if (ctx.identity.staffRole !== 'owner') return err(forbidden('Only the tenant owner can test Stripe'));
  const created = await payment.createCheckoutSession({
    tenantId: ctx.identity.tenantId,
    productRef: 'connection-test',
    successUrl: `${input.appBaseUrl}/integrations/stripe/test/success`,
    cancelUrl: `${input.appBaseUrl}/integrations/stripe/test/cancel`,
  });
  if (!created.ok) return created;
  const expired = await payment.expireCheckoutSession({
    tenantId: ctx.identity.tenantId,
    sessionId: created.value.sessionId,
  });
  if (!expired.ok) return expired;
  return ok({ ok: true, diagnostic: 'Stripe accepted the credentials and the test session was expired.' });
};
