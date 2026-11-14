import { z } from 'zod';

const currencyV8Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV8Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV8Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV8Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV8Schema = z.discriminatedUnion('level', [
  courseAccessItemV8Schema,
  modulesAccessItemV8Schema,
  lessonsAccessItemV8Schema,
]);

const productComplianceV8Schema = z.object({
  manufacturerName: z.string().trim().min(1).max(200),
  manufacturerAddress: z.string().trim().min(1).max(300),
  manufacturerEmail: z.string().trim().email().max(254),
  modelIdentifier: z.string().trim().min(1).max(100),
  batchIdentifier: z.string().trim().min(1).max(100).nullable().optional(),
  safetyWarnings: z.string().max(5000).default(''),
  instructionsUrl: z.string().trim().url().regex(/^https:\/\//iu).nullable().optional(),
}).strict();

export const productSnapshotV8Schema = z.object({
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
  currency: currencyV8Schema,
  published: z.boolean(),
  visibility: z.enum(['listed', 'unlisted']).default('listed'),
  deliveryMethod: z.enum(['pickup', 'shipping']).default('pickup'),
  compliance: productComplianceV8Schema.nullable().optional(),
  variantGroup: z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().optional(),
  variantLabel: z.string().trim().min(1).max(60).nullable().optional(),
  accessItems: z.array(accessItemV8Schema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV8 = z.infer<typeof productSnapshotV8Schema>;
