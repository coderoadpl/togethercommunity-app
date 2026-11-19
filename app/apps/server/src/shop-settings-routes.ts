import { SHOP_SETTINGS_ROUTES, shopSettingsContracts } from '#core/contract/index.js';
import { err, ok, validation } from '#core/domain/index.js';
import {
  beginBrandingAssetUpload,
  completeBrandingAssetUpload,
  getShopSettings,
  updateShopSettings,
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';

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
    handler: async (c, { ctx }) => {
      const parsed = shopSettingsContracts.updateSettings.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid shop settings payload', parsed.error.flatten())));
      const result = await updateShopSettings(ctx, parsed.data, deps);
      return respond(result.ok ? ok({ settings: result.value }) : result);
    },
  },
  {
    ...SHOP_SETTINGS_ROUTES.brandingAssetUpload,
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
    handler: async (c, { ctx }) => {
      const parsed = shopSettingsContracts.brandingAssetComplete.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset completion', parsed.error.flatten())));
      return respond(await completeBrandingAssetUpload(ctx, parsed.data, deps));
    },
  },
];
