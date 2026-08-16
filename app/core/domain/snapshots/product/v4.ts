import { z } from 'zod';

const currencyV4Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV4Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV4Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV4Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV4Schema = z.discriminatedUnion('level', [
  courseAccessItemV4Schema,
  modulesAccessItemV4Schema,
  lessonsAccessItemV4Schema,
]);

export const productSnapshotV4Schema = z.object({
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
  currency: currencyV4Schema,
  published: z.boolean(),
  accessItems: z.array(accessItemV4Schema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV4 = z.infer<typeof productSnapshotV4Schema>;
