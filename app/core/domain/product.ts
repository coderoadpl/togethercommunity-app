import { z } from 'zod';

export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

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
});

export type ProductAccessIssues = z.infer<typeof productAccessIssuesSchema>;

export const productSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string(),
  priceCents: z.number().int().nonnegative(),
  currency: currencySchema,
  published: z.boolean(),
  accessItems: z.array(accessItemSchema),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type Product = z.infer<typeof productSchema>;

export const newProductSchema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(200, 'Title too long'),
  description: z.string().default(''),
  priceCents: z.number().int('Price must be a whole number of cents').nonnegative('Price must not be negative'),
  currency: currencySchema.default('PLN'),
  accessItems: z.array(accessItemSchema).default([]),
});

export type NewProduct = z.infer<typeof newProductSchema>;
export type NewProductInput = z.input<typeof newProductSchema>;

export const updateProductAccessItemsInputSchema = z.object({
  id: z.string().min(1),
  accessItems: z.array(accessItemSchema),
});

export type UpdateProductAccessItemsInput = z.input<typeof updateProductAccessItemsInputSchema>;
