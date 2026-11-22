import type { z } from 'zod';

import { changeProposalIdInputSchema, changeProposalProductIdInputSchema, type RegisteredChangeProposalOperation } from './change-proposal.js';
import { keyDownloadAddInputSchema, keyDownloadRemoveInputSchema, keyDownloadReplaceInputSchema } from './change-proposal-download.js';
import { newProductPriceSchema } from './commerce.js';
import { newProductSchema, updateProductInputSchema } from './product.js';
import { salesLinkDeleteInputSchema, salesLinkInputSchema, salesLinkUpdateSchema } from './sales-link.js';
import { shopSettingsPatchSchema } from './shop-settings.js';
import { adjustStockInputSchema, enableStockTrackingInputSchema, stockThresholdInputSchema } from './stock.js';
import { strictInput } from './strict-input.js';

export const strictNewProductInputSchema = strictInput(newProductSchema);
export const strictUpdateProductInputSchema = strictInput(updateProductInputSchema);
export const strictNewProductPriceInputSchema = strictInput(newProductPriceSchema);
export const strictEnableStockTrackingInputSchema = strictInput(enableStockTrackingInputSchema);
export const strictAdjustStockInputSchema = strictInput(adjustStockInputSchema);
export const strictStockThresholdInputSchema = strictInput(stockThresholdInputSchema);
export const strictSalesLinkInputSchema = strictInput(salesLinkInputSchema);
export const strictSalesLinkUpdateInputSchema = strictInput(salesLinkUpdateSchema);
export const strictShopSettingsPatchInputSchema = strictInput(shopSettingsPatchSchema);

export const CHANGE_PROPOSAL_INPUT_SCHEMAS = {
  'product.create': strictNewProductInputSchema,
  'product.update': strictUpdateProductInputSchema,
  'product.publish': strictInput(changeProposalIdInputSchema),
  'product.unpublish': strictInput(changeProposalIdInputSchema),
  'product.delete-draft': strictInput(changeProposalProductIdInputSchema),
  'price.create': strictNewProductPriceInputSchema,
  'price.deactivate': strictInput(changeProposalIdInputSchema),
  'stock.enable': strictEnableStockTrackingInputSchema,
  'stock.adjust': strictAdjustStockInputSchema,
  'stock.set-threshold': strictStockThresholdInputSchema,
  'sales-link.create': strictSalesLinkInputSchema,
  'sales-link.update': strictSalesLinkUpdateInputSchema,
  'sales-link.delete': strictInput(salesLinkDeleteInputSchema),
  'settings.update': strictShopSettingsPatchInputSchema,
  'download.add': strictInput(keyDownloadAddInputSchema),
  'download.replace': strictInput(keyDownloadReplaceInputSchema),
  'download.remove': strictInput(keyDownloadRemoveInputSchema),
} as const satisfies Record<RegisteredChangeProposalOperation, z.ZodTypeAny>;
