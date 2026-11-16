import { z } from 'zod';

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
}).strict();

export type ListOrderChangesQuery = z.infer<typeof listOrderChangesQuerySchema>;

export interface OrderChange {
  cursor: string;
  orderId: string;
  changedAt: string;
}
