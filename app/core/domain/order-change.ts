import { z } from 'zod';

import { orderListItemSchema } from './commerce.js';
import { stripeModeSchema } from './integration.js';

const XID8_MAX = 2n ** 64n - 1n;
const BIGINT_MAX = 2n ** 63n - 1n;
const cursorPattern = /^(0|[1-9][0-9]{0,19})\.(0|[1-9][0-9]{0,18})$/;

interface OrderChangePosition {
  xactId: string;
  id: string;
}

export const decodeOrderChangeCursor = (cursor: string): OrderChangePosition | null => {
  const match = cursorPattern.exec(cursor);
  const xactId = match?.[1];
  const id = match?.[2];
  if (xactId === undefined || id === undefined) return null;
  if (BigInt(xactId) > XID8_MAX || BigInt(id) > BIGINT_MAX) return null;
  return { xactId, id };
};

export const encodeOrderChangeCursor = (position: OrderChangePosition): string => `${position.xactId}.${position.id}`;

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

const ORDER_CHANGE_FEED_DEFAULT_LIMIT = 100;

export const orderChangeFeedQuerySchema = listOrderChangesQuerySchema.extend({
  limit: listOrderChangesQuerySchema.shape.limit.default(ORDER_CHANGE_FEED_DEFAULT_LIMIT),
});

export const orderChangeFeedSchema = z.object({
  changes: z.array(z.object({ cursor: z.string(), order: orderListItemSchema })),
  nextCursor: z.string().nullable(),
});

export type OrderChangeFeed = z.infer<typeof orderChangeFeedSchema>;
