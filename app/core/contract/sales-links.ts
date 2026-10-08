import { z } from 'zod';
import { salesLinkSchema, salesLinkInputSchema, salesLinkUpdateSchema, salesLinkOfferSchema, tenantBrandingSchema, tenantSocialLinkSchema, languageSchema } from '#core/domain/index.js';

const idInput = z.object({ id: z.string().min(1) }).strict();
const publicTenantSchema = z.object({
  slug: z.string(), name: z.string(), defaultLanguage: languageSchema,
  signInNotice: z.object({ enabled: z.boolean(), text: z.string() }), branding: tenantBrandingSchema,
  socialLinks: z.array(tenantSocialLinkSchema), legal: z.object({ termsUrl: z.string().nullable(), privacyUrl: z.string().nullable() }), support: z.object({ url: z.string().nullable() }), timezone: z.string(),
});
const marketingConsentSchema = z.object({ definitionId: z.string(), label: z.string(), doubleOptIn: z.boolean(), documentUrl: z.string().nullable() });
export const salesLinkContracts = {
  listSalesLinks: { input: z.object({}).strict(), output: z.object({ salesLinks: z.array(salesLinkSchema) }) },
  getSalesLink: { input: idInput, output: z.object({ salesLink: salesLinkSchema }) },
  createSalesLink: { input: salesLinkInputSchema, output: z.object({ salesLink: salesLinkSchema }) },
  updateSalesLink: { input: salesLinkUpdateSchema, output: z.object({ salesLink: salesLinkSchema }) },
  deleteSalesLink: { input: idInput, output: z.object({ deleted: z.literal(true) }) },
  getPublicSalesLink: { input: z.object({ slug: z.string().min(1) }).strict(), output: salesLinkOfferSchema.extend({ tenant: publicTenantSchema, marketingConsents: z.array(marketingConsentSchema) }) },
} as const;
export const SALES_LINK_ROUTES = {
  listSalesLinks: { method: 'GET', path: '/api/sales-links' },
  createSalesLink: { method: 'POST', path: '/api/sales-links' },
  getSalesLink: { method: 'GET', path: '/api/sales-links/:id' },
  updateSalesLink: { method: 'POST', path: '/api/sales-links/:id' },
  deleteSalesLink: { method: 'DELETE', path: '/api/sales-links/:id' },
  getPublicSalesLink: { method: 'GET', path: '/api/public/sales-links/:slug' },
} as const;
