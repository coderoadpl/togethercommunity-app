import {
  appError,
  err,
  forbidden,
  ok,
  resolveInvoiceVat,
  tenantNotFound,
  updateTenantSettingsInputSchema,
  validation,
  type AppError,
  type Result,
  type ShopManagementKeySettingsGrant,
  type TenantSettings,
  type UpdateTenantSettingsInput,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { ProductRepository, SpaceRepository, TenantRepository } from '../ports.js';

export interface TenantSettingsProjection {
  settings: TenantSettings;
  personalisationMaxBytes: number | null;
}

export interface TenantSettingsDeps {
  tenants: TenantRepository;
  spaces: SpaceRepository;
  products: Pick<ProductRepository, 'bumpContentVersion'>;
  personalisationMaxBytes: number;
}

export const getTenantSettings = async (
  ctx: Ctx,
  deps: TenantSettingsDeps,
): Promise<Result<TenantSettingsProjection, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:read');
  if (!tenant.ok) return tenant;
  if (ctx.identity.staffRole === null) return err(forbidden('Staff role is required'));
  const settings = await deps.tenants.findSettings(tenant.value);
  if (!settings) return err(tenantNotFound());
  const supportConfigured = settings.supportEmail !== null && settings.supportEmail !== undefined;
  return ok({
    settings: { ...settings, supportConfigured },
    personalisationMaxBytes: deps.personalisationMaxBytes,
  });
};

export const getMemberSettings = async (
  ctx: Ctx,
  deps: Pick<TenantSettingsDeps, 'tenants'>,
) => {
  const tenant = authorizeTenant(ctx, 'member:settings:read');
  if (!tenant.ok) return tenant;
  const settings = await deps.tenants.findSettings(tenant.value);
  if (!settings) return err(tenantNotFound());
  return ok({
    settings: {
      billingPortalUrl: settings.billingPortalUrl,
      supportConfigured: settings.supportEmail !== null && settings.supportEmail !== undefined,
      supportUrl: settings.supportUrl,
      videoAutoplayDefault: settings.videoAutoplayDefault ?? false,
      memberVideoAutoplayOverride: settings.memberVideoAutoplayOverride ?? false,
    },
  });
};

interface UpdateTenantSettingsOptions {
  shopManagementKeyGrant?: ShopManagementKeySettingsGrant;
}

const keyGrantCoversPatch = (
  grant: ShopManagementKeySettingsGrant | undefined,
  patch: Readonly<Record<string, unknown>>,
): boolean =>
  grant?.operation === 'shop-settings:update'
  && Object.entries(patch).every(([field, value]) => value === undefined || grant.fields.includes(field));

export const updateTenantSettings = async (
  ctx: Ctx,
  input: UpdateTenantSettingsInput,
  deps: TenantSettingsDeps,
  options: UpdateTenantSettingsOptions = {},
): Promise<Result<TenantSettings, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write', options);
  if (!tenant.ok) return tenant;
  const parsed = updateTenantSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    const exemptionError = input.invoiceVatMode === 'exempt' &&
      parsed.error.issues.some((issue) => issue.path[0] === 'invoiceExemptionBasis');
    return err(exemptionError
      ? appError('invoice_exemption_basis_missing', 'VAT exemption is selected but the legal basis is missing.')
      : validation('Invalid tenant settings', parsed.error.flatten()));
  }
  if (ctx.machineActor !== undefined && !keyGrantCoversPatch(options.shopManagementKeyGrant, parsed.data)) {
    return err(forbidden('tenant:settings:write is not permitted for a shop management key on a field its operation does not name'));
  }
  const current = await deps.tenants.findSettings(tenant.value);
  if (!current) return err(tenantNotFound());
  const homeSpaceId = parsed.data.defaultHomeSpaceId;
  if (homeSpaceId !== undefined && homeSpaceId !== null) {
    const space = await deps.spaces.findById(tenant.value, homeSpaceId);
    if (!space || space.archivedAt !== null || !space.publicReadOnly) {
      return err(validation('The tenant home space must be an active publicly readable space'));
    }
  }
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
  const updated = await deps.tenants.updateSettings(tenant.value, coherent);
  await deps.products.bumpContentVersion(tenant.value);
  return ok(updated);
};
