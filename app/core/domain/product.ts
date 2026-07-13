import { z } from 'zod';

export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

export const accessItemSchema = z
  .object({
    courseId: z.string().min(1),
    courseLevelAccess: z.boolean(),
    moduleIds: z.array(z.string().min(1)),
    lessonIds: z.array(z.string().min(1)),
  })
  .refine(
    (item) =>
      !item.courseLevelAccess || (item.moduleIds.length === 0 && item.lessonIds.length === 0),
    {
      message: 'Course-level access cannot include moduleIds or lessonIds',
      path: ['courseLevelAccess'],
    },
  );

export type AccessItem = z.infer<typeof accessItemSchema>;

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
