import { z } from 'zod';

import { shopSettingsSchema, strictInput, strictShopSettingsPatchInputSchema, type ShopManagementScope } from '#core/domain/index.js';

import {
  imageAssetCompleteRequestSchema,
  imageAssetUploadRequestSchema,
  shopImageAssetCompleteOutputSchema,
  shopImageAssetUploadOutputSchema,
} from './routes.js';

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
  updateSettings: { input: strictShopSettingsPatchInputSchema, output: shopSettingsOutputSchema },
  brandingAssetUpload: { input: strictInput(imageAssetUploadRequestSchema), output: shopImageAssetUploadOutputSchema },
  brandingAssetComplete: { input: strictInput(imageAssetCompleteRequestSchema), output: shopImageAssetCompleteOutputSchema },
} as const;
