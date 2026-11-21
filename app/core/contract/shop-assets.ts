import { strictInput, strictSalesLinkInputSchema, strictSalesLinkUpdateInputSchema, type ShopManagementScope } from '#core/domain/index.js';

import {
  imageAssetCompleteRequestSchema,
  imageAssetUploadRequestSchema,
  shopImageAssetCompleteOutputSchema,
  shopImageAssetUploadOutputSchema,
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
  productCoverUpload: { input: strictInput(imageAssetUploadRequestSchema), output: shopImageAssetUploadOutputSchema },
  productCoverComplete: { input: strictInput(imageAssetCompleteRequestSchema), output: shopImageAssetCompleteOutputSchema },
  listSalesLinks: salesLinkContracts.listSalesLinks,
  createSalesLink: { ...salesLinkContracts.createSalesLink, input: strictSalesLinkInputSchema },
  getSalesLink: salesLinkContracts.getSalesLink,
  updateSalesLink: { ...salesLinkContracts.updateSalesLink, input: strictSalesLinkUpdateInputSchema },
  deleteSalesLink: salesLinkContracts.deleteSalesLink,
} as const;
