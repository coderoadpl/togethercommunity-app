import { z } from 'zod';
import { currencySchema, productSlugSchema, productTypeSchema } from './product.js';
import { productVatRateSchema } from './product-vat.js';

export const SALES_LINK_TIME_ZONE = 'Europe/Warsaw';

const fields = {
  slug: productSlugSchema,
  title: z.string().trim().min(1).max(200),
  heading: z.string().trim().min(1).max(200),
  description: z.string().max(50000).default(''),
  productIds: z.array(z.string().min(1)).min(1).max(50).refine((ids) => new Set(ids).size === ids.length, 'Each product may appear only once'),
  active: z.boolean().default(false),
  listed: z.boolean().default(false),
  validFrom: z.string().datetime().nullable().default(null),
  validTo: z.string().datetime().nullable().default(null),
};
const validWindow = (value: { validFrom: string | null; validTo: string | null }) => value.validFrom === null || value.validTo === null || Date.parse(value.validFrom) < Date.parse(value.validTo);
export const salesLinkInputSchema = z.object(fields).strict().refine(validWindow, 'Validity end must follow its start');
export const salesLinkUpdateSchema = z.object({ ...fields, id: z.string().min(1), expectedRevision: z.number().int().positive() }).strict().refine(validWindow, 'Validity end must follow its start');
export const salesLinkSchema = z.object({ ...fields, id: z.string(), tenantId: z.string(), revision: z.number().int().positive(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).refine(validWindow, 'Validity end must follow its start');
const salesLinkLineSchema = z.object({
  productId: z.string(), name: z.string(), type: productTypeSchema, grossCents: z.number().int().nonnegative(), netCents: z.number().int().nonnegative(), vatCents: z.number().int().nonnegative(), vatRate: productVatRateSchema, vatExemptionBasis: z.string().nullable(),
});
export const salesLinkOfferSchema = z.object({
  salesLink: z.object({ slug: fields.slug, heading: fields.heading, description: fields.description, validFrom: fields.validFrom, validTo: fields.validTo }),
  descriptionHtml: z.string(),
  lines: z.array(salesLinkLineSchema).min(1),
  currency: currencySchema,
  totalCents: z.number().int().nonnegative(),
});
export type SalesLink = z.output<typeof salesLinkSchema>;
export const salesLinkAvailable = (link: SalesLink, now: string): boolean => link.active
  && (link.validFrom === null || Date.parse(now) >= Date.parse(link.validFrom))
  && (link.validTo === null || Date.parse(now) < Date.parse(link.validTo));
