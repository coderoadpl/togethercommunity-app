import { z } from 'zod';

const currencyV7Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV7Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV7Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV7Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV7Schema = z.discriminatedUnion('level', [
  courseAccessItemV7Schema,
  modulesAccessItemV7Schema,
  lessonsAccessItemV7Schema,
]);

export const productSnapshotV7Schema = z.object({
  vatRate: z.union([z.literal(5), z.literal(8), z.literal(23), z.literal('exempt')]).nullable().optional(),
  vatExemptionBasis: z.string().trim().min(1).max(256).nullable().optional(),
  id: z.string(),
  tenantId: z.string(),
  type: z.enum(['course', 'digital_download', 'membership', 'physical']),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(200),
  description: z.string(),
  coverUrl: z.union([
    z.string().trim().url().regex(/^https?:\/\//iu),
    z.string().trim().regex(/^\/\S+$/),
  ]).nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: currencyV7Schema,
  published: z.boolean(),
  visibility: z.enum(['listed', 'unlisted']).default('listed'),
  deliveryMethod: z.enum(['pickup', 'shipping']).default('pickup'),
  accessItems: z.array(accessItemV7Schema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV7 = z.infer<typeof productSnapshotV7Schema>;
