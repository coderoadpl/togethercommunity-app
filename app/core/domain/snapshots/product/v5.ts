import { z } from 'zod';

const currencyV5Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV5Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV5Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV5Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV5Schema = z.discriminatedUnion('level', [
  courseAccessItemV5Schema,
  modulesAccessItemV5Schema,
  lessonsAccessItemV5Schema,
]);

export const productSnapshotV5Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  type: z.enum(['course', 'digital_download', 'membership']),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(200),
  description: z.string(),
  coverUrl: z.union([
    z.string().trim().url().regex(/^https?:\/\//iu),
    z.string().trim().regex(/^\/\S+$/),
  ]).nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: currencyV5Schema,
  published: z.boolean(),
  visibility: z.enum(['listed', 'unlisted']).default('listed'),
  accessItems: z.array(accessItemV5Schema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV5 = z.infer<typeof productSnapshotV5Schema>;
