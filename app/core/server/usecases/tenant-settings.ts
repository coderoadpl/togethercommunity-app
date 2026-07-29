import {
  appError,
  err,
  ok,
  resolveInvoiceVat,
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
  const supportConfigured = settings.supportEmail !== null && settings.supportEmail !== undefined;
  return ok(
    ctx.identity.staffRole === null
      ? { ...settings, supportEmail: null, supportConfigured }
      : { ...settings, supportConfigured },
  );
};

export const updateTenantSettings = async (
  ctx: Ctx,
  input: UpdateTenantSettingsInput,
  deps: TenantSettingsDeps,
): Promise<Result<TenantSettings, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const parsed = updateTenantSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    const exemptionError = input.invoiceVatMode === 'exempt' &&
      parsed.error.issues.some((issue) => issue.path[0] === 'invoiceExemptionBasis');
    return err(exemptionError
      ? appError('invoice_exemption_basis_missing', 'VAT exemption is selected but the legal basis is missing.')
      : validation('Invalid tenant settings', parsed.error.flatten()));
  }
  const current = await deps.tenants.findSettings(tenant.value);
  if (!current) return err(tenantNotFound());
  const merged: TenantSettings = { ...current };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  if (merged.invoiceVatMode === null) {
    return err(validation('Select a supported VAT treatment before updating settings'));
  }
  const coherent: TenantSettings = merged.invoiceVatMode === 'exempt'
    ? { ...merged, invoiceVatRatePercent: null }
    : { ...merged, invoiceExemptionBasisKind: null, invoiceExemptionBasis: null };
  const vatResolution = resolveInvoiceVat(coherent);
  if (coherent.invoiceVatMode === 'exempt' && !vatResolution.ok) {
    return err(appError(
      'invoice_exemption_basis_missing',
      'VAT exemption is selected but the legal basis is missing.',
    ));
  }
  return ok(await deps.tenants.updateSettings(tenant.value, coherent));
};
