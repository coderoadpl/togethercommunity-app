import {
  err,
  feedCursorReset,
  ok,
  orderChangeFeedQuerySchema,
  validation,
  type AppError,
  type OrderChange,
  type OrderChangeFeed,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { OrderChangeRepository, OrderListItemReader } from '../order-change-ports.js';

export interface OrderChangeFeedDeps {
  changes: OrderChangeRepository;
  orders: OrderListItemReader;
}

const latestChangePerOrder = (changes: readonly OrderChange[]): OrderChange[] => {
  const latest = new Map<string, OrderChange>();
  for (const change of changes) {
    latest.delete(change.orderId);
    latest.set(change.orderId, change);
  }
  return [...latest.values()];
};

export const listOrderChangeFeed = async (
  ctx: Ctx,
  query: unknown,
  deps: OrderChangeFeedDeps,
): Promise<Result<OrderChangeFeed, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:read');
  if (!tenant.ok) return tenant;

  const parsed = orderChangeFeedQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid order changes query', parsed.error.flatten()));

  const read = await deps.changes.listOrderChanges(tenant.value, parsed.data);
  if (read.kind === 'reset') return err(feedCursorReset(read.cursor));
  const page = read.changes;
  const latest = latestChangePerOrder(page);
  const orders = new Map((await deps.orders.listByIds(tenant.value, latest.map((change) => change.orderId)))
    .map((order) => [order.id, order]));
  return ok({
    changes: latest.flatMap((change) => {
      const order = orders.get(change.orderId);
      return order === undefined ? [] : [{ cursor: change.cursor, order }];
    }),
    nextCursor: page.at(-1)?.cursor ?? parsed.data.after ?? null,
  });
};
