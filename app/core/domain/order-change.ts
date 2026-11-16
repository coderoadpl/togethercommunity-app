import { z } from 'zod';

import { orderListItemSchema } from './commerce.js';
import { appError, type AppError } from './errors.js';
import { stripeModeSchema } from './integration.js';

const XID8_MAX = 2n ** 64n - 1n;
const BIGINT_MAX = 2n ** 63n - 1n;
const cursorPattern = /^([0-9a-f]{32})\.(0|[1-9][0-9]{0,19})\.(0|[1-9][0-9]{0,18})$/;

interface OrderChangePosition {
  epoch: string;
  xactId: string;
  id: string;
}

export const decodeOrderChangeCursor = (cursor: string): OrderChangePosition | null => {
  const match = cursorPattern.exec(cursor);
  const epoch = match?.[1];
  const xactId = match?.[2];
  const id = match?.[3];
  if (epoch === undefined || xactId === undefined || id === undefined) return null;
  if (BigInt(xactId) > XID8_MAX || BigInt(id) > BIGINT_MAX) return null;
  return { epoch, xactId, id };
};

export const encodeOrderChangeCursor = (position: OrderChangePosition): string =>
  `${position.epoch}.${position.xactId}.${position.id}`;

const orderChangeCursorSchema = z.string().refine(
  (cursor) => decodeOrderChangeCursor(cursor) !== null,
  'Invalid order change cursor',
);

export const listOrderChangesQuerySchema = z.object({
  after: orderChangeCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200),
  mode: stripeModeSchema.optional(),
}).strict();

export type ListOrderChangesQuery = z.infer<typeof listOrderChangesQuerySchema>;

export interface OrderChange {
  cursor: string;
  orderId: string;
  changedAt: string;
}

export type OrderChangeRead =
  | { kind: 'changes'; changes: OrderChange[] }
  | { kind: 'reset'; cursor: string };

export const ORDER_CHANGE_FEED_RESET_MESSAGE = 'Order change feed reset: resync from the order list, then start from the cursor in this answer';

export const orderChangeFeedResetDetailsSchema = z.object({ cursor: orderChangeCursorSchema }).strict();

export const feedCursorReset = (cursor: string): AppError =>
  appError('feed_cursor_reset', ORDER_CHANGE_FEED_RESET_MESSAGE, { cursor });

export const feedCursorResetCursor = (error: AppError): string | null => {
  if (error.code !== 'feed_cursor_reset') return null;
  const details = orderChangeFeedResetDetailsSchema.safeParse(error.details);
  return details.success ? details.data.cursor : null;
};

const ORDER_CHANGE_FEED_DEFAULT_LIMIT = 100;

export const orderChangeFeedQuerySchema = listOrderChangesQuerySchema.extend({
  limit: listOrderChangesQuerySchema.shape.limit.default(ORDER_CHANGE_FEED_DEFAULT_LIMIT),
});

export const orderChangeFeedSchema = z.object({
  changes: z.array(z.object({ cursor: z.string(), order: orderListItemSchema })),
  nextCursor: z.string().nullable(),
});

export type OrderChangeFeed = z.infer<typeof orderChangeFeedSchema>;
