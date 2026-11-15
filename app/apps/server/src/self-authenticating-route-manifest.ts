import type { RouterRoute } from 'hono/types';

import { API_PATHS, SHOP_ASSETS_ROUTES, SHOP_CATALOG_ROUTES, SHOP_ORDER_ROUTES, SHOP_SETTINGS_ROUTES } from '#core/contract/index.js';
import type { Capability } from '#core/domain/index.js';

type SelfAuthenticatingRouteManifestEntry = {
  path: string;
  methods: readonly string[];
  mechanism: string;
  capability?: Capability;
};

export const SELF_AUTHENTICATING_ROUTE_MANIFEST: readonly SelfAuthenticatingRouteManifestEntry[] = [
  { path: API_PATHS.operatorTenantProvision, methods: ['POST'], mechanism: 'Operator secret', capability: 'tenant:provision' },
  { path: API_PATHS.operatorTenantReadiness, methods: ['GET'], mechanism: 'Operator secret', capability: 'tenant:readiness' },
  { path: API_PATHS.activitySummary, methods: ['GET'], mechanism: 'Tenant API key', capability: 'report:read' },
  { path: API_PATHS.memberActivity, methods: ['GET'], mechanism: 'Tenant API key', capability: 'report:read' },
  { path: API_PATHS.m2mListMarketingContacts, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mExportMarketingContacts, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mUpsertMarketingContact, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mGetMarketingContact, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mUpdateMarketingContact, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mArchiveMarketingContact, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mRestoreMarketingContact, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mListMarketingLists, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mCreateMarketingList, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mGetMarketingList, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mUpdateMarketingList, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mArchiveMarketingList, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mAddMarketingListContacts, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mRemoveMarketingListContacts, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mPreviewMarketingList, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mGetMarketingListContacts, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mCreateMarketingContactImport, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mAppendMarketingContactImportRows, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mValidateMarketingContactImport, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mCommitMarketingContactImport, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mGetMarketingContactImport, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mGetMarketingContactImportRows, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mRetryMarketingContactImport, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mCancelMarketingContactImport, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportMarketingSuppressions, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mProcessMarketingContactImport, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mSyncMarketingMemberContacts, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.marketingImportsTick, methods: ['GET'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.emailDispatch, methods: ['GET', 'POST'], mechanism: 'E-mail dispatch secret' },
  { path: API_PATHS.autoInvoiceDispatch, methods: ['GET', 'POST'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.ksefDispatch, methods: ['GET', 'POST'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.smokeTenantReseed, methods: ['POST'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.sanitizeStagingSecrets, methods: ['POST'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.authSendLogLatest, methods: ['GET'], mechanism: 'Scheduler operator secret', capability: 'scheduler:read' },
  { path: API_PATHS.tenantDomainDispatch, methods: ['GET', 'POST'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.globalSchedulerRuns, methods: ['GET'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.globalSchedulerRun, methods: ['GET'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.termsConsent, methods: ['POST'], mechanism: 'Authenticated user session before tenant grant' },
  { path: API_PATHS.tenants, methods: ['POST'], mechanism: 'Authenticated user session before tenant grant' },
  { path: API_PATHS.devSimulatePurchase, methods: ['POST'], mechanism: 'Local-development-only composition flag' },
  { path: API_PATHS.devMagicLink, methods: ['GET'], mechanism: 'Local-development-only composition flag' },
  { path: API_PATHS.devEmail, methods: ['GET'], mechanism: 'Local-development-only composition flag' },
  { path: API_PATHS.devGrant, methods: ['POST'], mechanism: 'Local-development-only composition flag' },
  { path: API_PATHS.devSubscriptionSimulateCycle, methods: ['POST'], mechanism: 'Local-development-only composition flag' },
  { path: API_PATHS.devSubscriptionSimulateFailure, methods: ['POST'], mechanism: 'Local-development-only composition flag' },
  { path: API_PATHS.m2mAdoptStripeSubscription, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mListStripeSubscriptions, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mEnroll, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mTransactionalMessagesCreate, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mTransactionalMessage, methods: ['GET'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportValidate, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportCourses, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportModules, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportLessons, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportProducts, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportMembers, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportGrants, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportProgress, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: API_PATHS.m2mImportRedirects, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/messages', methods: ['GET', 'POST'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/messages/:id', methods: ['GET'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/eligibility', methods: ['GET'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/consents', methods: ['POST'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/suppressions', methods: ['GET', 'POST'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/consent-definitions', methods: ['GET'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/templates', methods: ['GET'], mechanism: 'Tenant API key' },
  { path: '/api/internal/marketing/tick', methods: ['GET', 'POST'], mechanism: 'Scheduler operator secret' },
  { path: SHOP_CATALOG_ROUTES.listProducts.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'product:read' },
  { path: SHOP_CATALOG_ROUTES.createProduct.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_CATALOG_ROUTES.updateProduct.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_CATALOG_ROUTES.publishProduct.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:publish' },
  { path: SHOP_CATALOG_ROUTES.unpublishProduct.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:publish' },
  { path: SHOP_CATALOG_ROUTES.deleteProductDraft.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_CATALOG_ROUTES.listProductPrices.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'product:price:read' },
  { path: SHOP_CATALOG_ROUTES.createProductPrice.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:price:write' },
  { path: SHOP_CATALOG_ROUTES.deactivateProductPrice.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:price:write' },
  { path: SHOP_CATALOG_ROUTES.getProductStock.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'product:read' },
  { path: SHOP_CATALOG_ROUTES.enableProductStock.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_CATALOG_ROUTES.adjustProductStock.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_CATALOG_ROUTES.setProductStockThreshold.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_ORDER_ROUTES.listOrders.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'order:read' },
  { path: SHOP_ORDER_ROUTES.exportOrders.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'order:export' },
  { path: SHOP_ORDER_ROUTES.ordersPackingList.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'order:export' },
  { path: SHOP_ORDER_ROUTES.verifyOrder.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'order:read' },
  { path: SHOP_ORDER_ROUTES.getOrder.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'order:read' },
  { path: SHOP_ORDER_ROUTES.shipOrder.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'order:write' },
  { path: SHOP_ORDER_ROUTES.issueOrderLine.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'order:write' },
  { path: SHOP_ORDER_ROUTES.shipxShipment.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'order:read' },
  { path: SHOP_ORDER_ROUTES.shipxCreate.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'order:write' },
  { path: SHOP_ORDER_ROUTES.shipxRefresh.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'order:write' },
  { path: SHOP_ORDER_ROUTES.shipxDiscard.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'order:write' },
  { path: SHOP_ORDER_ROUTES.shipxLabel.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'order:write' },
  { path: SHOP_SETTINGS_ROUTES.getSettings.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'tenant:settings:read' },
  { path: SHOP_SETTINGS_ROUTES.updateSettings.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'tenant:settings:write' },
  { path: SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'tenant:settings:write' },
  { path: SHOP_SETTINGS_ROUTES.brandingAssetComplete.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'tenant:settings:write' },
  { path: SHOP_ASSETS_ROUTES.productCoverUpload.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_ASSETS_ROUTES.productCoverComplete.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_ASSETS_ROUTES.listSalesLinks.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'product:read' },
  { path: SHOP_ASSETS_ROUTES.getSalesLink.path, methods: ['GET'], mechanism: 'Shop management key', capability: 'product:read' },
  { path: SHOP_ASSETS_ROUTES.createSalesLink.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_ASSETS_ROUTES.updateSalesLink.path, methods: ['POST'], mechanism: 'Shop management key', capability: 'product:write' },
  { path: SHOP_ASSETS_ROUTES.deleteSalesLink.path, methods: ['DELETE'], mechanism: 'Shop management key', capability: 'product:write' },
] as const;

export const selfAuthenticatingRouteManifestEntry = (
  route: Pick<RouterRoute, 'method' | 'path'>,
  manifest: readonly SelfAuthenticatingRouteManifestEntry[] = SELF_AUTHENTICATING_ROUTE_MANIFEST,
): SelfAuthenticatingRouteManifestEntry | undefined =>
  manifest.find((entry) => entry.path === route.path && entry.methods.includes(route.method));

export const assertSelfAuthenticatingRouteManifest = (
  routes: readonly RouterRoute[],
  manifest: readonly SelfAuthenticatingRouteManifestEntry[],
): void => {
  const missing = routes
    .filter((route) => route.method !== 'ALL')
    .filter((route) => selfAuthenticatingRouteManifestEntry(route, manifest) === undefined);
  if (missing.length === 0) return;
  throw new Error(
    `Pre-identity routes missing from self-authenticating manifest: ${missing.map((route) => `${route.method} ${route.path}`).join(', ')}`,
  );
};
