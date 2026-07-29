import { z } from 'zod';

const currencyV1Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV1Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV1Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV1Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV1Schema = z.discriminatedUnion('level', [
  courseAccessItemV1Schema,
  modulesAccessItemV1Schema,
  lessonsAccessItemV1Schema,
]);

/**
 * FROZEN snapshot schema for `product` at schemaVersion 1. Standalone literal
 * copy — never import the live product schema; add a v2 file on change.
 */
export const productSnapshotV1Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string(),
  priceCents: z.number().int().nonnegative(),
  currency: currencyV1Schema,
  published: z.boolean(),
  accessItems: z.array(accessItemV1Schema),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV1 = z.infer<typeof productSnapshotV1Schema>;
