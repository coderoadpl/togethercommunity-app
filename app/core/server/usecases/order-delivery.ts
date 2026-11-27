import { correctedOrderShipping, deliveryCorrectionAllowed, deliveryCorrectionInputSchema, deliveryCorrectionRefused, err, inpostPointRejection, notFound, pickupPointDetails, validation, type AppError, type OrderListItem, type OrderShipping, type Result } from '#core/domain/index.js';
import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { OrderDeliveryRepository } from '../order-fulfilment-ports.js';
import type { PickupPointDirectory } from '../pickup-point-ports.js';
import type { Clock, OrderDetailRepository } from '../ports.js';

export const correctOrderDelivery = async (
  ctx: Ctx,
  input: unknown,
  deps: { deliveries: OrderDeliveryRepository; orderDetails: OrderDetailRepository; pickupPoints?: PickupPointDirectory | undefined; clock: Clock },
): Promise<Result<{ order: OrderListItem }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:write');
  if (!tenant.ok) return tenant;
  const parsed = deliveryCorrectionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid delivery correction', parsed.error.flatten()));
  const order = await deps.orderDetails.findById(tenant.value, parsed.data.orderId);
  if (order === null) return err(notFound('Order was not found'));
  const allowed = deliveryCorrectionAllowed(order, []);
  if (!allowed.ok) return allowed;
  if (order.shipping == null) return err(validation('Order has no delivery details'));
  let pickupPoint: OrderShipping['pickupPoint'] = null;
  if (parsed.data.pickupPoint !== undefined) {
    if (order.shipping.pickupPoint === null) return err(deliveryCorrectionRefused('locker_not_allowed'));
    const lookup = await deps.pickupPoints?.lookup(parsed.data.pickupPoint.code);
    if (lookup === undefined || lookup.kind === 'unavailable') return err(deliveryCorrectionRefused('locker_unavailable'));
    if (lookup.kind !== 'found' || inpostPointRejection(lookup.point) !== null) return err(deliveryCorrectionRefused('locker_invalid'));
    pickupPoint = { provider: 'inpost', ...pickupPointDetails(lookup.point) };
  }
  const command = { input: parsed.data, pickupPoint, at: deps.clock.nowIso(), byUserId: ctx.identity.userId, byEmail: ctx.identity.email };
  const corrected = correctedOrderShipping(order.shipping, command);
  if (!corrected.ok) return corrected;
  return deps.deliveries.correctDelivery(tenant.value, command);
};
