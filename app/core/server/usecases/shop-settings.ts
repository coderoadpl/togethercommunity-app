import {
  err,
  ok,
  shopSettingsPatchSchema,
  validation,
  type AppError,
  type Result,
  type ShopManagementKeySettingsGrant,
  type ShopSettings,
  type ShopSettingsPatch,
  type TenantSettings,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { getTenantSettings, updateTenantSettings, type TenantSettingsDeps, type TenantSettingsWriteDeps } from './tenant-settings.js';

const projectShopSettings = (settings: TenantSettings): ShopSettings => ({
  name: settings.name,
  defaultLanguage: settings.defaultLanguage,
  logoUrl: settings.logoUrl,
  logoDarkUrl: settings.logoDarkUrl,
  faviconUrl: settings.faviconUrl,
  accentColor: settings.accentColor,
  accentLight: settings.accentLight,
  ogTitle: settings.ogTitle,
  ogDescription: settings.ogDescription,
  ogImageUrl: settings.ogImageUrl,
  socialLinks: settings.socialLinks,
  checkoutAppearance: settings.checkoutAppearance,
  supportEmail: settings.supportEmail,
  supportUrl: settings.supportUrl,
  termsUrl: settings.termsUrl,
  privacyUrl: settings.privacyUrl,
  invoiceSellerName: settings.invoiceSellerName,
  invoiceSellerAddress: settings.invoiceSellerAddress,
  invoiceVatMode: settings.invoiceVatMode,
  invoiceVatRatePercent: settings.invoiceVatRatePercent,
  invoiceExemptionBasisKind: settings.invoiceExemptionBasisKind,
  invoiceExemptionBasis: settings.invoiceExemptionBasis,
  invoicingProvider: settings.invoicingProvider,
  autoIssueInvoices: settings.autoIssueInvoices,
  autoIssueInvoiceScope: settings.autoIssueInvoiceScope,
  ksefSubmissionMode: settings.ksefSubmissionMode,
  shippingRates: settings.shippingRates,
  inpostGeowidgetToken: settings.inpostGeowidgetToken,
});

export const getShopSettings = async (
  ctx: Ctx,
  deps: TenantSettingsDeps,
): Promise<Result<ShopSettings, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:read');
  if (!tenant.ok) return tenant;
  const result = await getTenantSettings(ctx, deps);
  return result.ok ? ok(projectShopSettings(result.value.settings)) : result;
};

const shopSettingsUpdateGrant = (patch: ShopSettingsPatch): ShopManagementKeySettingsGrant => ({
  operation: 'shop-settings:update',
  fields: Object.keys(patch),
});

export const updateShopSettings = async (
  ctx: Ctx,
  input: ShopSettingsPatch,
  deps: TenantSettingsWriteDeps,
): Promise<Result<ShopSettings, AppError>> => {
  const parsed = shopSettingsPatchSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid shop settings', parsed.error.flatten()));
  const shopManagementKeyGrant = shopSettingsUpdateGrant(parsed.data);
  const tenant = authorizeTenant(ctx, 'tenant:settings:write', { shopManagementKeyGrant });
  if (!tenant.ok) return tenant;
  const result = await updateTenantSettings(ctx, parsed.data, deps, { shopManagementKeyGrant });
  return result.ok ? ok(projectShopSettings(result.value)) : result;
};
