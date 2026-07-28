import {
  err,
  ok,
  tenantNotFound,
  updateTenantSettingsInputSchema,
  validation,
  type AppError,
  type Result,
  type TenantSettings,
  type UpdateTenantSettingsInput,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { TenantRepository } from '../ports.js';

export interface TenantSettingsDeps {
  tenants: TenantRepository;
}

export const getTenantSettings = async (
  ctx: Ctx,
  deps: TenantSettingsDeps,
): Promise<Result<TenantSettings, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:read');
  if (!tenant.ok) return tenant;
  const settings = await deps.tenants.findSettings(tenant.value);
  if (!settings) return err(tenantNotFound());
  return ok(settings);
};

export const updateTenantSettings = async (
  ctx: Ctx,
  input: UpdateTenantSettingsInput,
  deps: TenantSettingsDeps,
): Promise<Result<TenantSettings, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const parsed = updateTenantSettingsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid tenant settings', parsed.error.flatten()));
  const current = await deps.tenants.findSettings(tenant.value);
  if (!current) return err(tenantNotFound());
  return ok(
    await deps.tenants.updateSettings(tenant.value, {
      billingPortalUrl:
        parsed.data.billingPortalUrl === undefined ? current.billingPortalUrl : parsed.data.billingPortalUrl,
      bunnyStreamLibraryId:
        parsed.data.bunnyStreamLibraryId === undefined
          ? current.bunnyStreamLibraryId
          : parsed.data.bunnyStreamLibraryId,
      logoUrl: parsed.data.logoUrl === undefined ? current.logoUrl : parsed.data.logoUrl,
      accentColor: parsed.data.accentColor === undefined ? current.accentColor : parsed.data.accentColor,
      faviconUrl: parsed.data.faviconUrl === undefined ? current.faviconUrl : parsed.data.faviconUrl,
      ogTitle: parsed.data.ogTitle === undefined ? current.ogTitle : parsed.data.ogTitle,
      ogDescription:
        parsed.data.ogDescription === undefined ? current.ogDescription : parsed.data.ogDescription,
      ogImageUrl:
        parsed.data.ogImageUrl === undefined ? current.ogImageUrl : parsed.data.ogImageUrl,
      supportEmail:
        parsed.data.supportEmail === undefined ? current.supportEmail : parsed.data.supportEmail,
      supportUrl: parsed.data.supportUrl === undefined ? current.supportUrl : parsed.data.supportUrl,
      termsUrl: parsed.data.termsUrl === undefined ? current.termsUrl : parsed.data.termsUrl,
      privacyUrl: parsed.data.privacyUrl === undefined ? current.privacyUrl : parsed.data.privacyUrl,
      autoIssueInvoices:
        parsed.data.autoIssueInvoices === undefined
          ? current.autoIssueInvoices
          : parsed.data.autoIssueInvoices,
      autoIssueInvoiceScope:
        parsed.data.autoIssueInvoiceScope === undefined
          ? current.autoIssueInvoiceScope
          : parsed.data.autoIssueInvoiceScope,
      invoiceVatRatePercent:
        parsed.data.invoiceVatRatePercent === undefined
          ? current.invoiceVatRatePercent
          : parsed.data.invoiceVatRatePercent,
      invoicingProvider:
        parsed.data.invoicingProvider === undefined
          ? current.invoicingProvider
          : parsed.data.invoicingProvider,
      invoiceSellerName:
        parsed.data.invoiceSellerName === undefined
          ? current.invoiceSellerName
          : parsed.data.invoiceSellerName,
      invoiceSellerAddress:
        parsed.data.invoiceSellerAddress === undefined
          ? current.invoiceSellerAddress
          : parsed.data.invoiceSellerAddress,
    }),
  );
};
