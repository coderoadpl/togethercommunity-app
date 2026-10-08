import { z } from 'zod';

const currencyV6Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV6Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV6Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV6Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV6Schema = z.discriminatedUnion('level', [
  courseAccessItemV6Schema,
  modulesAccessItemV6Schema,
  lessonsAccessItemV6Schema,
]);

export const productSnapshotV6Schema = z.object({
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
  currency: currencyV6Schema,
  published: z.boolean(),
  visibility: z.enum(['listed', 'unlisted']).default('listed'),
  accessItems: z.array(accessItemV6Schema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV6 = z.infer<typeof productSnapshotV6Schema>;
