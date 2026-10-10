import { err, notFound, ok, validation, orderVerificationReferenceSchema, issueOrderLineInputSchema, type AppError, type OrderListItem, type Result } from '#core/domain/index.js';
import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock } from '../ports.js';
import type { OrderVerificationRepository } from '../order-verification-ports.js';

export interface OrderVerificationDeps {
  orderVerification: OrderVerificationRepository;
  clock: Clock;
}

export const verifyOrder = async (ctx: Ctx, reference: string, deps: Pick<OrderVerificationDeps, 'orderVerification'>): Promise<Result<{ order: OrderListItem }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:read');
  if (!tenant.ok) return tenant;
  const parsed = orderVerificationReferenceSchema.safeParse(reference);
  if (!parsed.success) return err(notFound('Order was not found'));
  const order = await deps.orderVerification.findByReference(tenant.value, parsed.data);
  return order === null ? err(notFound('Order was not found')) : ok({ order });
};

export const issueOrderLine = async (ctx: Ctx, input: { orderId: string; productId: string }, deps: OrderVerificationDeps): Promise<Result<{ order: OrderListItem }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:write');
  if (!tenant.ok) return tenant;
  const parsed = issueOrderLineInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid order line'));
  const result = await deps.orderVerification.issueLine(tenant.value, { ...parsed.data, staffUserId: ctx.identity.userId, occurredAt: deps.clock.nowIso() });
  return result.ok ? ok({ order: result.value }) : result;
};
