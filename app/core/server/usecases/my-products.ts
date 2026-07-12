import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type Product,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ProductGrantRepository } from '../ports.js';

export interface MyProductsDeps {
  grants: ProductGrantRepository;
}

export const listMyProducts = async (
  ctx: Ctx,
  deps: MyProductsDeps,
): Promise<Result<Product[], AppError>> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to see your products'));
  if (!ctx.identity.memberId) return err(forbidden('Only members can list their products'));
  return ok(await deps.grants.listGrantedProducts(ctx.identity.tenantId, ctx.identity.memberId));
};
