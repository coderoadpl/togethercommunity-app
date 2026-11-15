import { z } from 'zod';

import { shopSettingsPatchSchema, shopSettingsSchema, type ShopManagementScope } from '#core/domain/index.js';

import {
  imageAssetCompleteOutputSchema,
  imageAssetCompleteRequestSchema,
  imageAssetUploadOutputSchema,
  imageAssetUploadRequestSchema,
} from './routes.js';
import { strictInput } from './strict-input.js';

const READ = 'shop:settings:read' satisfies ShopManagementScope;
const WRITE = 'shop:settings:write' satisfies ShopManagementScope;

export const SHOP_SETTINGS_ROUTES = {
  getSettings: { method: 'GET', path: '/api/m2m/shop/settings', scope: READ },
  updateSettings: { method: 'POST', path: '/api/m2m/shop/settings', scope: WRITE },
  brandingAssetUpload: { method: 'POST', path: '/api/m2m/shop/image-assets/branding/upload', scope: WRITE },
  brandingAssetComplete: { method: 'POST', path: '/api/m2m/shop/image-assets/branding/complete', scope: WRITE },
} as const;

const shopSettingsOutputSchema = z.object({ settings: shopSettingsSchema });

export const shopSettingsContracts = {
  getSettings: { output: shopSettingsOutputSchema },
  updateSettings: { input: strictInput(shopSettingsPatchSchema), output: shopSettingsOutputSchema },
  brandingAssetUpload: { input: strictInput(imageAssetUploadRequestSchema), output: imageAssetUploadOutputSchema },
  brandingAssetComplete: { input: strictInput(imageAssetCompleteRequestSchema), output: imageAssetCompleteOutputSchema },
} as const;
