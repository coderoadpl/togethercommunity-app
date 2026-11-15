import type { z } from 'zod';

import { tenantSettingsSchema, updateTenantSettingsInputSchema } from './tenant.js';

const SHOP_SETTINGS_FIELDS = {
  name: true,
  defaultLanguage: true,
  logoUrl: true,
  logoDarkUrl: true,
  faviconUrl: true,
  accentColor: true,
  accentLight: true,
  ogImageUrl: true,
  socialLinks: true,
  checkoutAppearance: true,
  supportEmail: true,
  supportUrl: true,
  termsUrl: true,
  privacyUrl: true,
  invoiceSellerName: true,
  invoiceSellerAddress: true,
  invoiceVatMode: true,
  invoiceVatRatePercent: true,
  invoiceExemptionBasisKind: true,
  invoiceExemptionBasis: true,
  invoicingProvider: true,
  autoIssueInvoices: true,
  autoIssueInvoiceScope: true,
  ksefSubmissionMode: true,
  shippingRates: true,
  inpostGeowidgetToken: true,
} as const;

export const shopSettingsSchema = tenantSettingsSchema.pick(SHOP_SETTINGS_FIELDS);

export type ShopSettings = z.output<typeof shopSettingsSchema>;

export const shopSettingsPatchSchema = updateTenantSettingsInputSchema.pick(SHOP_SETTINGS_FIELDS).strict();

export type ShopSettingsPatch = z.input<typeof shopSettingsPatchSchema>;
