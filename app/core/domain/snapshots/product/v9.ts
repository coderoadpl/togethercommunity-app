import { z } from 'zod';

const currencyV9Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV9Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV9Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV9Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV9Schema = z.discriminatedUnion('level', [
  courseAccessItemV9Schema,
  modulesAccessItemV9Schema,
  lessonsAccessItemV9Schema,
]);

const productComplianceV9Schema = z.object({
  manufacturerName: z.string().trim().min(1).max(200),
  manufacturerAddress: z.string().trim().min(1).max(300),
  manufacturerEmail: z.string().trim().email().max(254),
  modelIdentifier: z.string().trim().min(1).max(100),
  batchIdentifier: z.string().trim().min(1).max(100).nullable().optional(),
  safetyWarnings: z.string().max(5000).default(''),
  instructionsUrl: z.string().trim().url().regex(/^https:\/\//iu).nullable().optional(),
}).strict();

export const productSnapshotV9Schema = z.object({
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
  currency: currencyV9Schema,
  published: z.boolean(),
  visibility: z.enum(['listed', 'unlisted']).default('listed'),
  deliveryMethod: z.enum(['pickup', 'shipping']).default('pickup'),
  parcelTemplate: z.enum(['small', 'medium', 'large']).optional(),
  compliance: productComplianceV9Schema.nullable().optional(),
  variantGroup: z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().optional(),
  variantLabel: z.string().trim().min(1).max(60).nullable().optional(),
  accessItems: z.array(accessItemV9Schema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV9 = z.infer<typeof productSnapshotV9Schema>;
