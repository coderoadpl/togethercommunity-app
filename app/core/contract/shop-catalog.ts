import type { ShopManagementScope } from '#core/domain/index.js';

import { productDeleteInputSchema, productDeleteOutputSchema } from './catalog-cleanup.js';
import {
  productPriceCreateInputSchema,
  productPriceCreateOutputSchema,
  productPriceDeactivateInputSchema,
  productPriceDeactivateOutputSchema,
  productPricesListOutputSchema,
  productsCreateInputSchema,
  productsCreateOutputSchema,
  productsListOutputSchema,
  productsPublishInputSchema,
  productsPublishOutputSchema,
  productStockAdjustInputSchema,
  productStockEnableInputSchema,
  productStockOutputSchema,
  productStockThresholdInputSchema,
  productStockWriteOutputSchema,
  productsUnpublishInputSchema,
  productsUnpublishOutputSchema,
  productsUpdateInputSchema,
  productsUpdateOutputSchema,
} from './routes.js';

const READ = 'shop:catalog:read' satisfies ShopManagementScope;
const WRITE = 'shop:catalog:write' satisfies ShopManagementScope;

export const SHOP_CATALOG_ROUTES = {
  listProducts: { method: 'GET', path: '/api/m2m/shop/products', scope: READ },
  createProduct: { method: 'POST', path: '/api/m2m/shop/products', scope: WRITE },
  updateProduct: { method: 'POST', path: '/api/m2m/shop/products/update', scope: WRITE },
  publishProduct: { method: 'POST', path: '/api/m2m/shop/products/publish', scope: WRITE },
  unpublishProduct: { method: 'POST', path: '/api/m2m/shop/products/unpublish', scope: WRITE },
  deleteProductDraft: { method: 'POST', path: '/api/m2m/shop/products/delete', scope: WRITE },
  listProductPrices: { method: 'GET', path: '/api/m2m/shop/products/:productId/prices', scope: READ },
  createProductPrice: { method: 'POST', path: '/api/m2m/shop/products/prices', scope: WRITE },
  deactivateProductPrice: { method: 'POST', path: '/api/m2m/shop/products/prices/deactivate', scope: WRITE },
  getProductStock: { method: 'GET', path: '/api/m2m/shop/products/:productId/stock', scope: READ },
  enableProductStock: { method: 'POST', path: '/api/m2m/shop/products/stock/enable', scope: WRITE },
  adjustProductStock: { method: 'POST', path: '/api/m2m/shop/products/stock/adjust', scope: WRITE },
  setProductStockThreshold: { method: 'POST', path: '/api/m2m/shop/products/stock/threshold', scope: WRITE },
} as const;

export const shopCatalogContracts = {
  listProducts: { output: productsListOutputSchema },
  createProduct: { input: productsCreateInputSchema, output: productsCreateOutputSchema },
  updateProduct: { input: productsUpdateInputSchema, output: productsUpdateOutputSchema },
  publishProduct: { input: productsPublishInputSchema, output: productsPublishOutputSchema },
  unpublishProduct: { input: productsUnpublishInputSchema, output: productsUnpublishOutputSchema },
  deleteProductDraft: { input: productDeleteInputSchema, output: productDeleteOutputSchema },
  listProductPrices: { output: productPricesListOutputSchema },
  createProductPrice: { input: productPriceCreateInputSchema, output: productPriceCreateOutputSchema },
  deactivateProductPrice: { input: productPriceDeactivateInputSchema, output: productPriceDeactivateOutputSchema },
  getProductStock: { output: productStockOutputSchema },
  enableProductStock: { input: productStockEnableInputSchema, output: productStockWriteOutputSchema },
  adjustProductStock: { input: productStockAdjustInputSchema, output: productStockWriteOutputSchema },
  setProductStockThreshold: { input: productStockThresholdInputSchema, output: productStockWriteOutputSchema },
} as const;
