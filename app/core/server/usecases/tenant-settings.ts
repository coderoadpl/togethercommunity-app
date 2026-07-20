import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  updateTenantSettingsInputSchema,
  validation,
  type AppError,
  type Result,
  type TenantSettings,
  type UpdateTenantSettingsInput,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantRepository } from '../ports.js';

export interface TenantSettingsDeps {
  tenants: TenantRepository;
}

export const getTenantSettings = async (
  ctx: Ctx,
  deps: TenantSettingsDeps,
): Promise<Result<TenantSettings, AppError>> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to read its settings'));
  const settings = await deps.tenants.findSettings(ctx.identity.tenantId);
  if (!settings) return err(tenantNotFound());
  return ok(settings);
};

export const updateTenantSettings = async (
  ctx: Ctx,
  input: UpdateTenantSettingsInput,
  deps: TenantSettingsDeps,
): Promise<Result<TenantSettings, AppError>> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to update its settings'));
  if (ctx.identity.staffRole !== 'owner') {
    return err(forbidden('Only the owner can change tenant settings'));
  }
  const parsed = updateTenantSettingsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid tenant settings', parsed.error.flatten()));
  const current = await deps.tenants.findSettings(ctx.identity.tenantId);
  if (!current) return err(tenantNotFound());
  return ok(
    await deps.tenants.updateSettings(ctx.identity.tenantId, {
      billingPortalUrl:
        parsed.data.billingPortalUrl === undefined ? current.billingPortalUrl : parsed.data.billingPortalUrl,
      bunnyStreamLibraryId:
        parsed.data.bunnyStreamLibraryId === undefined
          ? current.bunnyStreamLibraryId
          : parsed.data.bunnyStreamLibraryId,
      logoUrl: parsed.data.logoUrl === undefined ? current.logoUrl : parsed.data.logoUrl,
      accentColor: parsed.data.accentColor === undefined ? current.accentColor : parsed.data.accentColor,
      faviconUrl: parsed.data.faviconUrl === undefined ? current.faviconUrl : parsed.data.faviconUrl,
    }),
  );
};
