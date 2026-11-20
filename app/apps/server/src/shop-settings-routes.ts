import type { Context } from 'hono';
import type { z } from 'zod';

import { SHOP_SETTINGS_ROUTES, shopSettingsContracts } from '#core/contract/index.js';
import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import {
  beginBrandingAssetUpload,
  completeBrandingAssetUpload,
  getShopSettings,
  updateShopSettings,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

const shopSettingsPatchInput = async (c: Context<AppVars>): Promise<Result<z.output<typeof shopSettingsContracts.updateSettings.input>, AppError>> => {
  const parsed = shopSettingsContracts.updateSettings.input.safeParse(await readJson(c.req.raw));
  return parsed.success ? ok(parsed.data) : err(validation('Invalid shop settings payload', parsed.error.flatten()));
};

export const shopSettingsRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => [
  {
    ...SHOP_SETTINGS_ROUTES.getSettings,
    handler: async (_c, { ctx }) => {
      const result = await getShopSettings(ctx, deps);
      return respond(result.ok ? ok({ settings: result.value }) : result);
    },
  },
  {
    ...SHOP_SETTINGS_ROUTES.updateSettings,
    proposeMode: { kind: 'proposal', operation: 'settings.update', toInput: shopSettingsPatchInput },
    handler: async (c, { ctx }) => {
      const input = await shopSettingsPatchInput(c);
      if (!input.ok) return respond(input);
      const result = await updateShopSettings(ctx, input.value, deps);
      return respond(result.ok ? ok({ settings: result.value }) : result);
    },
  },
  {
    ...SHOP_SETTINGS_ROUTES.brandingAssetUpload,
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => {
      const parsed = shopSettingsContracts.brandingAssetUpload.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset payload', parsed.error.flatten())));
      const result = await beginBrandingAssetUpload(ctx, parsed.data, deps);
      return respond(result.ok
        ? ok({
            key: result.value.key,
            servePath: result.value.servePath,
            upload: {
              url: result.value.uploadUrl,
              headers: { 'content-type': parsed.data.contentType },
              expiresAt: result.value.expiresAt,
            },
          })
        : result);
    },
  },
  {
    ...SHOP_SETTINGS_ROUTES.brandingAssetComplete,
    proposeMode: { kind: 'refuse', reason: 'not-in-release' },
    handler: async (c, { ctx }) => {
      const parsed = shopSettingsContracts.brandingAssetComplete.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset completion', parsed.error.flatten())));
      return respond(await completeBrandingAssetUpload(ctx, parsed.data, deps));
    },
  },
];
