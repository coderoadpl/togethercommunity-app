import { z } from 'zod';

const currencyV3Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV3Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV3Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV3Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV3Schema = z.discriminatedUnion('level', [
  courseAccessItemV3Schema,
  modulesAccessItemV3Schema,
  lessonsAccessItemV3Schema,
]);

export const productSnapshotV3Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  type: z.enum(['course', 'digital_download', 'membership']),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(200),
  description: z.string(),
  coverUrl: z.string().trim().url().regex(/^https?:\/\//iu).nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: currencyV3Schema,
  published: z.boolean(),
  accessItems: z.array(accessItemV3Schema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV3 = z.infer<typeof productSnapshotV3Schema>;
