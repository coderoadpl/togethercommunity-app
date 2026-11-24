import { z } from 'zod';

import {
  changeProposalIdInputSchema,
  changeProposalProductIdInputSchema,
  type ChangeProposal,
  type RegisteredChangeProposalOperation,
} from './change-proposal.js';
import { keyDownloadAddInputSchema, keyDownloadRemoveInputSchema, keyDownloadReplaceInputSchema } from './change-proposal-download.js';
import { newProductPriceSchema } from './commerce.js';
import {
  accessItemSchema,
  newProductSchema,
  setProductAccessInputSchema,
  uniqueAccessItemsSchema,
  updateProductInputSchema,
  type AccessItem,
} from './product.js';
import { salesLinkDeleteInputSchema, salesLinkInputSchema, salesLinkUpdateSchema } from './sales-link.js';
import { shopSettingsPatchSchema } from './shop-settings.js';
import { adjustStockInputSchema, enableStockTrackingInputSchema, stockThresholdInputSchema } from './stock.js';
import { strictInput } from './strict-input.js';

export const strictNewProductInputSchema = strictInput(newProductSchema);
export const strictUpdateProductInputSchema = strictInput(updateProductInputSchema);
export const strictSetProductAccessInputSchema = strictInput(setProductAccessInputSchema);
export const strictNewProductPriceInputSchema = strictInput(newProductPriceSchema);
export const strictEnableStockTrackingInputSchema = strictInput(enableStockTrackingInputSchema);
export const strictAdjustStockInputSchema = strictInput(adjustStockInputSchema);
export const strictStockThresholdInputSchema = strictInput(stockThresholdInputSchema);
export const strictSalesLinkInputSchema = strictInput(salesLinkInputSchema);
export const strictSalesLinkUpdateInputSchema = strictInput(salesLinkUpdateSchema);
export const strictShopSettingsPatchInputSchema = strictInput(shopSettingsPatchSchema);

export const CHANGE_PROPOSAL_INPUT_SCHEMAS = {
  'product.create': strictInput(newProductSchema.extend({ accessItems: uniqueAccessItemsSchema.default([]) })),
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
  'product.set-access': strictSetProductAccessInputSchema,
  'download.add': strictInput(keyDownloadAddInputSchema),
  'download.replace': strictInput(keyDownloadReplaceInputSchema),
  'download.remove': strictInput(keyDownloadRemoveInputSchema),
} as const satisfies Record<RegisteredChangeProposalOperation, z.ZodTypeAny>;

const storedAccessItemsSchema = z.array(accessItemSchema).nullable().transform((items) => items ?? []);

export interface ChangeProposalAccessChange {
  before: AccessItem[];
  after: AccessItem[];
}

export const changeProposalAccessChange = (proposal: Pick<ChangeProposal, 'operation' | 'effect'>): ChangeProposalAccessChange | null => {
  if (proposal.operation !== 'product.set-access') return null;
  const change = proposal.effect['accessItems'];
  if (change === undefined || !('before' in change)) return null;
  const before = storedAccessItemsSchema.safeParse(change.before);
  const after = storedAccessItemsSchema.safeParse(change.after);
  return before.success && after.success ? { before: before.data, after: after.data } : null;
};

export interface AccessItemIds {
  courseIds: string[];
  moduleIds: string[];
  lessonIds: string[];
}

export const accessItemIds = (items: readonly AccessItem[]): AccessItemIds => ({
  courseIds: [...new Set(items.map((item) => item.courseId))],
  moduleIds: [...new Set(items.flatMap((item) => item.level === 'modules' ? item.moduleIds : item.level === 'course' ? item.excludedModuleIds ?? [] : []))],
  lessonIds: [...new Set(items.flatMap((item) => item.level === 'lessons' ? item.lessonIds : []))],
});
