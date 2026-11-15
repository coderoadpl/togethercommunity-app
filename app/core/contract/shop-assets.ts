import type { ShopManagementScope } from '#core/domain/index.js';

import {
  imageAssetCompleteOutputSchema,
  imageAssetCompleteRequestSchema,
  imageAssetUploadOutputSchema,
  imageAssetUploadRequestSchema,
} from './routes.js';
import { salesLinkContracts } from './sales-links.js';

const READ = 'shop:catalog:read' satisfies ShopManagementScope;
const WRITE = 'shop:catalog:write' satisfies ShopManagementScope;

export const SHOP_ASSETS_ROUTES = {
  productCoverUpload: { method: 'POST', path: '/api/m2m/shop/image-assets/product-cover/upload', scope: WRITE },
  productCoverComplete: { method: 'POST', path: '/api/m2m/shop/image-assets/product-cover/complete', scope: WRITE },
  listSalesLinks: { method: 'GET', path: '/api/m2m/shop/sales-links', scope: READ },
  getSalesLink: { method: 'GET', path: '/api/m2m/shop/sales-links/:id', scope: READ },
  createSalesLink: { method: 'POST', path: '/api/m2m/shop/sales-links', scope: WRITE },
  updateSalesLink: { method: 'POST', path: '/api/m2m/shop/sales-links/:id', scope: WRITE },
  deleteSalesLink: { method: 'DELETE', path: '/api/m2m/shop/sales-links/:id', scope: WRITE },
} as const;

export const shopAssetsContracts = {
  productCoverUpload: { input: imageAssetUploadRequestSchema, output: imageAssetUploadOutputSchema },
  productCoverComplete: { input: imageAssetCompleteRequestSchema, output: imageAssetCompleteOutputSchema },
  listSalesLinks: salesLinkContracts.listSalesLinks,
  createSalesLink: salesLinkContracts.createSalesLink,
  getSalesLink: salesLinkContracts.getSalesLink,
  updateSalesLink: salesLinkContracts.updateSalesLink,
  deleteSalesLink: salesLinkContracts.deleteSalesLink,
} as const;
