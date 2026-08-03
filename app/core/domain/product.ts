import { z } from 'zod';

export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

export const SUPPORTED_CURRENCIES = ['PLN', 'EUR', 'USD'] as const;

export const PRODUCT_TYPES = ['course', 'digital_download', 'membership'] as const;

export const productTypeSchema = z.enum(PRODUCT_TYPES);

export type ProductType = z.infer<typeof productTypeSchema>;

export const productSlugSchema = z
  .string()
  .trim()
  .min(1, 'Slug must not be empty')
  .max(100, 'Slug too long')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must contain lowercase letters, numbers and hyphens only');

const newProductDescriptionSchema = z.string().max(50_000, 'Description too long');

export const productCoverUrlSchema = z
  .string()
  .trim()
  .url('Cover must be a valid URL')
  .regex(/^https?:\/\//iu, 'Cover URL must use HTTP or HTTPS');

export const productSlugFromTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 100)
    .replace(/^-+|-+$/g, '');

const PRICE_MAJOR_PATTERN = /^\d+([.,]\d{1,2})?$/;

/**
 * Parses a price entered in major currency units (e.g. `199`, `199.99` or the
 * Polish `199,99`) into an integer number of minor units (cents/grosze),
 * rejecting more than two decimals. Integer arithmetic avoids the float drift
 * of `amount * 100`.
 */
export const priceMajorSchema = z
  .string()
  .trim()
  .regex(PRICE_MAJOR_PATTERN, 'Price must be a non-negative amount with at most two decimals')
  .transform((value) => {
    const [whole = '0', fraction = ''] = value.replace(',', '.').split('.');
    return Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);
  });

const courseAccessItemSchema = z
  .object({
    level: z.literal('course'),
    courseId: z.string().min(1),
    excludedModuleIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const modulesAccessItemSchema = z
  .object({
    level: z.literal('modules'),
    courseId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1, 'Select at least one module'),
  })
  .strict();

const lessonsAccessItemSchema = z
  .object({
    level: z.literal('lessons'),
    courseId: z.string().min(1),
    lessonIds: z.array(z.string().min(1)).min(1, 'Select at least one lesson'),
  })
  .strict();

export const accessItemSchema = z.discriminatedUnion('level', [
  courseAccessItemSchema,
  modulesAccessItemSchema,
  lessonsAccessItemSchema,
]);

export type AccessItem = z.infer<typeof accessItemSchema>;

export const productAccessIssuesSchema = z.object({
  productId: z.string(),
  productTitle: z.string(),
  missingCourseIds: z.array(z.string()),
  missingModuleIds: z.array(z.string()),
  missingLessonIds: z.array(z.string()),
  unreachableModuleIds: z.array(z.string()),
  unreachableLessonIds: z.array(z.string()),
});

export type ProductAccessIssues = z.infer<typeof productAccessIssuesSchema>;

export const productSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  type: productTypeSchema,
  slug: productSlugSchema,
  title: z.string().min(1).max(200),
  description: z.string(),
  coverUrl: productCoverUrlSchema.nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: currencySchema,
  published: z.boolean(),
  accessItems: z.array(accessItemSchema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type Product = z.infer<typeof productSchema>;

export const newProductSchema = z.object({
  type: productTypeSchema.default('course'),
  slug: productSlugSchema.optional(),
  title: z.string().trim().min(1, 'Title must not be empty').max(200, 'Title too long'),
  description: newProductDescriptionSchema.default(''),
  coverUrl: productCoverUrlSchema.nullable().default(null),
  priceCents: z.number().int('Price must be a whole number of cents').nonnegative('Price must not be negative'),
  currency: currencySchema.default('PLN'),
  accessItems: z.array(accessItemSchema).default([]),
});

export type NewProduct = z.infer<typeof newProductSchema>;
export type NewProductInput = z.input<typeof newProductSchema>;

export const updateProductAccessItemsInputSchema = z.object({
  id: z.string().min(1),
  accessItems: z.array(accessItemSchema),
  checkoutConsentDefinitionIds: z.array(z.string().min(1)).optional(),
});

export type UpdateProductAccessItemsInput = z.input<typeof updateProductAccessItemsInputSchema>;
