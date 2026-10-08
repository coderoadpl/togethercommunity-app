import { err, notFound, ok, orderSchema, type AppError, type Result, type Tenant } from '#core/domain/index.js';

import type { OrderVerificationRepository } from '../order-verification-ports.js';
import { orderVerificationUrl } from '../order-verification-url.js';
import { resolveTenantOrigin, type TenantOriginDeps } from '../tenant-url.js';

const tokenSchema = orderSchema.shape.verificationToken;

export const getPublicOrderQr = async (
  tenant: Pick<Tenant, 'id' | 'slug'>,
  token: string,
  deps: TenantOriginDeps & {
    orderVerification: Pick<OrderVerificationRepository, 'findByToken'>;
    renderQrPng(url: string): Promise<Uint8Array>;
  },
): Promise<Result<Uint8Array, AppError>> => {
  if (token.length > 128 || !tokenSchema.safeParse(token).success) return err(notFound('Order not found'));
  const order = await deps.orderVerification.findByToken(tenant.id, token);
  if (order === null) return err(notFound('Order not found'));
  const origin = await resolveTenantOrigin(tenant, deps);
  return ok(await deps.renderQrPng(orderVerificationUrl(origin, token)));
};
