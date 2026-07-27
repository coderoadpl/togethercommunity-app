import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type BillingData,
  type Invoice,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { OrderRepository } from '../ports.js';

export const listMemberBillingOrders = async (
  ctx: Ctx,
  input: { page: number; pageSize: number },
  deps: { orders: OrderRepository },
): Promise<Result<{
  orders: Array<{
    id: string;
    createdAt: string;
    billing: BillingData;
    invoice: Pick<Invoice, 'id' | 'status' | 'provider'> | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}, AppError>> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound());
  if (ctx.identity.memberId === null) return err(forbidden('Only tenant members can read billing history'));
  if (deps.orders.listBillingForMember === undefined) {
    return ok({ orders: [], total: 0, page: input.page, pageSize: input.pageSize });
  }
  const result = await deps.orders.listBillingForMember(
    ctx.identity.tenantId,
    ctx.identity.memberId,
    input.page,
    input.pageSize,
  );
  return ok({ ...result, page: input.page, pageSize: input.pageSize });
};
