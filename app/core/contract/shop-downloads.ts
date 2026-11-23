import { z } from 'zod';

import {
  keyDownloadAddInputSchema,
  keyDownloadCompleteInputSchema,
  keyDownloadCopyInputSchema,
  keyDownloadRemoveInputSchema,
  keyDownloadReplaceInputSchema,
  keyDownloadStagedFileViewSchema,
  keyDownloadUploadInputSchema,
  type ShopManagementScope,
} from '#core/domain/index.js';

import { productDownloadAssetsOutputSchema, productDownloadCompleteOutputSchema, productDownloadDeleteOutputSchema } from './routes.js';

const READ = 'shop:catalog:read' satisfies ShopManagementScope;
const WRITE = 'shop:catalog:write' satisfies ShopManagementScope;

export const SHOP_DOWNLOAD_ROUTES = {
  uploadStagedDownload: { method: 'POST', path: '/api/m2m/shop/downloads/upload', scope: WRITE },
  completeStagedDownload: { method: 'POST', path: '/api/m2m/shop/downloads/complete', scope: WRITE },
  copyStagedDownload: { method: 'POST', path: '/api/m2m/shop/downloads/copy', scope: WRITE },
  listStagedDownloads: { method: 'GET', path: '/api/m2m/shop/downloads/staged', scope: WRITE },
  discardStagedDownload: { method: 'DELETE', path: '/api/m2m/shop/downloads/staged/:id', scope: WRITE },
  listProductDownloads: { method: 'GET', path: '/api/m2m/shop/products/:productId/downloads', scope: READ },
  addProductDownload: { method: 'POST', path: '/api/m2m/shop/products/downloads', scope: WRITE },
  replaceProductDownload: { method: 'POST', path: '/api/m2m/shop/products/downloads/replace', scope: WRITE },
  removeProductDownload: { method: 'POST', path: '/api/m2m/shop/products/downloads/remove', scope: WRITE },
} as const;

const stagedDownloadOutputSchema = z.object({ file: keyDownloadStagedFileViewSchema });

export const shopDownloadContracts = {
  uploadStagedDownload: {
    input: keyDownloadUploadInputSchema,
    output: z.object({
      upload: z.object({
        id: z.string().min(1),
        url: z.string().url(),
        headers: z.object({ 'content-type': z.string().min(1), 'content-length': z.string().regex(/^[1-9]\d*$/) }),
        expiresAt: z.string().datetime(),
      }),
    }),
  },
  completeStagedDownload: { input: keyDownloadCompleteInputSchema, output: stagedDownloadOutputSchema },
  copyStagedDownload: { input: keyDownloadCopyInputSchema, output: stagedDownloadOutputSchema },
  listStagedDownloads: { output: z.object({ files: z.array(keyDownloadStagedFileViewSchema) }) },
  discardStagedDownload: { output: z.object({ discarded: z.literal(true) }) },
  listProductDownloads: { output: productDownloadAssetsOutputSchema },
  addProductDownload: { input: keyDownloadAddInputSchema, output: productDownloadCompleteOutputSchema },
  replaceProductDownload: { input: keyDownloadReplaceInputSchema, output: productDownloadCompleteOutputSchema },
  removeProductDownload: { input: keyDownloadRemoveInputSchema, output: productDownloadDeleteOutputSchema },
} as const;
