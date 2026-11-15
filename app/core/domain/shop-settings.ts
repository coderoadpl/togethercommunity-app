import type { z } from 'zod';

import { SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS } from './shop-management-key.js';
import { tenantSettingsSchema, updateTenantSettingsInputSchema } from './tenant.js';

export const shopSettingsSchema = tenantSettingsSchema.pick(SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS);

export type ShopSettings = z.output<typeof shopSettingsSchema>;

export const shopSettingsPatchSchema = updateTenantSettingsInputSchema.pick(SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS).strict();

export type ShopSettingsPatch = z.input<typeof shopSettingsPatchSchema>;
