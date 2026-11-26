import type { Context } from 'hono';
import type { z } from 'zod';

import { SHOP_SETTINGS_ROUTES, shopSettingsContracts } from '#core/contract/index.js';
import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import {
  beginBrandingAssetUpload,
  beginProposedBrandingAssetUpload,
  completeBrandingAssetUpload,
  completeProposedBrandingAssetUpload,
  getShopSettings,
  updateShopSettings,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { readJson } from './read-json.js';
import { respond, retryAfterHeaders } from './respond.js';
import { imageUploadAnswer, isProposeModeKey, PROPOSED_IMAGE_UPLOAD, type ShopMachineRoute } from './shop-machine-auth.js';

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
    proposeMode: PROPOSED_IMAGE_UPLOAD,
    handler: async (c, request) => {
      const parsed = shopSettingsContracts.brandingAssetUpload.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset payload', parsed.error.flatten())));
      const quarantined = isProposeModeKey(request);
      const result = quarantined
        ? await beginProposedBrandingAssetUpload(request.ctx, parsed.data, deps)
        : await beginBrandingAssetUpload(request.ctx, parsed.data, deps);
      return respond(result.ok ? ok(imageUploadAnswer(result.value, parsed.data.contentType, quarantined)) : result);
    },
  },
  {
    ...SHOP_SETTINGS_ROUTES.brandingAssetComplete,
    proposeMode: PROPOSED_IMAGE_UPLOAD,
    handler: async (c, request) => {
      const parsed = shopSettingsContracts.brandingAssetComplete.input.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid image asset completion', parsed.error.flatten())));
      const result = isProposeModeKey(request)
        ? await completeProposedBrandingAssetUpload(request.ctx, parsed.data, deps)
        : await completeBrandingAssetUpload(request.ctx, parsed.data, deps);
      return respond(result, result.ok ? {} : { headers: retryAfterHeaders(result.error) });
    },
  },
];
