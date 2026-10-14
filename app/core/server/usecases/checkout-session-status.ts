import { checkoutSessionStatusInputSchema, err, ok, validation, type AppError, type Result } from '#core/domain/index.js';

import type { PaymentRefundRepository } from '../ports.js';

export const getCheckoutSessionStatus = async (
  tenantId: string,
  sessionId: string,
  deps: { paymentRefunds: Pick<PaymentRefundRepository, 'findOrderByProviderObjectIds'> },
): Promise<Result<{ status: 'pending' | 'paid' }, AppError>> => {
  const parsed = checkoutSessionStatusInputSchema.safeParse({ session_id: sessionId });
  if (!parsed.success) return err(validation('Invalid checkout session id'));
  const mode = parsed.data.session_id.startsWith('cs_test_') ? 'test' : 'live';
  const order = await deps.paymentRefunds.findOrderByProviderObjectIds(
    tenantId, { checkoutSession: parsed.data.session_id }, mode,
  );
  const paid = order !== null && order.tenantId === tenantId && order.mode === mode &&
    order.providerObjectIds.checkoutSession === parsed.data.session_id &&
    ['paid', 'partially_refunded', 'refunded'].includes(order.status);
  return ok({ status: paid ? 'paid' : 'pending' });
};
