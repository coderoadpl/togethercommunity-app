import { z } from 'zod';

export const LIST_LAYOUT_MAX_BYTES = 16 * 1024;

export const listLayoutIdSchema = z.enum(['orders']);

export type ListLayoutId = z.infer<typeof listLayoutIdSchema>;

const listLayoutKeySchema = z.string().min(1).max(64);

export const listLayoutColumnSchema = z.object({
  field: listLayoutKeySchema.regex(/^[a-zA-Z0-9_.-]+$/),
  visible: z.boolean(),
  width: z.number().int().min(40).max(1600).optional(),
}).strict();

export const listLayoutSchema = z.object({
  version: z.literal(1),
  columns: z.array(listLayoutColumnSchema).max(40),
  sort: z.object({ field: listLayoutKeySchema, direction: z.enum(['asc', 'desc']) }).strict().nullable(),
  filters: z.record(listLayoutKeySchema, z.string().max(200))
    .refine((filters) => Object.keys(filters).length <= 30, 'At most 30 filters'),
}).strict();

export type ListLayout = z.infer<typeof listLayoutSchema>;
export type ListLayoutColumn = z.infer<typeof listLayoutColumnSchema>;
