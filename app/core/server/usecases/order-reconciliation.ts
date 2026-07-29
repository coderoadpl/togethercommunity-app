import {
  err,
  ok,
  orderReconciliationQuerySchema,
  validation,
  type AppError,
  type PaidWithoutGrantRow,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, OrderRepository } from '../ports.js';

export interface OrderReconciliationDeps {
  orders: OrderRepository;
  clock: Clock;
}

export const listPaidOrdersWithoutGrant = async (
  ctx: Ctx,
  input: unknown,
  deps: OrderReconciliationDeps,
): Promise<Result<{ rows: PaidWithoutGrantRow[]; checkedThrough: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:reconcile');
  if (!tenant.ok) return tenant;
  const parsed = orderReconciliationQuerySchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid order reconciliation query', parsed.error.flatten()));
  }
  const checkedThrough = new Date(
    Date.parse(deps.clock.nowIso()) - parsed.data.minAgeMinutes * 60_000,
  ).toISOString();
  const rows = await deps.orders.listPaidWithoutGrant(tenant.value, {
    paidBefore: checkedThrough,
    limit: parsed.data.limit,
  });
  return ok({ rows, checkedThrough });
};
