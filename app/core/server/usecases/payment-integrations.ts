import { ok, type AppError, type Result } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../ports.js';
import { authorizeTenant } from '../authorize.js';

export const testStripeConnection = async (
  ctx: Ctx,
  input: { appBaseUrl: string },
  payment: PaymentProvider,
): Promise<Result<{ ok: true; diagnostic: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'integration:test');
  if (!tenant.ok) return tenant;
  const created = await payment.createCheckoutSession({
    tenantId: tenant.value,
    productId: 'connection-test',
    productName: 'Stripe connection test',
    priceCents: 100,
    currency: 'USD',
    successUrl: `${input.appBaseUrl}/integrations/stripe/test/success`,
    cancelUrl: `${input.appBaseUrl}/integrations/stripe/test/cancel`,
  });
  if (!created.ok) return created;
  const expired = await payment.expireCheckoutSession({
    tenantId: tenant.value,
    sessionId: created.value.sessionId,
  });
  if (!expired.ok) return expired;
  return ok({ ok: true, diagnostic: 'Stripe accepted the credentials and the test session was expired.' });
};
