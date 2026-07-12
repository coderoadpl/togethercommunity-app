import { z } from 'zod';

export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code');

export const productSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string(),
  priceCents: z.number().int().nonnegative(),
  currency: currencySchema,
  published: z.boolean(),
  createdAt: z.string().datetime(),
});

export type Product = z.infer<typeof productSchema>;

export const newProductSchema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(200, 'Title too long'),
  description: z.string().default(''),
  priceCents: z.number().int('Price must be a whole number of cents').nonnegative('Price must not be negative'),
  currency: currencySchema.default('PLN'),
});

export type NewProduct = z.infer<typeof newProductSchema>;
export type NewProductInput = z.input<typeof newProductSchema>;
