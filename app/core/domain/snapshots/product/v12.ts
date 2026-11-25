import { z } from 'zod';

const currencyV12Schema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

const courseAccessItemV12Schema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemV12Schema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemV12Schema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

const accessItemV12Schema = z.discriminatedUnion('level', [
  courseAccessItemV12Schema,
  modulesAccessItemV12Schema,
  lessonsAccessItemV12Schema,
]);

const productImageUrlV12Schema = z.union([
  z.string().trim().url().regex(/^https?:\/\//iu),
  z.string().trim().regex(/^\/\S+$/),
]);

const productImagesV12Schema = z
  .array(z.object({
    url: productImageUrlV12Schema,
    alt: z.string().trim().max(250).default(''),
  }))
  .max(12)
  .superRefine((images, ctx) => {
    const urls = images.map((image) => image.url);
    urls.forEach((url, index) => {
      if (urls.indexOf(url) !== index) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'url'] });
    });
  });

const responsiblePersonFieldsV12 = ['responsiblePersonName', 'responsiblePersonAddress', 'responsiblePersonEmail'] as const;

const productComplianceV12Schema = z.object({
  manufacturerName: z.string().trim().min(1).max(200),
  manufacturerAddress: z.string().trim().min(1).max(300),
  manufacturerEmail: z.string().trim().email().max(254),
  manufacturerOutsideEu: z.boolean().default(false),
  responsiblePersonName: z.string().trim().min(1).max(200).nullable().optional(),
  responsiblePersonAddress: z.string().trim().min(1).max(300).nullable().optional(),
  responsiblePersonEmail: z.string().trim().email().max(254).nullable().optional(),
  modelIdentifier: z.string().trim().min(1).max(100),
  batchIdentifier: z.string().trim().min(1).max(100).nullable().optional(),
  safetyWarnings: z.string().max(5000).default(''),
  instructionsUrl: z.string().trim().url().regex(/^https:\/\//iu).nullable().optional(),
}).strict().superRefine((compliance, ctx) => {
  if (!compliance.manufacturerOutsideEu && responsiblePersonFieldsV12.every((field) => compliance[field] == null)) return;
  for (const field of responsiblePersonFieldsV12) {
    if (compliance[field] == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field] });
  }
});

export const productSnapshotV12Schema = z.object({
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
  images: productImagesV12Schema.optional(),
  priceCents: z.number().int().nonnegative(),
  currency: currencyV12Schema,
  published: z.boolean(),
  visibility: z.enum(['listed', 'unlisted']).default('listed'),
  salesChannel: z.enum(['any', 'sales_links_only']).default('any'),
  deliveryMethod: z.enum(['pickup', 'shipping']).default('pickup'),
  parcelTemplate: z.enum(['small', 'medium', 'large']).optional(),
  compliance: productComplianceV12Schema.nullable().optional(),
  variantGroup: z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().optional(),
  variantLabel: z.string().trim().min(1).max(60).nullable().optional(),
  accessItems: z.array(accessItemV12Schema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductSnapshotV12 = z.infer<typeof productSnapshotV12Schema>;
