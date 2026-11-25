import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type * as ClientModule from '#core/client/index.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { EXIT_CODE_BY_ERROR_CODE } from '#core/contract/index.js';
import { appError, changeProposalGroupItemsDigest, err, ok, PASSWORD_MIN_LENGTH, salesLinkUpdateSchema, type AppError, type Result, type ShipxOrderView } from '#core/domain/index.js';

import pkg from '../../../package.json' with { type: 'json' };

import type { CliConfig, CliProfile, ResolveCliConfigInput } from './config.js';

const OLD_PASSWORD = 'old-password'.padEnd(PASSWORD_MIN_LENGTH, 'x');
const NEW_PASSWORD = 'new-password'.padEnd(PASSWORD_MIN_LENGTH, 'x');

interface Hoisted {
  listOrders: ReturnType<typeof vi.fn>;
  orderChanges: ReturnType<typeof vi.fn>;
  exportOrders: ReturnType<typeof vi.fn>;
  publicCheckoutSessionStatus: ReturnType<typeof vi.fn>;
  createCheckoutSession: ReturnType<typeof vi.fn>;
  simulatePurchase: ReturnType<typeof vi.fn>;
  createCartCheckoutSession: ReturnType<typeof vi.fn>;
  directSalesLinkCheckout: ReturnType<typeof vi.fn>;
  getSalesLink: ReturnType<typeof vi.fn>;
  updateSalesLink: ReturnType<typeof vi.fn>;
  sendInvoice: ReturnType<typeof vi.fn>;
  consumerSalesSummary: ReturnType<typeof vi.fn>;
  exportConsumerSales: ReturnType<typeof vi.fn>;
  verifyOrder: ReturnType<typeof vi.fn>;
  issueOrderLine: ReturnType<typeof vi.fn>;
  shipOrder: ReturnType<typeof vi.fn>;
  orderRefundPreview: ReturnType<typeof vi.fn>;
  createOrderRefund: ReturnType<typeof vi.fn>;
  shipOrderAnyway: ReturnType<typeof vi.fn>;
  correctOrderPersonalization: ReturnType<typeof vi.fn>;
  ordersPackingList: ReturnType<typeof vi.fn>;
  listPaymentEventRejections: ReturnType<typeof vi.fn>;
  shipxShipment: ReturnType<typeof vi.fn>;
  shipxRefresh: ReturnType<typeof vi.fn>;
  shipxCreate: ReturnType<typeof vi.fn>;
  shipxDiscard: ReturnType<typeof vi.fn>;
  shipxLabel: ReturnType<typeof vi.fn>;
  shipxSettings: ReturnType<typeof vi.fn>;
  shipxConfigure: ReturnType<typeof vi.fn>;
  provisionOperatorTenant: ReturnType<typeof vi.fn>;
  getOperatorTenantReadiness: ReturnType<typeof vi.fn>;
  activitySummary: ReturnType<typeof vi.fn>;
  memberActivity: ReturnType<typeof vi.fn>;
  createApiKey: ReturnType<typeof vi.fn>;
  createShopManagementKey: ReturnType<typeof vi.fn>;
  listShopManagementKeys: ReturnType<typeof vi.fn>;
  revokeShopManagementKey: ReturnType<typeof vi.fn>;
  purgeShopManagementKeys: ReturnType<typeof vi.fn>;
  listShopManagementKeyEvents: ReturnType<typeof vi.fn>;
  listChangeProposals: ReturnType<typeof vi.fn>;
  getChangeProposal: ReturnType<typeof vi.fn>;
  getChangeProposalFileLink: ReturnType<typeof vi.fn>;
  rejectChangeProposal: ReturnType<typeof vi.fn>;
  approveChangeProposal: ReturnType<typeof vi.fn>;
  getChangeProposalGroup: ReturnType<typeof vi.fn>;
  approveChangeProposalGroup: ReturnType<typeof vi.fn>;
  rejectChangeProposalGroup: ReturnType<typeof vi.fn>;
  listSurveys: ReturnType<typeof vi.fn>;
  createSurvey: ReturnType<typeof vi.fn>;
  deleteSurvey: ReturnType<typeof vi.fn>;
  listMarketingSignupForms: ReturnType<typeof vi.fn>;
  getMarketingSignupForm: ReturnType<typeof vi.fn>;
  createMarketingSignupForm: ReturnType<typeof vi.fn>;
  config: CliConfig;
  loadError: Error | null;
  saved: CliConfig[];
  createProduct: ReturnType<typeof vi.fn>;
  updateProduct: ReturnType<typeof vi.fn>;
  uploadProductImage: ReturnType<typeof vi.fn>;
  archiveCourse: ReturnType<typeof vi.fn>;
  restoreCourse: ReturnType<typeof vi.fn>;
  restoreContentVersion: ReturnType<typeof vi.fn>;
  deleteProductDraft: ReturnType<typeof vi.fn>;
  listProducts: ReturnType<typeof vi.fn>;
  getProductStock: ReturnType<typeof vi.fn>;
  publicOffer: ReturnType<typeof vi.fn>;
  enableProductStock: ReturnType<typeof vi.fn>;
  adjustProductStock: ReturnType<typeof vi.fn>;
  setProductStockThreshold: ReturnType<typeof vi.fn>;
  listCourses: ReturnType<typeof vi.fn>;
  listModules: ReturnType<typeof vi.fn>;
  listLessons: ReturnType<typeof vi.fn>;
  updateLesson: ReturnType<typeof vi.fn<
    (input: { id: string; isPreview?: boolean }) => Promise<Result<{ lesson: unknown }, AppError>>
  >>;
  health: ReturnType<typeof vi.fn>;
  updateCourse: ReturnType<typeof vi.fn>;
  configureStorage: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
  requestPasswordReset: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  signIn: ReturnType<typeof vi.fn>;
  verifyTotp: ReturnType<typeof vi.fn>;
  verifyBackupCode: ReturnType<typeof vi.fn>;
  configureStripe: ReturnType<typeof vi.fn>;
  probeStripePermissions: ReturnType<typeof vi.fn>;
  listTenantTeam: ReturnType<typeof vi.fn>;
  addTenantAdmin: ReturnType<typeof vi.fn>;
  removeTenantAdmin: ReturnType<typeof vi.fn>;
  listOrganizations: ReturnType<typeof vi.fn>;
  addOrganizationMember: ReturnType<typeof vi.fn>;
  setOrganizationMemberRole: ReturnType<typeof vi.fn>;
  removeOrganizationMember: ReturnType<typeof vi.fn>;
  updateOrganization: ReturnType<typeof vi.fn>;
  listOrganizationSecrets: ReturnType<typeof vi.fn>;
  setOrganizationSecret: ReturnType<typeof vi.fn>;
  deleteOrganizationSecret: ReturnType<typeof vi.fn>;
  listOrganizationWorkspaces: ReturnType<typeof vi.fn>;
  getWorkspaceConfigSources: ReturnType<typeof vi.fn>;
  unlinkTenantFromOrganization: ReturnType<typeof vi.fn>;
  getTenantSettings: ReturnType<typeof vi.fn>;
  updateTenantSettings: ReturnType<typeof vi.fn>;
  getTenantRouting: ReturnType<typeof vi.fn>;
  getTenantRedirects: ReturnType<typeof vi.fn>;
  createTenantRedirect: ReturnType<typeof vi.fn>;
  updateTenantRedirect: ReturnType<typeof vi.fn>;
  purgePost: ReturnType<typeof vi.fn>;
  deleteTenantRedirect: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(
  (): Hoisted => ({
    listOrders: vi.fn(),
    orderChanges: vi.fn(),
    exportOrders: vi.fn(),
    publicCheckoutSessionStatus: vi.fn(),
    createCheckoutSession: vi.fn(),
    simulatePurchase: vi.fn(),
    createCartCheckoutSession: vi.fn(),
    directSalesLinkCheckout: vi.fn(),
    getSalesLink: vi.fn(),
    updateSalesLink: vi.fn(),
    sendInvoice: vi.fn(),
    consumerSalesSummary: vi.fn(),
    exportConsumerSales: vi.fn(),
    verifyOrder: vi.fn(),
    issueOrderLine: vi.fn(),
    shipOrder: vi.fn(),
    orderRefundPreview: vi.fn(),
    createOrderRefund: vi.fn(),
    shipOrderAnyway: vi.fn(),
    correctOrderPersonalization: vi.fn(),
    ordersPackingList: vi.fn(),
    listPaymentEventRejections: vi.fn(),
    shipxShipment: vi.fn(),
    shipxRefresh: vi.fn(),
    shipxCreate: vi.fn(),
    shipxDiscard: vi.fn(),
    shipxLabel: vi.fn(),
    shipxSettings: vi.fn(),
    shipxConfigure: vi.fn(),
    provisionOperatorTenant: vi.fn(),
    getOperatorTenantReadiness: vi.fn(),
    activitySummary: vi.fn(),
    memberActivity: vi.fn(),
    createApiKey: vi.fn(),
    createShopManagementKey: vi.fn(),
    listShopManagementKeys: vi.fn(),
    revokeShopManagementKey: vi.fn(),
    purgeShopManagementKeys: vi.fn(),
    listShopManagementKeyEvents: vi.fn(),
    listChangeProposals: vi.fn(),
    getChangeProposal: vi.fn(),
    getChangeProposalFileLink: vi.fn(),
    rejectChangeProposal: vi.fn(),
    approveChangeProposal: vi.fn(),
    getChangeProposalGroup: vi.fn(),
    approveChangeProposalGroup: vi.fn(),
    rejectChangeProposalGroup: vi.fn(),
    listSurveys: vi.fn(),
    createSurvey: vi.fn(),
    deleteSurvey: vi.fn(),
    listMarketingSignupForms: vi.fn(),
    getMarketingSignupForm: vi.fn(),
    createMarketingSignupForm: vi.fn(),
    config: {
      version: 2,
      currentOrigin: 'https://one.example',
      profiles: {
        'https://one.example': { token: 'secret-one', tenant: 'one' },
        'https://two.example': { token: null, tenant: null },
      },
    },
    loadError: null,
    saved: [],
    createProduct: vi.fn(),
    uploadProductImage: vi.fn(),
    updateProduct: vi.fn(),
    archiveCourse: vi.fn(),
    restoreCourse: vi.fn(),
    restoreContentVersion: vi.fn(),
    deleteProductDraft: vi.fn(),
    listProducts: vi.fn(),
    getProductStock: vi.fn(),
    publicOffer: vi.fn(),
    enableProductStock: vi.fn(),
    adjustProductStock: vi.fn(),
    setProductStockThreshold: vi.fn(),
    listCourses: vi.fn(),
    listModules: vi.fn(),
    listLessons: vi.fn(),
    updateLesson: vi.fn<
      (input: { id: string; isPreview?: boolean }) => Promise<Result<{ lesson: unknown }, AppError>>
    >(),
    health: vi.fn(),
    updateCourse: vi.fn(),
    configureStorage: vi.fn(),
    changePassword: vi.fn(),
    requestPasswordReset: vi.fn(),
    signOut: vi.fn(),
    signIn: vi.fn(),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
    configureStripe: vi.fn(),
    probeStripePermissions: vi.fn(),
    listTenantTeam: vi.fn(),
    addTenantAdmin: vi.fn(),
    removeTenantAdmin: vi.fn(),
    listOrganizations: vi.fn(),
    addOrganizationMember: vi.fn(),
    setOrganizationMemberRole: vi.fn(),
    removeOrganizationMember: vi.fn(),
    updateOrganization: vi.fn(),
    listOrganizationSecrets: vi.fn(),
    setOrganizationSecret: vi.fn(),
    deleteOrganizationSecret: vi.fn(),
    listOrganizationWorkspaces: vi.fn(),
    getWorkspaceConfigSources: vi.fn(),
    unlinkTenantFromOrganization: vi.fn(),
    getTenantSettings: vi.fn(),
    updateTenantSettings: vi.fn(),
    getTenantRouting: vi.fn(),
    getTenantRedirects: vi.fn(),
    createTenantRedirect: vi.fn(),
    updateTenantRedirect: vi.fn(),
    deleteTenantRedirect: vi.fn(),
    purgePost: vi.fn(),
  }),
);

vi.mock('./config.js', () => ({
  apiOrigin: (apiUrl: string): string => new URL(apiUrl).origin,
  loadConfig: (): CliConfig => {
    if (h.loadError !== null) throw h.loadError;
    return h.config;
  },
  resolveCliConfig: (input: ResolveCliConfigInput) => {
    const apiUrl = input.apiUrl ?? input.env.TOGETHER_CLI_API_URL ?? input.config.currentOrigin;
    const origin = new URL(apiUrl).origin;
    const profile = input.config.profiles[origin] ?? { token: null, tenant: null };
    return {
      apiUrl,
      origin,
      originSource: input.apiUrl === undefined ? 'stored' as const : 'flag' as const,
      profile,
      tenant: input.tenant ?? input.env.TOGETHER_CLI_TENANT ?? profile.tenant,
    };
  },
  saveConfig: (config: CliConfig): void => {
    h.saved.push(config);
  },
  updateOriginProfile: (
    config: CliConfig,
    origin: string,
    patch: Partial<CliProfile>,
    setCurrent: boolean,
  ): CliConfig => ({
    ...config,
    currentOrigin: setCurrent ? origin : config.currentOrigin,
    profiles: {
      ...config.profiles,
      [origin]: {
        ...(config.profiles[origin] ?? { token: null, tenant: null }),
        ...patch,
      },
    },
  }),
}));

vi.mock('#core/client/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof ClientModule>(),
  createApiClient: () => ({
    listOrders: h.listOrders,
    orderChanges: h.orderChanges,
    exportOrders: h.exportOrders,
    publicCheckoutSessionStatus: h.publicCheckoutSessionStatus,
    createCheckoutSession: h.createCheckoutSession,
    simulatePurchase: h.simulatePurchase,
    createCartCheckoutSession: h.createCartCheckoutSession,
    directSalesLinkCheckout: h.directSalesLinkCheckout,
    getSalesLink: h.getSalesLink,
    updateSalesLink: h.updateSalesLink,
    sendInvoice: h.sendInvoice,
    consumerSalesSummary: h.consumerSalesSummary,
    exportConsumerSales: h.exportConsumerSales,
    verifyOrder: h.verifyOrder,
    issueOrderLine: h.issueOrderLine,
    shipOrder: h.shipOrder,
    orderRefundPreview: h.orderRefundPreview,
    createOrderRefund: h.createOrderRefund,
    shipOrderAnyway: h.shipOrderAnyway,
    correctOrderPersonalization: h.correctOrderPersonalization,
    ordersPackingList: h.ordersPackingList,
    listPaymentEventRejections: h.listPaymentEventRejections,
    shipxShipment: h.shipxShipment,
    shipxRefresh: h.shipxRefresh,
    shipxCreate: h.shipxCreate,
    shipxDiscard: h.shipxDiscard,
    shipxLabel: h.shipxLabel,
    shipxSettings: h.shipxSettings,
    shipxConfigure: h.shipxConfigure,
    provisionOperatorTenant: h.provisionOperatorTenant,
    getOperatorTenantReadiness: h.getOperatorTenantReadiness,
    activitySummary: h.activitySummary,
    memberActivity: h.memberActivity,
    createApiKey: h.createApiKey,
    createShopManagementKey: h.createShopManagementKey,
    listShopManagementKeys: h.listShopManagementKeys,
    revokeShopManagementKey: h.revokeShopManagementKey,
    purgeShopManagementKeys: h.purgeShopManagementKeys,
    listShopManagementKeyEvents: h.listShopManagementKeyEvents,
    listChangeProposals: h.listChangeProposals,
    getChangeProposal: h.getChangeProposal,
    getChangeProposalFileLink: h.getChangeProposalFileLink,
    rejectChangeProposal: h.rejectChangeProposal,
    approveChangeProposal: h.approveChangeProposal,
    getChangeProposalGroup: h.getChangeProposalGroup,
    approveChangeProposalGroup: h.approveChangeProposalGroup,
    rejectChangeProposalGroup: h.rejectChangeProposalGroup,
    listSurveys: h.listSurveys,
    createSurvey: h.createSurvey,
    deleteSurvey: h.deleteSurvey,
    listMarketingSignupForms: h.listMarketingSignupForms,
    getMarketingSignupForm: h.getMarketingSignupForm,
    createMarketingSignupForm: h.createMarketingSignupForm,
    createProduct: h.createProduct,
    uploadProductImage: h.uploadProductImage,
    updateProduct: h.updateProduct,
    archiveCourse: h.archiveCourse,
    restoreCourse: h.restoreCourse,
    restoreContentVersion: h.restoreContentVersion,
    deleteProductDraft: h.deleteProductDraft,
    listProducts: h.listProducts,
    getProductStock: h.getProductStock,
    publicOffer: h.publicOffer,
    enableProductStock: h.enableProductStock,
    adjustProductStock: h.adjustProductStock,
    setProductStockThreshold: h.setProductStockThreshold,
    listCourses: h.listCourses,
    listModules: h.listModules,
    listLessons: h.listLessons,
    updateLesson: h.updateLesson,
    listTenantTeam: h.listTenantTeam,
    addTenantAdmin: h.addTenantAdmin,
    removeTenantAdmin: h.removeTenantAdmin,
    listOrganizations: h.listOrganizations,
    addOrganizationMember: h.addOrganizationMember,
    setOrganizationMemberRole: h.setOrganizationMemberRole,
    removeOrganizationMember: h.removeOrganizationMember,
    updateOrganization: h.updateOrganization,
    listOrganizationSecrets: h.listOrganizationSecrets,
    setOrganizationSecret: h.setOrganizationSecret,
    deleteOrganizationSecret: h.deleteOrganizationSecret,
    listOrganizationWorkspaces: h.listOrganizationWorkspaces,
    getWorkspaceConfigSources: h.getWorkspaceConfigSources,
    unlinkTenantFromOrganization: h.unlinkTenantFromOrganization,
    getTenantSettings: h.getTenantSettings,
    updateTenantSettings: h.updateTenantSettings,
    health: h.health,
    updateCourse: h.updateCourse,
    configureStorage: h.configureStorage,
    configureStripe: h.configureStripe,
    probeStripePermissions: h.probeStripePermissions,
    getTenantRouting: h.getTenantRouting,
    getTenantRedirects: h.getTenantRedirects,
    createTenantRedirect: h.createTenantRedirect,
    updateTenantRedirect: h.updateTenantRedirect,
    deleteTenantRedirect: h.deleteTenantRedirect,
    purgePost: h.purgePost,
  }),
}));

vi.mock('#adapters/auth/client-adapter.js', () => ({
  createCliAuthAdapter: () => ({
    changePassword: h.changePassword,
    requestPasswordReset: h.requestPasswordReset,
    signOut: h.signOut,
    signIn: h.signIn,
    verifyTotp: h.verifyTotp,
    verifyBackupCode: h.verifyBackupCode,
  }),
}));

const redirectFixture = {
  id: 'redirect-legacy',
  tenantId: 'tenant-one',
  fromPath: '/legacy/one',
  targetKind: 'course' as const,
  targetId: 'course-js',
  targetPath: '/my/courses/course-js',
  targetAnchor: null,
  permanent: true,
  locked: false,
  hitCount: 0,
  lastHitAt: null,
  origin: 'import' as const,
  createdBy: null,
  createdAt: '1998-08-14T10:00:00.000Z',
};

const shipxOrderView: ShipxOrderView = {
  available: true, reason: null, environment: 'sandbox', service: 'inpost_locker_standard', parcelTemplate: 'medium', shipment: null,
};

const originalArgv = process.argv;
let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

const run = async (...args: string[]): Promise<void> => {
  process.argv = ['node', 'together', ...args];
  vi.resetModules();
  await import('./main.js');
};

const soleJson = (): unknown => {
  expect(logSpy).toHaveBeenCalledTimes(1);
  return JSON.parse(String(logSpy.mock.calls[0]?.[0]));
};

beforeEach(() => {
  h.listOrders.mockReset().mockResolvedValue(ok({ orders: [], total: 0, page: 1, pageSize: 20, sources: [] }));
  h.publicCheckoutSessionStatus.mockReset().mockResolvedValue(ok({ status: 'pending' }));
  h.createCheckoutSession.mockReset().mockResolvedValue(ok({ url: 'https://checkout.stripe.test/session' }));
  h.simulatePurchase.mockReset().mockResolvedValue(ok({
    memberId: 'member-1',
    productId: 'product-1',
    alreadyOwned: false,
    subscriptionId: null,
    orderId: 'order-1',
    magicLink: null,
  }));
  h.createCartCheckoutSession.mockReset().mockResolvedValue(ok({ url: 'https://checkout.stripe.test/cart' }));
  h.directSalesLinkCheckout.mockReset().mockResolvedValue(ok({ url: 'https://checkout.stripe.test/session' }));
  h.getSalesLink.mockReset();
  h.updateSalesLink.mockReset().mockResolvedValue(ok({ salesLink: { id: 'link-1' } }));
  h.sendInvoice.mockReset();
  h.updateTenantSettings.mockReset();
  h.consumerSalesSummary.mockReset().mockResolvedValue(ok({ totals: { grossCents: 105 } }));
  h.exportConsumerSales.mockReset().mockResolvedValue(ok({ filename: 'consumer-sales.csv', mimeType: 'text/csv', content: 'rate,gross_cents\n5,105' }));
  h.verifyOrder.mockReset().mockResolvedValue(ok({ order: { id: 'order-number', status: 'paid' } }));
  h.issueOrderLine.mockReset().mockResolvedValue(ok({ order: { id: 'order-number', lines: [{ productId: 'physical', issuedCount: 1 }] } }));
  h.shipOrder.mockReset().mockResolvedValue(ok({ order: { id: 'order-number', fulfilmentStatus: 'shipped', shipment: { carrier: 'inpost', trackingNumber: 'ABCD1234' } } }));
  h.orderRefundPreview.mockReset().mockResolvedValue(ok({
    orderId: 'order-number', refundable: true, blockedReason: null, paidCents: 4099, refundedCents: 0, remainderCents: 4099, currency: 'PLN',
    mode: 'live', remainderSource: 'provider', refundedAmountUnknown: false, grantsAccess: false, returnableStock: [], onPackingList: true, hasShipment: false, hasInvoice: false, cancelsSubscription: false,
    fullRefundOptions: { restockOffered: true, restockDefault: true, removeFromPackingListOffered: true, removeFromPackingListDefault: true },
    waitingRefundId: null,
  }));
  h.createOrderRefund.mockReset().mockResolvedValue(ok({ created: true, refund: { id: 'refund-1', kind: 'amount', status: 'pending', amountCents: 1250, currency: 'PLN', restocked: false, removedFromPackingList: false } }));
  h.shipOrderAnyway.mockReset().mockResolvedValue(ok({ order: { id: 'order-number', fulfilmentStatus: 'to_pack' } }));
  h.correctOrderPersonalization.mockReset().mockResolvedValue(ok({ order: { id: 'order-number' } }));
  h.listPaymentEventRejections.mockReset().mockResolvedValue(ok({ rejections: [] }));
  h.ordersPackingList.mockReset().mockResolvedValue(ok({ filename: 'packing-list-acme.csv', mimeType: 'text/csv; charset=utf-8', content: 'order_number,paid_at' }));
  h.shipxShipment.mockReset().mockResolvedValue(ok(shipxOrderView));
  h.shipxRefresh.mockReset().mockResolvedValue(ok(shipxOrderView));
  h.shipxCreate.mockReset().mockResolvedValue(ok({ order: { id: 'order-number', fulfilmentStatus: 'shipped' }, shipment: { shipxShipmentId: '1001', status: 'confirmed', trackingNumber: '520000011395200025754311' } }));
  h.shipxDiscard.mockReset().mockResolvedValue(ok({ discarded: true }));
  h.shipxLabel.mockReset().mockResolvedValue(ok({ filename: 'inpost-520000011395200025754311.pdf', contentType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4') }));
  const unconnected = { organizationId: null, token: null, configured: false };
  h.shipxSettings.mockReset().mockResolvedValue(ok({ sender: null, sandbox: unconnected, production: unconnected }));
  h.shipxConfigure.mockReset().mockResolvedValue(ok({
    sender: null,
    sandbox: unconnected,
    production: { organizationId: { maskedPreview: '••••1234', updatedAt: '2026-11-08T10:00:00.000Z' }, token: { maskedPreview: '••••5678', updatedAt: '2026-11-08T10:00:00.000Z' }, configured: true },
  }));
  h.listSurveys.mockReset().mockResolvedValue(ok({ surveys: [] }));
  h.createSurvey.mockReset();
  h.deleteSurvey.mockReset().mockResolvedValue(ok({ deleted: true }));
  h.listMarketingSignupForms.mockReset().mockResolvedValue(ok({ forms: [] }));
  h.getMarketingSignupForm.mockReset().mockResolvedValue(err(appError('not_found', 'Signup form was not found')));
  h.createMarketingSignupForm.mockReset().mockResolvedValue(ok({ form: { id: 'form-newsletter' } }));
  h.createProduct.mockReset().mockResolvedValue(ok({ product: { id: 'product-1', title: 'Course' } }));
  h.updateProduct.mockReset().mockResolvedValue(ok({ product: { id: 'product-1', title: 'Course' } }));
  h.uploadProductImage.mockReset().mockResolvedValue(ok({ url: '/api/public/assets/product-image/1.png' }));
  h.archiveCourse.mockReset().mockResolvedValue(ok({ course: { id: 'course-1', name: 'Course' } }));
  h.restoreCourse.mockReset().mockResolvedValue(ok({ course: { id: 'course-1', name: 'Course' } }));
  h.restoreContentVersion.mockReset().mockResolvedValue(ok({ restored: { entityKind: 'course', entityId: 'course-1', restoredFromOrdinal: 2 } }));
  h.deleteProductDraft.mockReset().mockResolvedValue(ok({ deleted: true }));
  h.listCourses.mockReset();
  h.listModules.mockReset();
  h.listLessons.mockReset();
  h.updateLesson.mockReset();
  h.loadError = null;
  h.saved = [];
  h.health.mockReset();
  h.updateCourse.mockReset();
  h.health.mockResolvedValue(ok({
    status: 'ok',
    database: 'up',
    version: '0.1.0',
    sha: 'cafe1234',
    environment: 'test',
    production: false,
    commit: 'cafe1234',
    databaseFingerprint: null,
    expectedMigrations: 82,
    appliedMigrations: 82,
    schemaCurrent: true,
    schemaFingerprint: 'c087b16a6bb6',
    schemaFingerprintMatch: true,
  }));
  h.configureStorage.mockReset();
  h.configureStorage.mockResolvedValue(ok({
    diagnostic: { code: 'storage.available', message: 'Storage completed the probe.' },
    secret: { key: 's3.configuration', maskedPreview: '••••', updatedAt: '2026-08-03T12:00:00.000Z' },
  }));
  h.signOut.mockReset();
  h.signOut.mockResolvedValue(ok(undefined));
  h.signIn.mockReset();
  h.signIn.mockResolvedValue(ok({ token: 'session-token', twoFactorRedirect: false }));
  h.verifyTotp.mockReset();
  h.verifyTotp.mockResolvedValue(ok({ token: 'two-factor-token', twoFactorRedirect: false }));
  h.verifyBackupCode.mockReset();
  h.verifyBackupCode.mockResolvedValue(ok({ token: 'backup-token', twoFactorRedirect: false }));
  h.changePassword.mockReset();
  h.changePassword.mockResolvedValue(ok(undefined));
  h.requestPasswordReset.mockReset();
  h.requestPasswordReset.mockResolvedValue(ok(undefined));
  h.configureStripe.mockReset();
  h.configureStripe.mockResolvedValue(ok({
    mode: 'test',
    webhookUrl: 'https://app.example.test/base/api/webhooks/stripe/tenant-1',
  }));
  h.getTenantRedirects.mockReset();
  h.getTenantRedirects.mockResolvedValue(ok({ redirects: [redirectFixture], total: 1 }));
  h.createTenantRedirect.mockReset();
  h.createTenantRedirect.mockResolvedValue(ok({ redirect: redirectFixture }));
  h.updateTenantRedirect.mockReset();
  h.updateTenantRedirect.mockResolvedValue(ok({ redirect: redirectFixture }));
  h.purgePost.mockReset().mockResolvedValue(ok({ id: 'post-1' }));
  h.deleteTenantRedirect.mockReset();
  h.deleteTenantRedirect.mockResolvedValue(ok({ id: redirectFixture.id }));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

afterAll(() => {
  process.argv = originalArgv;
});

describe('checkout session-status CLI', () => {
  it.each(['pending', 'paid'] as const)('prints the %s status envelope for the requested session', async (status) => {
    h.publicCheckoutSessionStatus.mockResolvedValue(ok({ status }));

    await run('--json', 'checkout', 'session-status', '--session-id', 'cs_test_one');

    expect(h.publicCheckoutSessionStatus).toHaveBeenCalledExactlyOnceWith('cs_test_one');
    expect(soleJson()).toEqual({ ok: true, data: { status } });
    expect(process.exitCode).toBe(0);
  });

  it('preserves the validation envelope and exit code for a malformed session', async () => {
    const failure = err(appError('validation', 'Invalid checkout session id'));
    h.publicCheckoutSessionStatus.mockResolvedValue(failure);

    await run('--json', 'checkout', 'session-status', '--session-id', 'invalid');

    expect(h.publicCheckoutSessionStatus).toHaveBeenCalledExactlyOnceWith('invalid');
    expect(soleJson()).toEqual(failure);
    expect(process.exitCode).toBe(2);
  });
});

describe('terms acceptance flag', () => {
  it('starts a checkout session with termsAccepted only when --accept-terms is given', async () => {
    await run('--json', 'checkout', 'session', '--product', 'product-1', '--email', 'buyer@example.test');
    expect(h.createCheckoutSession).toHaveBeenCalledExactlyOnceWith({ productId: 'product-1', email: 'buyer@example.test' });

    h.createCheckoutSession.mockClear();
    logSpy.mockClear();
    await run('--json', 'checkout', 'session', '--product', 'product-1', '--email', 'buyer@example.test', '--accept-terms');
    expect(h.createCheckoutSession).toHaveBeenCalledExactlyOnceWith({
      productId: 'product-1',
      email: 'buyer@example.test',
      termsAccepted: true,
    });
    expect(soleJson()).toEqual({ ok: true, data: { url: 'https://checkout.stripe.test/session' } });
    expect(process.exitCode).toBe(0);
  });

  it('starts a cart checkout session with termsAccepted only when --accept-terms is given', async () => {
    const paperback = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    await run('--json', 'checkout', 'session', '--line', `${paperback}:2`, '--email', 'buyer@example.test');
    expect(h.createCartCheckoutSession).toHaveBeenCalledExactlyOnceWith({ lines: [{ productId: paperback, quantity: 2 }], email: 'buyer@example.test' });

    h.createCartCheckoutSession.mockClear();
    logSpy.mockClear();
    await run('--json', 'checkout', 'session', '--line', `${paperback}:2`, '--email', 'buyer@example.test', '--accept-terms');
    expect(h.createCartCheckoutSession).toHaveBeenCalledExactlyOnceWith({
      lines: [{ productId: paperback, quantity: 2 }],
      email: 'buyer@example.test',
      termsAccepted: true,
    });
    expect(h.createCheckoutSession).not.toHaveBeenCalled();
    expect(soleJson()).toEqual({ ok: true, data: { url: 'https://checkout.stripe.test/cart' } });
    expect(process.exitCode).toBe(0);
  });

  it('simulates a purchase with termsAccepted only when --accept-terms is given', async () => {
    await run('--json', 'simulate-purchase', '--product', 'product-1', '--email', 'buyer@example.test');
    expect(h.simulatePurchase).toHaveBeenCalledExactlyOnceWith({ productId: 'product-1', email: 'buyer@example.test' });

    h.simulatePurchase.mockClear();
    logSpy.mockClear();
    await run('--json', 'simulate-purchase', '--product', 'product-1', '--email', 'buyer@example.test', '--accept-terms');
    expect(h.simulatePurchase).toHaveBeenCalledExactlyOnceWith({
      productId: 'product-1',
      email: 'buyer@example.test',
      termsAccepted: true,
    });
    expect(soleJson()).toMatchObject({ ok: true, data: { orderId: 'order-1' } });
    expect(process.exitCode).toBe(0);
  });
});

describe('cart checkout CLI', () => {
  const paperback = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const poster = '7a2b3c4d-5e6f-4a70-8b8c-9d0e1f2a3b4c';

  it('posts the cart form built from repeated --line options', async () => {
    await run('--json', 'checkout', 'session', '--line', `${paperback}:2`, '--line', `${poster}:1`, '--shipping-rate', 'courier', '--language', 'en');
    expect(h.createCartCheckoutSession).toHaveBeenCalledExactlyOnceWith({
      lines: [{ productId: paperback, quantity: 2 }, { productId: poster, quantity: 1 }],
      language: 'en',
      shipping: { rateId: 'courier' },
    });
    expect(h.createCheckoutSession).not.toHaveBeenCalled();
    expect(soleJson()).toEqual({ ok: true, data: { url: 'https://checkout.stripe.test/cart' } });
  });

  it('sends --client-reference with both request forms', async () => {
    await run('--json', 'checkout', 'session', '--line', `${paperback}:1`, '--client-reference', 'shop-cart-8812');
    expect(h.createCartCheckoutSession).toHaveBeenCalledExactlyOnceWith({ lines: [{ productId: paperback, quantity: 1 }], clientReference: 'shop-cart-8812' });
    await run('--json', 'checkout', 'session', '--product', paperback, '--client-reference', 'shop-order-17');
    expect(h.createCheckoutSession).toHaveBeenCalledExactlyOnceWith({ productId: paperback, clientReference: 'shop-order-17' });
  });

  it('keeps the single-product request of --product unchanged', async () => {
    await run('--json', 'checkout', 'session', '--product', paperback, '--email', 'buyer@example.com');
    expect(h.createCheckoutSession).toHaveBeenCalledExactlyOnceWith({ productId: paperback, email: 'buyer@example.com' });
    expect(h.createCartCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a line without a quantity', args: ['--line', paperback] },
    { label: 'a zero quantity', args: ['--line', `${paperback}:0`] },
    { label: 'a fractional quantity', args: ['--line', `${paperback}:1.5`] },
    { label: 'a product id that is not a UUID', args: ['--line', 'paperback:2'] },
    { label: 'the same product twice', args: ['--line', `${paperback}:1`, '--line', `${paperback}:2`] },
    { label: '--line together with --product', args: ['--line', `${paperback}:1`, '--product', poster] },
    { label: 'neither --line nor --product', args: [] },
  ])('rejects $label before calling the API', async ({ args }) => {
    await run('--json', 'checkout', 'session', ...args);
    expect(h.createCartCheckoutSession).not.toHaveBeenCalled();
    expect(h.createCheckoutSession).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });
});

describe('sales-link checkout CLI', () => {
  it.each([{ options: [] }, { options: ['--mode', 'live'] }])('starts live checkout with options $options', async ({ options }) => {
    await run('--json', 'sales-link', 'checkout', 'offer-one', ...options);
    expect(h.directSalesLinkCheckout).toHaveBeenCalledExactlyOnceWith({ slug: 'offer-one' });
    expect(soleJson()).toEqual({ ok: true, data: { url: 'https://checkout.stripe.test/session' } });
    expect(process.exitCode).toBe(0);
  });

  it('rejects test mode before starting checkout', async () => {
    await run('--json', 'sales-link', 'checkout', 'offer-one', '--mode', 'test');
    expect(h.directSalesLinkCheckout).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });
});

it('updates a sales link with a cancel return address from JSON', async () => {
  const input = {
    id: 'link-1', expectedRevision: 1, slug: 'offer-one', title: 'Offer',
    heading: 'One offer', description: '', productIds: ['product-1'], active: false,
    listed: false, validFrom: null, validTo: null,
    cancelReturnUrl: 'https://sales.example.test/offer#details',
  };
  await run('--json', 'sales-link', 'update', 'link-1', '--input', JSON.stringify(input));
  expect(h.updateSalesLink).toHaveBeenCalledExactlyOnceWith(input);
  expect(soleJson()).toEqual({ ok: true, data: { salesLink: { id: 'link-1' } } });
  expect(process.exitCode).toBe(0);
});

it.each([['activate', true], ['deactivate', false]] as const)('%s resends every editable field of the stored sales link', async (command, active) => {
  const editable = {
    id: 'link-1', slug: 'offer-one', title: 'Offer', heading: 'One offer', description: '<p>Two products</p>',
    productIds: ['product-1', 'product-2'], listed: true, validFrom: '2026-11-01T10:00:00.000Z', validTo: '2026-12-01T10:00:00.000Z',
    cancelReturnUrl: 'https://togethercommunity.app/offer',
  };
  h.getSalesLink.mockResolvedValue(ok({ salesLink: {
    ...editable, active: !active, tenantId: 't1', revision: 4, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z',
  } }));
  await run('--json', 'sales-link', command, 'link-1');
  const expected = { ...editable, expectedRevision: 4, active };
  expect(h.updateSalesLink).toHaveBeenCalledExactlyOnceWith(expected);
  expect(Object.keys(salesLinkUpdateSchema.innerType().shape).sort()).toEqual(Object.keys(expected).sort());
});

describe('one-envelope discipline', () => {
  it('emits one validation envelope for an unknown command', async () => {
    await run('--json', 'bogus-command');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('emits one internal envelope for a fatal config error', async () => {
    h.loadError = new Error('together: invalid ~/.config/together/config.json: malformed JSON');

    await run('--json', 'health');

    expect(h.health).not.toHaveBeenCalled();
    expect(soleJson()).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'together: invalid ~/.config/together/config.json: malformed JSON',
      },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(10);
  });

  it('validates global options before constructing transport', async () => {
    await run('--json', '--api-url', 'not-a-url', 'health');

    expect(h.health).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });
});

describe('version identity', () => {
  it('emits the manifest version without calling health', async () => {
    await run('--json', 'version');

    expect(soleJson()).toEqual({
      ok: true,
      data: { name: 'together', version: pkg.version },
    });
    expect(h.health).not.toHaveBeenCalled();
  });

  it('prints the manifest version for the version command without calling health', async () => {
    await run('version');

    expect(logSpy).toHaveBeenCalledExactlyOnceWith(pkg.version);
    expect(h.health).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('prints the manifest version for --version without calling health', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run('--version');

    expect(stdoutSpy).toHaveBeenCalledWith(`${pkg.version}\n`);
    expect(h.health).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('emits the manifest version envelope for --json --version without calling health', async () => {
    await run('--json', '--version');

    expect(soleJson()).toEqual({
      ok: true,
      data: { name: 'together', version: pkg.version },
    });
    expect(h.health).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});

describe('origin profiles', () => {
  it('lists origins without exposing token values', async () => {
    await run('--json', 'origin', 'list');

    const output = soleJson();
    expect(output).toMatchObject({
      ok: true,
      data: {
        origins: [
          { origin: 'https://one.example', current: true, hasToken: true, tenant: 'one' },
          { origin: 'https://two.example', current: false, hasToken: false, tenant: null },
        ],
      },
    });
    expect(JSON.stringify(output)).not.toContain('secret-one');
  });

  it('selects a canonical origin without a network call', async () => {
    await run('origin', 'use', 'HTTPS://TWO.example:443/path');

    expect(h.health).not.toHaveBeenCalled();
    expect(h.saved.at(-1)?.currentOrigin).toBe('https://two.example');
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('active origin: https://two.example');
  });

  it('revokes the server session before clearing the active token', async () => {
    await run('logout');

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.saved.at(-1)?.profiles['https://one.example']).toEqual({
      token: null,
      tenant: 'one',
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('signed out');
  });

  it('preserves a failed sign-out result while clearing the local token', async () => {
    h.signOut.mockResolvedValue(err(appError('internal', 'sign-out failed')));

    await run('--json', 'logout');

    expect(soleJson()).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'sign-out failed' },
    });
    expect(h.saved.at(-1)?.profiles['https://one.example']?.token).toBeNull();
    expect(process.exitCode).toBe(10);
  });
});

describe('storage configure', () => {
  it('sends the whole connection to the probing endpoint and prints its diagnostic', async () => {
    await run(
      'storage',
      'configure',
      '--provider',
      'minio',
      '--endpoint',
      'http://localhost:9000',
      '--region',
      'us-east-1',
      '--bucket',
      'studio-files',
      '--access-key-id',
      'minio-access',
      '--secret-access-key',
      'minio-secret',
    );

    expect(h.configureStorage).toHaveBeenCalledExactlyOnceWith({
      provider: 'minio',
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'studio-files',
      accessKeyId: 'minio-access',
      secretAccessKey: 'minio-secret',
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('Storage completed the probe.');
    expect(process.exitCode).toBe(0);
  });

  it('rejects an unknown provider before calling the API', async () => {
    await run(
      'storage',
      'configure',
      '--provider',
      'dropbox',
      '--endpoint',
      'http://localhost:9000',
      '--region',
      'us-east-1',
      '--bucket',
      'studio-files',
      '--access-key-id',
      'minio-access',
      '--secret-access-key',
      'minio-secret',
    );

    expect(h.configureStorage).not.toHaveBeenCalled();
    expect(process.exitCode).not.toBe(0);
  });
});

describe('change-password', () => {
  it('emits the documented JSON result without exposing transport state', async () => {
    await run(
      '--json',
      'change-password',
      '--current-password',
      OLD_PASSWORD,
      '--new-password',
      NEW_PASSWORD,
      '--sign-out-other-sessions',
    );

    expect(h.changePassword).toHaveBeenCalledExactlyOnceWith({
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    });
    const output = soleJson();
    expect(output).toEqual({
      ok: true,
      data: { changed: true, revokedOtherSessions: true },
    });
    expect(JSON.stringify(output)).not.toContain('secret-one');
    expect(process.exitCode).toBe(0);
  });

  it('returns exit 2 when the current password is rejected', async () => {
    h.changePassword.mockResolvedValue(err(appError('validation', 'Invalid password')));

    await run(
      '--json',
      'change-password',
      '--current-password',
      'wrong-password',
      '--new-password',
      NEW_PASSWORD,
    );

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('returns exit 3 when there is no authenticated session', async () => {
    h.changePassword.mockResolvedValue(err(appError('unauthorized', 'Authentication required')));

    await run(
      '--json',
      'change-password',
      '--current-password',
      OLD_PASSWORD,
      '--new-password',
      NEW_PASSWORD,
    );

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(process.exitCode).toBe(3);
  });

  it('rejects a new password below the shared minimum before calling the adapter', async () => {
    await run(
      '--json',
      'change-password',
      '--current-password',
      OLD_PASSWORD,
      '--new-password',
      'short',
    );

    expect(h.changePassword).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });
});

describe('request-password-reset', () => {
  it('derives redirectTo from the API URL origin', async () => {
    await run(
      '--json',
      '--api-url',
      'https://studio.example/api-prefix',
      'request-password-reset',
      '--email',
      'member@example.com',
      '--language',
      'en',
    );

    expect(h.requestPasswordReset).toHaveBeenCalledExactlyOnceWith({
      email: 'member@example.com',
      redirectTo: 'https://studio.example/reset-password',
      language: 'en',
    });
    expect(soleJson()).toEqual({ ok: true });
    expect(process.exitCode).toBe(0);
  });
});

describe('login two-factor challenge', () => {
  it('completes a password challenge with a TOTP code before storing the session', async () => {
    h.signIn.mockResolvedValue(ok({ token: null, twoFactorRedirect: true }));

    await run(
      'login',
      '--email',
      'member@example.com',
      '--password',
      'secret12',
      '--totp-code',
      '123456',
    );

    expect(h.verifyTotp).toHaveBeenCalledExactlyOnceWith('123456');
    expect(h.saved.at(-1)?.profiles['https://one.example']?.token).toBe('two-factor-token');
  });

  it('supports a backup code and refuses to persist the provisional result', async () => {
    h.signIn.mockResolvedValue(ok({ token: null, twoFactorRedirect: true }));

    await run(
      'login',
      '--email',
      'member@example.com',
      '--password',
      'secret12',
      '--backup-code',
      'backup-once',
    );

    expect(h.verifyBackupCode).toHaveBeenCalledExactlyOnceWith('backup-once');
    expect(h.saved.at(-1)?.profiles['https://one.example']?.token).toBe('backup-token');
  });

  it('requires a second-factor option when the provider returns a challenge', async () => {
    h.signIn.mockResolvedValue(ok({ token: null, twoFactorRedirect: true }));

    await run(
      '--json',
      'login',
      '--email',
      'member@example.com',
      '--password',
      'secret12',
    );

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.saved).toHaveLength(0);
  });
});

describe('stripe configure', () => {
  it('registers the webhook through the same API used by the integrations panel', async () => {
    h.configureStripe.mockResolvedValue(ok({
      mode: 'live',
      webhookUrl: 'https://app.example.test/base/api/webhooks/stripe/tenant-1',
    }));

    await run('stripe', 'configure', 'rk_live_private');

    expect(h.configureStripe).toHaveBeenCalledExactlyOnceWith({ restrictedKey: 'rk_live_private' });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith(
      'configured Stripe in live mode\nwebhook https://app.example.test/base/api/webhooks/stripe/tenant-1',
    );
  });
});

describe('redirect commands', () => {
  it('emits one list envelope carrying the page total', async () => {
    await run('--json', 'redirect', 'list', '--search', 'legacy', '--limit', '2', '--offset', '4');

    expect(h.getTenantRedirects).toHaveBeenCalledExactlyOnceWith({
      search: 'legacy',
      limit: 2,
      offset: 4,
    });
    expect(soleJson()).toMatchObject({
      ok: true,
      data: { total: 1, redirects: [{ fromPath: '/legacy/one', origin: 'import' }] },
    });
  });

  it('sends a lesson target and defaults to a permanent redirect', async () => {
    await run('redirect', 'create', '--from', '/legacy/one', '--course', 'course-js', '--lesson', 'lesson-1');

    expect(h.createTenantRedirect).toHaveBeenCalledExactlyOnceWith({
      fromPath: '/legacy/one',
      target: { kind: 'lesson', courseId: 'course-js', lessonId: 'lesson-1' },
      permanent: true,
      locked: false,
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith(
      'created redirect /legacy/one -> /my/courses/course-js (redirect-legacy)',
    );
  });

  it('sends a path target as temporary when asked', async () => {
    await run('--json', 'redirect', 'create', '--from', '/legacy/two', '--path', '/my', '--temporary');

    expect(h.createTenantRedirect).toHaveBeenCalledExactlyOnceWith({
      fromPath: '/legacy/two',
      target: { kind: 'path', path: '/my' },
      permanent: false,
      locked: false,
    });
    expect(soleJson()).toMatchObject({ ok: true, data: { redirect: { id: 'redirect-legacy' } } });
  });

  it('retargets a locked redirect to a lesson anchor', async () => {
    await run(
      '--json', 'redirect', 'update', 'redirect-legacy',
      '--course', 'course-js', '--lesson', 'lesson-1', '--anchor', 'wiring', '--permanent', '--locked',
    );

    expect(h.updateTenantRedirect).toHaveBeenCalledExactlyOnceWith({
      id: 'redirect-legacy',
      target: {
        kind: 'lesson',
        courseId: 'course-js',
        lessonId: 'lesson-1',
        anchor: 'wiring',
      },
      permanent: true,
      locked: true,
    });
    expect(soleJson()).toMatchObject({ ok: true, data: { redirect: { id: 'redirect-legacy' } } });
  });

  it('requires an explicit redirect status when updating a target', async () => {
    await run('--json', 'redirect', 'update', 'redirect-legacy', '--path', '/my', '--locked');

    expect(h.updateTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects both redirect status flags on update', async () => {
    await run(
      '--json', 'redirect', 'update', 'redirect-legacy', '--path', '/my',
      '--permanent', '--temporary', '--locked',
    );

    expect(h.updateTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects both redirect lock flags on update', async () => {
    await run(
      '--json', 'redirect', 'update', 'redirect-legacy', '--path', '/my',
      '--temporary', '--locked', '--unlocked',
    );

    expect(h.updateTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('emits one validation envelope when no target is given', async () => {
    await run('--json', 'redirect', 'create', '--from', '/legacy/three');

    expect(h.createTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('emits one validation envelope for a lesson without its course', async () => {
    await run('--json', 'redirect', 'create', '--from', '/legacy/four', '--lesson', 'lesson-1');

    expect(h.createTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('emits one validation envelope when a path and a course target are combined', async () => {
    await run(
      '--json', 'redirect', 'create',
      '--from', '/legacy/five', '--path', '/offer', '--course', 'course-js',
    );

    expect(h.createTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('emits one delete envelope', async () => {
    await run('--json', 'redirect', 'delete', 'redirect-legacy');

    expect(h.deleteTenantRedirect).toHaveBeenCalledExactlyOnceWith({ id: 'redirect-legacy' });
    expect(soleJson()).toEqual({ ok: true, data: { id: 'redirect-legacy' } });
  });

  it('reports an upstream conflict with the taxonomy exit code', async () => {
    h.createTenantRedirect.mockResolvedValue(err(appError('conflict', 'Another redirect already answers "/legacy/one"')));

    await run('--json', 'redirect', 'create', '--from', '/legacy/one', '--path', '/my');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(process.exitCode).toBe(6);
  });
});

describe('domain show', () => {
  const routing = {
    tenantHost: 'workspace.example.org',
    customDomainTarget: 'routing.example.org',
    apexDomainsSupported: false,
    canAddCustomDomain: true,
    customDomains: [{
      domain: 'courses.example.org', verified: false, status: 'pending-dns',
      lastCheckedAt: null, lastError: null,
      records: [
        { type: 'CNAME', name: 'courses.example.org', value: 'routing.example.org', purpose: 'routing', status: 'pending' },
        { type: 'TXT', name: '_vercel.courses.example.org', value: 'challenge', purpose: 'ownership', status: 'verified' },
      ],
    }],
  };

  it('preserves records and statuses in the JSON envelope', async () => {
    h.getTenantRouting.mockResolvedValue(ok({ routing }));
    await run('--json', 'domain', 'show');
    expect(soleJson()).toEqual({ ok: true, data: { routing } });
  });

  it('prints every record and its status', async () => {
    h.getTenantRouting.mockResolvedValue(ok({ routing }));
    await run('domain', 'show');
    expect(logSpy).toHaveBeenCalledWith([
      'workspace.example.org',
      'courses.example.org\tpending-dns',
      'CNAME\tcourses.example.org\trouting.example.org\tpending',
      'TXT\t_vercel.courses.example.org\tchallenge\tverified',
    ].join('\n'));
  });
});

describe('course sales URL commands', () => {
  it('includes the sales URL in course show', async () => {
    const course = { id: 'course-1', name: 'Course', description: 'Learn the basics', salesUrl: 'https://courses.example.org/offer' };
    h.listCourses.mockResolvedValue(ok({ courses: [course] }));
    await run('--json', 'course', 'show', 'course-1');
    expect(soleJson()).toEqual({ ok: true, data: { course } });
  });

  it.each([
    ['https://courses.example.org/offer', 'https://courses.example.org/offer'],
    ['', null],
  ])('updates or clears the sales URL using %s', async (input, salesUrl) => {
    h.updateCourse.mockResolvedValue(ok({ course: { id: 'course-1', name: 'Course', salesUrl } }));
    await run('--json', 'course', 'update', 'course-1', '--sales-url', input ?? '');
    expect(h.updateCourse).toHaveBeenCalledExactlyOnceWith({ id: 'course-1', salesUrl });
    expect(soleJson()).toMatchObject({ ok: true, data: { course: { salesUrl } } });
  });

  it('rejects a non-HTTPS sales URL before calling the API', async () => {
    await run('--json', 'course', 'update', 'course-1', '--sales-url', 'http://courses.example.org/offer');
    expect(h.updateCourse).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('lesson preview commands', () => {
  const previewLesson = (id: string, isPreview = false) => ({
    id, name: `Lesson ${id}`, isPreview, contents: [],
  });
  const previewModule = (id: string, chapters: string[][], courseIds = ['course-1']) => ({
    id, name: `Module ${id}`, courseIds, createdAt: '2026-09-01T00:00:00.000Z',
    chapters: chapters.map((ids, index) => ({ id: `chapter-${index}`, name: `Chapter ${index}`,
      contents: ids.map((lessonId) => ({ id: lessonId, name: lessonId, lessonId })),
    })),
  });
  const select = (...args: string[]) => run('--json', 'lesson', 'preview', 'set', '--course', 'course-1', ...args);

  beforeEach(() => {
    h.listCourses.mockResolvedValue(ok({ courses: [{ id: 'course-1', moduleOrder: ['module-2', 'module-1'] }] }));
    h.listModules.mockResolvedValue(ok({ modules: [
      previewModule('module-1', [[], ['one', 'two'], ['three']]),
      previewModule('module-2', [['two', 'four', 'two']]),
      previewModule('empty', [[]]),
      previewModule('unrelated', [['outside']], ['course-2']),
    ] }));
    h.listLessons.mockResolvedValue(ok({ lessons: [
      previewLesson('one'), previewLesson('two', true), previewLesson('three', true),
      previewLesson('four'), previewLesson('outside', true),
    ] }));
    h.updateLesson.mockImplementation((input: { id: string; isPreview?: boolean }) =>
      Promise.resolve(ok({ lesson: previewLesson(input.id, input.isPreview) })));
  });

  it.each([
    { flags: ['--preview'], payload: { id: 'one', isPreview: false }, expected: { id: 'one', isPreview: true } },
    { flags: ['--no-preview'], payload: { id: 'one', isPreview: true }, expected: { id: 'one', isPreview: false } },
    { flags: [], payload: { id: 'one', name: 'Renamed' }, expected: { id: 'one', name: 'Renamed' } },
    { flags: [], payload: { id: 'one', isPreview: true }, expected: { id: 'one', isPreview: true } },
  ])('updates a lesson with $flags and preserves omitted preview state', async ({ flags, payload, expected }) => {
    await run('--json', 'lesson', 'update', '--data', JSON.stringify(payload), ...flags);
    expect(h.updateLesson).toHaveBeenCalledExactlyOnceWith(expected);
    expect(soleJson()).toMatchObject({ ok: true, data: { lesson: { id: 'one' } } });
    expect(process.exitCode).toBe(0);
  });

  it('rejects an invalid update before calling the client', async () => {
    await run('--json', 'lesson', 'update', '--data', '{}', '--preview');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.updateLesson).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('preserves update error taxonomy', async () => {
    h.updateLesson.mockResolvedValue(err(appError('forbidden', 'Staff only')));
    await run('--json', 'lesson', 'update', '--data', '{"id":"one"}', '--preview');
    expect(soleJson()).toEqual({ ok: false, error: { code: 'forbidden', message: 'Staff only' } });
    expect(process.exitCode).toBe(4);
  });

  it('selects the first lesson across chapters per module and disables other previews', async () => {
    await select('--first-per-module');
    expect(h.updateLesson.mock.calls).toEqual([[{ id: 'one', isPreview: true }], [{ id: 'three', isPreview: false }]]);
    expect(soleJson()).toMatchObject({ ok: true, data: {
      changedLessonCount: 2, updatedLessonIds: ['one', 'three'],
      lessons: [
        { moduleId: 'module-2', lessonId: 'two', isPreview: true },
        { moduleId: 'module-2', lessonId: 'four', isPreview: false },
        { moduleId: 'module-1', lessonId: 'one', isPreview: true },
        { moduleId: 'module-1', lessonId: 'two', isPreview: true },
        { moduleId: 'module-1', lessonId: 'three', isPreview: false },
      ],
    } });
  });

  it('replaces the selection with trimmed and deduplicated explicit IDs', async () => {
    await select('--lessons', ' four, four ');
    expect(h.updateLesson.mock.calls).toEqual([
      [{ id: 'two', isPreview: false }], [{ id: 'four', isPreview: true }], [{ id: 'three', isPreview: false }],
    ]);
    expect(soleJson()).toMatchObject({ ok: true, data: { changedLessonCount: 3 } });
  });

  it.each([
    { mode: '--all', updates: [{ id: 'four', isPreview: true }, { id: 'one', isPreview: true }] },
    { mode: '--none', updates: [{ id: 'two', isPreview: false }, { id: 'three', isPreview: false }] },
  ])('applies $mode once per changed lesson', async ({ mode, updates }) => {
    await select(mode);
    expect(h.updateLesson.mock.calls).toEqual(updates.map((update) => [update]));
    expect(soleJson()).toMatchObject({ ok: true, data: { changedLessonCount: 2 } });
  });

  it('does not write during a dry run and emits one JSON plan', async () => {
    await select('--all', '--dry-run');
    expect(h.updateLesson).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: true, data: { dryRun: true, changedLessonCount: 2, updatedLessonIds: [] } });
  });

  it('prints the human table before writing', async () => {
    h.updateLesson.mockImplementation((input: { id: string; isPreview?: boolean }) => {
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Module\tLesson\tCurrent -> new'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Lesson four (four)\tfalse -> true'));
      return Promise.resolve(ok({ lesson: previewLesson(input.id, input.isPreview) }));
    });
    await run('lesson', 'preview', 'set', '--course', 'course-1', '--all');
    expect(logSpy).toHaveBeenLastCalledWith('updated 2 lesson(s)');
    expect(h.updateLesson).toHaveBeenCalledTimes(2);
  });

  it('is idempotent when the command is repeated', async () => {
    const lessons = [previewLesson('one'), previewLesson('two'), previewLesson('three'), previewLesson('four')];
    h.listLessons.mockResolvedValue(ok({ lessons }));
    h.updateLesson.mockImplementation((input: { id: string; isPreview?: boolean }) => {
      const lesson = lessons.find((item) => item.id === input.id);
      if (lesson === undefined) throw new Error('Unexpected lesson');
      lesson.isPreview = input.isPreview ?? false;
      return Promise.resolve(ok({ lesson }));
    });
    await select('--all');
    expect(h.updateLesson).toHaveBeenCalledTimes(4);
    h.updateLesson.mockClear();
    logSpy.mockClear();
    await select('--all');
    expect(h.updateLesson).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: true, data: { changedLessonCount: 0, updatedLessonIds: [] } });
  });

  it.each([[], ['--all', '--none'], ['--first-per-module', '--lessons', 'one'], ['--lessons', 'one,,two']])(
    'rejects invalid selection %j before fetching', async (...args) => {
      await select(...args);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(h.listCourses).not.toHaveBeenCalled();
      expect(h.updateLesson).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
    },
  );

  it('rejects an ID outside the course before making changes', async () => {
    await select('--lessons', 'one,outside');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('outside') } });
    expect(h.updateLesson).not.toHaveBeenCalled();
  });

  it('rejects broken lesson references before making changes', async () => {
    h.listLessons.mockResolvedValue(ok({ lessons: [] }));
    await select('--all');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.updateLesson).not.toHaveBeenCalled();
  });

  it('handles empty courses without writes', async () => {
    h.listModules.mockResolvedValue(ok({ modules: [] }));
    await select('--first-per-module');
    expect(soleJson()).toMatchObject({ ok: true, data: { lessons: [], changedLessonCount: 0 } });
    expect(h.updateLesson).not.toHaveBeenCalled();
  });

  it('reports a missing course', async () => {
    h.listCourses.mockResolvedValue(ok({ courses: [] }));
    await select('--none');
    expect(soleJson()).toEqual({ ok: false, error: { code: 'not_found', message: 'Course not found' } });
    expect(process.exitCode).toBe(5);
    expect(h.listModules).not.toHaveBeenCalled();
  });

  it.each(['listCourses', 'listModules', 'listLessons'] as const)('propagates %s failures without writes', async (method) => {
    h[method].mockResolvedValue(err(appError('unauthorized', 'Sign in')));
    await select('--all');
    expect(soleJson()).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } });
    expect(process.exitCode).toBe(3);
    expect(h.updateLesson).not.toHaveBeenCalled();
  });

  it('stops after a write failure and reports completed updates in one error envelope', async () => {
    h.updateLesson.mockResolvedValueOnce(ok({ lesson: previewLesson('two') }))
      .mockResolvedValueOnce(err(appError('conflict', 'Concurrent update')));
    await select('--lessons', 'four');
    expect(h.updateLesson).toHaveBeenCalledTimes(2);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'conflict',
      details: { failedLessonId: 'four', updatedLessonIds: ['two'] },
    } });
    expect(process.exitCode).toBe(6);
  });
});

describe('tenant organization unlink', () => {
  it('unlinks the active tenant', async () => {
    h.unlinkTenantFromOrganization.mockReset().mockResolvedValue(ok({
      workspace: { id: 'tenant-acme', slug: 'acme', name: 'Acme', status: 'active' }, changed: true,
    }));
    await run('tenant', 'organization', 'unlink');
    expect(h.unlinkTenantFromOrganization).toHaveBeenCalledExactlyOnceWith();
    expect(logSpy).toHaveBeenCalledWith('unlinked: Acme (acme)');
  });

  it('reports a refusal with the forbidden exit code', async () => {
    h.unlinkTenantFromOrganization.mockReset().mockResolvedValue(err(appError('forbidden', 'Direct owner required')));
    await run('--json', 'tenant', 'organization', 'unlink');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(4);
  });
});

describe('tenant accent settings', () => {
  it('returns the forbidden exit code when a member reads staff settings', async () => {
    h.getTenantSettings.mockResolvedValue(err(appError('forbidden', 'Staff role is required')));
    await run('--json', 'tenant', 'settings');
    expect(h.getTenantSettings).toHaveBeenCalledExactlyOnceWith();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(4);
  });

  it('sends both accents and clears only the light override', async () => {
    h.updateTenantSettings.mockResolvedValue(ok({ settings: { accentColor: '#F5C842', accentLight: '#786000' } }));
    await run('--json', 'tenant', 'settings-set', '--accent-color', '#F5C842', '--accent-light', '#786000');
    expect(h.updateTenantSettings).toHaveBeenLastCalledWith({ accentColor: '#F5C842', accentLight: '#786000' });
    await run('--json', 'tenant', 'settings-set', '--clear-accent-light');
    expect(h.updateTenantSettings).toHaveBeenLastCalledWith({ accentLight: null });
  });

  it('shows both accents in settings output', async () => {
    h.getTenantSettings.mockResolvedValue(ok({ settings: { accentColor: '#F5C842', accentLight: '#786000' } }));
    await run('tenant', 'settings');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('dark accent: #F5C842'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('light accent: #786000'));
  });
});


it('passes visibility through product create and update', async () => {
  await run('--json', 'product', 'create', '--title', 'Course', '--price-cents', '0', '--visibility', 'unlisted');
  expect(h.createProduct).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 0, visibility: 'unlisted' }));
  await run('--json', 'product', 'update', 'product-1', '--visibility', 'listed');
  expect(h.updateProduct).toHaveBeenCalledWith({ id: 'product-1', visibility: 'listed' });
});

it('passes the sales channel through product create and update and names a limited product in text output', async () => {
  const limited = { id: 'product-1', title: 'Course', salesChannel: 'sales_links_only' };
  h.createProduct.mockResolvedValue(ok({ product: limited }));
  h.updateProduct.mockResolvedValue(ok({ product: { ...limited, salesChannel: 'any' } }));
  await run('product', 'create', '--title', 'Course', '--price-cents', '0', '--sales-channel', 'sales_links_only');
  expect(h.createProduct).toHaveBeenCalledWith(expect.objectContaining({ salesChannel: 'sales_links_only' }));
  expect(logSpy).toHaveBeenCalledWith('created: Course  [sales links only] (product-)');
  await run('product', 'update', 'product-1', '--sales-channel', 'any');
  expect(h.updateProduct).toHaveBeenCalledWith({ id: 'product-1', salesChannel: 'any' });
  expect(logSpy).toHaveBeenCalledWith('updated: Course (product-)');
});

it('rejects an unknown sales channel before invoking the product client', async () => {
  await run('--json', 'product', 'update', 'product-1', '--sales-channel', 'links');
  expect(h.updateProduct).not.toHaveBeenCalled();
});

it('rejects invalid visibility before invoking the product client', async () => {
  await run('--json', 'product', 'update', 'product-1', '--visibility', 'private');
  expect(h.updateProduct).not.toHaveBeenCalled();
});

describe('post purge', () => {
  it('emits one purge envelope', async () => {
    await run('--json', 'post', 'purge', '--id', 'post-1');
    expect(h.purgePost).toHaveBeenCalledExactlyOnceWith({ id: 'post-1' });
    expect(soleJson()).toEqual({ ok: true, data: { id: 'post-1' } });
    expect(process.exitCode).toBe(0);
  });

  it('maps author denial to the forbidden exit code', async () => {
    h.purgePost.mockResolvedValue(err(appError('forbidden', 'Staff only')));
    await run('--json', 'post', 'purge', '--id', 'post-1');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(4);
  });

  it('requires a post id', async () => {
    await run('--json', 'post', 'purge');
    expect(h.purgePost).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});


describe('activity report CLI parsing', () => {
  const range = ['--from', '1998-08-01T00:00:00Z', '--to', '1998-09-01T00:00:00Z'];
  afterEach(() => vi.unstubAllEnvs());
  it('passes the API key and normalized summary range', async () => {
    vi.stubEnv('TOGETHER_API_KEY', 'report-secret');
    h.activitySummary.mockReset().mockResolvedValue(ok({ days: [], totals: { membersTotal: 0, membersActive: 0 } }));
    await run('reports', 'activity-summary', ...range, '--json');
    expect(h.activitySummary).toHaveBeenCalledWith({ from: '1998-08-01T00:00:00.000Z', to: '1998-09-01T00:00:00.000Z' }, { apiKey: 'report-secret' });
    expect(soleJson()).toMatchObject({ ok: true, data: { days: [] } });
  });
  it('collects repeated exclusions and follows pagination for CSV', async () => {
    vi.stubEnv('TOGETHER_API_KEY', 'report-secret');
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    h.memberActivity.mockReset().mockResolvedValueOnce(ok({ members: [], nextCursor: 'one' })).mockResolvedValueOnce(ok({ members: [], nextCursor: null }));
    await run('reports', 'member-activity', ...range, '--pivot', '1998-08-15T00:00:00Z', '--exclude', '%@example.test', '--exclude', 'test_%', '--csv');
    expect(h.memberActivity).toHaveBeenCalledTimes(2);
    expect(h.memberActivity).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'one', excludeEmailPatterns: '%@example.test,test_%', limit: 500 }), { apiKey: 'report-secret' });
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"memberId","displayName","email"'));
    output.mockRestore();
  });
  it('rejects invalid dates and conflicting output modes', async () => {
    vi.stubEnv('TOGETHER_API_KEY', 'report-secret');
    h.memberActivity.mockReset();
    await run('reports', 'member-activity', ...range, '--pivot', 'invalid', '--json');
    expect(h.memberActivity).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('rejects simultaneous CSV and JSON output', async () => {
    vi.stubEnv('TOGETHER_API_KEY', 'report-secret');
    h.memberActivity.mockReset();
    await run('reports', 'member-activity', ...range, '--pivot', range[1] ?? '', '--json', '--csv');
    expect(h.memberActivity).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('accepts api-keys create --scope report:read without expiry', async () => {
    h.createApiKey.mockReset().mockResolvedValue(ok({ apiKey: { id: 'key', name: 'Reporting' }, secret: 'secret' }));
    await run('api-keys', 'create', 'Reporting', '--scope', 'report:read', '--json');
    expect(h.createApiKey).toHaveBeenCalledWith({ name: 'Reporting', scopes: ['report:read'] });
  });
  it('creates a shop management key under the shop-management group with scopes and expiry', async () => {
    h.createShopManagementKey.mockReset().mockResolvedValue(ok({ apiKey: { id: 'key', name: 'Shop' }, secret: 'shop-secret' }));
    await run(
      'api-keys', 'shop-management', 'create', 'Shop', '--scope', 'shop:catalog:read', 'shop:orders:read',
      '--expires-at', '1998-08-08T00:00:00.000Z', '--json',
    );
    expect(h.createShopManagementKey).toHaveBeenCalledWith({
      name: 'Shop', scopes: ['shop:catalog:read', 'shop:orders:read'], expiresAt: '1998-08-08T00:00:00.000Z',
    });
    expect(h.createApiKey).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Shop' }));
  });
  it.each([
    ['without scopes', ['--expires-at', '1998-08-08T00:00:00.000Z']],
    ['without an expiry', ['--scope', 'shop:catalog:read']],
    ['with a legacy scope', ['--scope', 'marketing', '--expires-at', '1998-08-08T00:00:00.000Z']],
  ])('refuses a shop management key %s before calling the API', async (_label, options) => {
    h.createShopManagementKey.mockReset();
    await run('--json', 'api-key', 'shop-management', 'create', 'Shop', ...options);
    expect(h.createShopManagementKey).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('lists and revokes shop management keys through the shop-management group', async () => {
    h.listShopManagementKeys.mockReset().mockResolvedValue(ok({ apiKeys: [{
      id: 'shop-key', tenantId: 'acme', name: 'Shop', scopes: ['shop:catalog:read'], mode: 'direct', issuedByUserId: 'owner-1',
      createdAt: '1998-08-01T00:00:00.000Z', expiresAt: '1998-08-08T00:00:00.000Z', revokedAt: null,
    }] }));
    await run('api-key', 'shop-management', 'list');
    expect(logSpy).toHaveBeenCalledWith('Shop\tactive\texpires 1998-08-08T00:00:00.000Z\tshop:catalog:read\t(shop-key)\tdirect');
    h.revokeShopManagementKey.mockReset().mockResolvedValue(ok({ apiKey: { id: 'shop-key', name: 'Shop' } }));
    await run('--json', 'api-key', 'shop-management', 'revoke', 'shop-key');
    expect(h.revokeShopManagementKey).toHaveBeenCalledWith({ id: 'shop-key' });
  });
  it('refuses api-key shop-management purge without --yes before calling the API', async () => {
    h.purgeShopManagementKeys.mockReset();
    await run('--json', 'api-key', 'shop-management', 'purge');
    expect(h.purgeShopManagementKeys).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Purging shop management keys requires --yes' } });
    expect(process.exitCode).toBe(2);
  });
  it('purges the shop management keys with --yes and reports the count', async () => {
    h.purgeShopManagementKeys.mockReset().mockResolvedValue(ok({ purged: 3 }));
    await run('--json', 'api-key', 'shop-management', 'purge', '--yes');
    expect(h.purgeShopManagementKeys).toHaveBeenCalledOnce();
    expect(soleJson()).toEqual({ ok: true, data: { purged: 3 } });
  });
  it('lists the shop management key history for one key with paging options', async () => {
    const event = {
      id: 'event-1', tenantId: 'acme', apiKeyId: 'shop-key', kind: 'request', actorUserId: 'owner-1', method: 'POST',
      route: '/api/m2m/shop/products/update', resourceId: 'product-1', at: '1998-08-08T00:00:00.000Z',
    };
    h.listShopManagementKeyEvents.mockReset().mockResolvedValue(ok({ events: [event], nextCursor: 'event-1' }));
    await run('api-key', 'shop-management', 'events', '--key', 'shop-key', '--limit', '1', '--cursor', 'event-0');
    expect(h.listShopManagementKeyEvents).toHaveBeenCalledWith({ keyId: 'shop-key', cursor: 'event-0', limit: 1 });
    expect(logSpy).toHaveBeenCalledWith(
      '1998-08-08T00:00:00.000Z\trequest\tshop-key\towner-1\tPOST /api/m2m/shop/products/update\tproduct-1\nnext: --cursor event-1',
    );
  });
  it('lists the whole workspace shop management key history without a key filter', async () => {
    h.listShopManagementKeyEvents.mockReset().mockResolvedValue(ok({ events: [], nextCursor: null }));
    await run('--json', 'api-key', 'shop-management', 'events');
    expect(h.listShopManagementKeyEvents).toHaveBeenCalledWith({});
    expect(soleJson()).toEqual({ ok: true, data: { events: [], nextCursor: null } });
  });
  it('creates a propose-mode shop management key with --mode propose and refuses an unknown mode', async () => {
    h.createShopManagementKey.mockReset().mockResolvedValue(ok({ apiKey: { id: 'key', name: 'Agent', mode: 'propose' }, secret: 'shop-secret' }));
    await run('api-key', 'shop-management', 'create', 'Agent', '--scope', 'shop:catalog:read', 'shop:catalog:write', '--expires-at', '1998-08-08T00:00:00.000Z', '--mode', 'propose');
    expect(h.createShopManagementKey).toHaveBeenCalledWith({
      name: 'Agent', scopes: ['shop:catalog:read', 'shop:catalog:write'], expiresAt: '1998-08-08T00:00:00.000Z', mode: 'propose',
    });
    expect(logSpy).toHaveBeenCalledWith('created propose-mode shop management key Agent (key)\nsecret (shown once): shop-secret');
    h.createShopManagementKey.mockReset();
    logSpy.mockClear();
    await run('--json', 'api-key', 'shop-management', 'create', 'Agent', '--scope', 'shop:catalog:write', '--expires-at', '1998-08-08T00:00:00.000Z', '--mode', 'draft');
    expect(h.createShopManagementKey).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('creates a purchase-smoke key with --purpose and no scopes', async () => {
    h.createShopManagementKey.mockReset().mockResolvedValue(ok({ apiKey: { id: 'key', name: 'Purchase smoke', mode: 'direct' }, secret: 'shop-secret' }));
    await run('--json', 'api-key', 'shop-management', 'create', 'Purchase', 'smoke', '--purpose', 'purchase-smoke', '--expires-at', '1998-08-08T00:00:00.000Z');
    expect(h.createShopManagementKey).toHaveBeenCalledWith({
      name: 'Purchase smoke', scopes: [], purpose: 'purchase-smoke', expiresAt: '1998-08-08T00:00:00.000Z',
    });
  });
  it.each([
    ['with a scope', ['--purpose', 'purchase-smoke', '--scope', 'shop:catalog:read', '--expires-at', '1998-08-08T00:00:00.000Z']],
    ['with a mode', ['--purpose', 'purchase-smoke', '--mode', 'direct', '--expires-at', '1998-08-08T00:00:00.000Z']],
    ['with an unknown purpose', ['--purpose', 'checkout', '--expires-at', '1998-08-08T00:00:00.000Z']],
    ['without an expiry', ['--purpose', 'purchase-smoke']],
  ])('refuses a purchase-smoke key %s before calling the API', async (_label, options) => {
    h.createShopManagementKey.mockReset();
    await run('--json', 'api-key', 'shop-management', 'create', 'Shop', ...options);
    expect(h.createShopManagementKey).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('keeps the direct-mode create confirmation line unchanged', async () => {
    h.createShopManagementKey.mockReset().mockResolvedValue(ok({ apiKey: { id: 'key', name: 'Backend', mode: 'direct' }, secret: 'shop-secret' }));
    await run('api-key', 'shop-management', 'create', 'Backend', '--scope', 'shop:catalog:write', '--expires-at', '1998-08-08T00:00:00.000Z');
    expect(h.createShopManagementKey).toHaveBeenCalledWith({ name: 'Backend', scopes: ['shop:catalog:write'], expiresAt: '1998-08-08T00:00:00.000Z' });
    expect(logSpy).toHaveBeenCalledWith('created shop management key Backend (key)\nsecret (shown once): shop-secret');
  });
  it('keeps the legacy api-key create free of shop options', async () => {
    h.createApiKey.mockReset();
    await run('api-keys', 'create', 'Shop', '--kind', 'shop_management', '--json');
    expect(h.createApiKey).not.toHaveBeenCalled();
  });
});

describe('marketing signup form commands', () => {
  it('lists forms in one JSON envelope', async () => {
    await run('--json', 'marketing', 'forms', 'list');
    expect(h.listMarketingSignupForms).toHaveBeenCalledExactlyOnceWith({});
    expect(soleJson()).toEqual({ ok: true, data: { forms: [] } });
  });
  it('passes the slug to show and preserves the not-found exit code', async () => {
    await run('--json', 'marketing', 'forms', 'show', 'newsletter');
    expect(h.getMarketingSignupForm).toHaveBeenCalledExactlyOnceWith({ slug: 'newsletter' });
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(process.exitCode).toBe(5);
  });
  it('validates form JSON and sends the parsed creation input', async () => {
    const input = { slug: 'newsletter', name: 'Newsletter', consentDefinitionId: 'updates', successText: { en: 'Thank you', pl: 'Thank you' } };
    await run('--json', 'marketing', 'forms', 'create', '--input', JSON.stringify(input));
    expect(h.createMarketingSignupForm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(input));
    expect(soleJson()).toMatchObject({ ok: true, data: { form: { id: 'form-newsletter' } } });
  });
  it('rejects malformed JSON without sending it or echoing its content', async () => {
    await run('--json', 'marketing', 'forms', 'create', '--input', '{private-input');
    expect(h.createMarketingSignupForm).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(logSpy.mock.calls[0]?.[0]).not.toContain('private-input');
    expect(process.exitCode).toBe(2);
  });
});


const operatorReadiness = {
  tenantExists: true, ownerGrantPresent: true, storageConfigured: false, lastProbeOk: false,
  lastProbeAt: null, stripeConfigured: false, mode: null, webhookEndpointRegistered: false,
  legalUrlsSet: false, publishedProducts: 0,
};
const operatorProvisionArgs = ['operator', 'tenant', 'provision', '--slug', 'acme', '--name', 'Acme', '--owner-email', 'owner@example.test'];

describe('operator tenant commands', () => {
  beforeEach(() => {
    h.provisionOperatorTenant.mockReset().mockResolvedValue(ok({
      tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme' }, created: true, ownerUserId: 'owner-1', readiness: operatorReadiness,
    }));
    h.getOperatorTenantReadiness.mockReset().mockResolvedValue(ok(operatorReadiness));
    vi.stubEnv('OPERATOR_SECRET', 'hidden-operator-secret');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('takes its secret from the environment and emits one JSON envelope', async () => {
    await run('--json', ...operatorProvisionArgs, '--language', 'pl');
    expect(h.provisionOperatorTenant).toHaveBeenCalledExactlyOnceWith({
      slug: 'acme', name: 'Acme', ownerEmail: 'owner@example.test', defaultLanguage: 'pl',
    }, 'hidden-operator-secret');
    expect(soleJson()).toMatchObject({ ok: true, data: { created: true, readiness: operatorReadiness } });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('hidden-operator-secret');
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it('prints the readiness checklist', async () => {
    await run('operator', 'tenant', 'readiness', '--slug', 'acme');
    expect(h.getOperatorTenantReadiness).toHaveBeenCalledExactlyOnceWith('acme', 'hidden-operator-secret');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ownerGrantPresent=true\nstorageConfigured=false'));
  });

  it('refuses missing credentials before calling the client', async () => {
    vi.stubEnv('OPERATOR_SECRET', '');
    await run('--json', ...operatorProvisionArgs);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: 'OPERATOR_SECRET is required' } });
    expect(h.provisionOperatorTenant).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('rejects a secret flag', async () => {
    await run('--json', ...operatorProvisionArgs, '--secret', 'hidden-operator-secret');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.provisionOperatorTenant).not.toHaveBeenCalled();
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('hidden-operator-secret');
  });

  it('preserves unauthorized exit code 3', async () => {
    h.provisionOperatorTenant.mockResolvedValue(err(appError('unauthorized', 'Invalid operator secret')));
    await run('--json', ...operatorProvisionArgs);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(process.exitCode).toBe(3);
  });

  it('redacts unexpected exception details', async () => {
    h.provisionOperatorTenant.mockRejectedValue(new Error('hidden-operator-secret'));
    await run('--json', ...operatorProvisionArgs);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'internal', message: 'Operator request failed' } });
    expect(process.exitCode).toBe(10);
  });

  it('reports redirect refusal as a clear operator request failure', async () => {
    h.provisionOperatorTenant.mockResolvedValue(err(appError(
      'internal',
      'Operator request refused a redirect',
    )));
    await run('--json', ...operatorProvisionArgs);
    expect(soleJson()).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'Operator request refused a redirect' },
    });
    expect(process.exitCode).toBe(10);
  });
});


describe('survey commands', () => {
  it('lists surveys using one standard JSON envelope', async () => {
    await run('--json', 'survey', 'list');
    expect(h.listSurveys).toHaveBeenCalledExactlyOnceWith({});
    expect(soleJson()).toEqual({ ok: true, data: { surveys: [] } });
  });

  it('deletes the identified survey after confirmation', async () => {
    await run('--json', 'survey', 'delete', 'survey-one', '--confirm');
    expect(h.deleteSurvey).toHaveBeenCalledExactlyOnceWith({ id: 'survey-one' });
    expect(soleJson()).toEqual({ ok: true, data: { deleted: true } });
  });

  it('rejects malformed create input before transport', async () => {
    await run('--json', 'survey', 'create', '--input', '{private-input');
    expect(h.createSurvey).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(logSpy.mock.calls[0]?.[0]).not.toContain('private-input');
    expect(process.exitCode).toBe(2);
  });
});

describe('order verification commands', () => {
  it('verifies a pasted token or order number in one JSON envelope', async () => {
    await run('--json', 'orders', 'verify', 'order-number');
    expect(h.verifyOrder).toHaveBeenCalledExactlyOnceWith({ reference: 'order-number' });
    expect(soleJson()).toEqual({ ok: true, data: { order: { id: 'order-number', status: 'paid' } } });
  });
  it('records collection of the identified physical line', async () => {
    await run('--json', 'orders', 'issue', 'order-number', 'physical');
    expect(h.issueOrderLine).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number', productId: 'physical' });
    expect(soleJson()).toEqual({ ok: true, data: { order: { id: 'order-number', lines: [{ productId: 'physical', issuedCount: 1 }] } } });
  });
  it('hands over several units of a line with --count', async () => {
    await run('--json', 'orders', 'issue', 'order-number', 'physical', '--count', '2');
    expect(h.issueOrderLine).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number', productId: 'physical', count: 2 });
  });
  it('rejects a count that is not a positive integer before calling the API', async () => {
    await run('--json', 'orders', 'issue', 'order-number', 'physical', '--count', '0');
    expect(h.issueOrderLine).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('preserves the forbidden exit code for an unauthorized issue', async () => {
    h.issueOrderLine.mockResolvedValue(err(appError('forbidden', 'order:write is not permitted')));
    await run('--json', 'orders', 'issue', 'order-number', 'physical');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(4);
  });
});

describe('orders rejected-payments command', () => {
  const rejection = {
    tenantId: 'workspace', eventId: 'evt_1', eventType: 'checkout.session.completed', checkoutSessionId: 'cs_1',
    reasonCode: 'validation', reasonMessage: 'Checkout snapshot not found', firstSeenAt: '2026-11-20T10:00:00.000Z',
    lastSeenAt: '2026-11-20T12:00:00.000Z', attempts: 3, resolvedAt: null,
  };

  it('emits the unresolved records in one JSON envelope', async () => {
    h.listPaymentEventRejections.mockResolvedValue(ok({ rejections: [rejection] }));
    await run('--json', 'orders', 'rejected-payments');
    expect(h.listPaymentEventRejections).toHaveBeenCalledExactlyOnceWith({});
    expect(soleJson()).toEqual({ ok: true, data: { rejections: [rejection] } });
  });

  it('prints one line per record with its reason, sightings and ids', async () => {
    h.listPaymentEventRejections.mockResolvedValue(ok({ rejections: [rejection] }));
    await run('orders', 'rejected-payments', '--limit', '5');
    expect(h.listPaymentEventRejections).toHaveBeenCalledExactlyOnceWith({ limit: 5 });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('2026-11-20T10:00:00.000Z\t2026-11-20T12:00:00.000Z\t3 attempts\tvalidation: Checkout snapshot not found\tevt_1\tcs_1');
  });

  it('says so when every payment was recorded', async () => {
    await run('orders', 'rejected-payments');
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('no payments that could not be recorded');
  });

  it('rejects a limit that is not a positive integer before calling the API', async () => {
    await run('--json', 'orders', 'rejected-payments', '--limit', '0');
    expect(h.listPaymentEventRejections).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('preserves the forbidden exit code for a member', async () => {
    h.listPaymentEventRejections.mockResolvedValue(err(appError('forbidden', 'order:reconcile is not permitted')));
    await run('--json', 'orders', 'rejected-payments');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(4);
  });
});

describe('consumer sales CLI parity', () => {
  it('emits one summary envelope and forwards the calendar range', async () => {
    await run('--json', 'orders', 'consumer-sales-summary', '--from', '2026-09-01', '--to', '2026-09-30');
    expect(h.consumerSalesSummary).toHaveBeenCalledExactlyOnceWith({ from: '2026-09-01', to: '2026-09-30' });
    expect(soleJson()).toEqual({ ok: true, data: { totals: { grossCents: 105 } } });
  });
  it('exports CSV through the matching client method', async () => {
    await run('orders', 'consumer-sales-summary', '--from', '2026-09-01', '--to', '2026-09-30', '--format', 'csv');
    expect(h.exportConsumerSales).toHaveBeenCalledExactlyOnceWith({ from: '2026-09-01', to: '2026-09-30' });
    expect(logSpy).toHaveBeenCalledWith('rate,gross_cents\n5,105');
  });
  it('rejects reversed dates before calling either transport', async () => {
    await run('--json', 'orders', 'consumer-sales-summary', '--from', '2026-09-30', '--to', '2026-09-01');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Invalid consumer sales query', details: { formErrors: ['Date range is reversed'], fieldErrors: {} } } });
    expect(h.consumerSalesSummary).not.toHaveBeenCalled();
    expect(h.exportConsumerSales).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });
  it('includes flattened field issues for an invalid calendar day', async () => {
    await run('--json', 'orders', 'consumer-sales-summary', '--from', '2026-09-31', '--to', '2026-10-01');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Invalid consumer sales query', details: { formErrors: [], fieldErrors: { from: ['Invalid calendar day'] } } } });
    expect(h.consumerSalesSummary).not.toHaveBeenCalled();
    expect(h.exportConsumerSales).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });
  it('preserves forbidden taxonomy for the export', async () => {
    h.exportConsumerSales.mockResolvedValue(err(appError('forbidden', 'Export is not permitted')));
    await run('--json', 'orders', 'consumer-sales-summary', '--from', '2026-09-01', '--to', '2026-09-30', '--format', 'csv');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(4);
  });
});

it.each(['live', 'test'] as const)('emits the %s Stripe permission check envelope', async (mode) => {
  h.probeStripePermissions.mockReset();
  const result = { mode, allOk: false, checkedAt: '2026-10-10T12:00:00.000Z', checks: [
    { resource: 'Coupons', permission: 'write', status: 'missing', detail: 'Coupon write denied' },
  ] };
  h.probeStripePermissions.mockResolvedValue(ok(result));
  await run('--json', 'stripe', 'probe-permissions', '--mode', mode);
  expect(h.probeStripePermissions).toHaveBeenCalledExactlyOnceWith({ mode });
  expect(soleJson()).toEqual({ ok: true, data: result });
});

it('prints a missing refund permission with its detail and exits successfully', async () => {
  h.probeStripePermissions.mockReset();
  const detail = 'This key needs more permissions';
  h.probeStripePermissions.mockResolvedValue(ok({ mode: 'live', allOk: false, checkedAt: '2026-10-10T12:00:00.000Z', checks: [
    { resource: 'Checkout Sessions', permission: 'write', status: 'ok' },
    { resource: 'Charges and Refunds', permission: 'write', status: 'missing', detail },
  ] }));
  await run('stripe', 'probe-permissions', '--mode', 'live');
  expect(logSpy).toHaveBeenCalledExactlyOnceWith(`Checkout Sessions (write): ok\nCharges and Refunds (write): missing — ${detail}`);
  expect(process.exitCode).toBe(0);
});


describe('KSeF controlled submission', () => {
  it('submits an invoice by order ID and prints one result envelope', async () => {
    const invoice = { id: 'invoice-1', status: 'queued', invoiceNumber: 'FV/2026/000001' };
    h.sendInvoice.mockResolvedValue(ok({ invoice }));
    await run('--json', 'invoice', 'send', '--order-id', 'order-1');
    expect(h.sendInvoice).toHaveBeenCalledWith('order-1');
    expect(soleJson()).toEqual({ ok: true, data: { invoice } });
  });

  it('preserves the forbidden exit code when a member tries to send', async () => {
    h.sendInvoice.mockResolvedValue(err(appError('forbidden', 'Forbidden')));
    await run('--json', 'invoice', 'send', '--order-id', 'order-1');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(4);
  });

  it.each(['manual', 'automatic'])('updates the KSeF submission mode to %s', async (mode) => {
    h.updateTenantSettings.mockResolvedValue(ok({ settings: { ksefSubmissionMode: mode } }));
    await run('--json', 'tenant', 'settings-set', '--ksef-submission-mode', mode);
    expect(h.updateTenantSettings).toHaveBeenCalledWith({ ksefSubmissionMode: mode });
  });

  it('rejects an invalid KSeF submission mode before calling the server', async () => {
    await run('--json', 'tenant', 'settings-set', '--ksef-submission-mode', 'later');
    expect(h.updateTenantSettings).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});


describe('catalog cleanup commands', () => {
  it.each(['archive', 'restore'] as const)('runs course %s with the course ID', async (action) => {
    await run('--json', 'course', action, 'course-1');
    expect(action === 'archive' ? h.archiveCourse : h.restoreCourse).toHaveBeenCalledExactlyOnceWith({ courseId: 'course-1' });
    expect(soleJson()).toMatchObject({ ok: true, data: { course: { id: 'course-1' } } });
  });

  it('restores a content snapshot through its explicit command', async () => {
    await run('--json', 'course', 'restore-version', 'version-1');
    expect(h.restoreContentVersion).toHaveBeenCalledExactlyOnceWith({ versionId: 'version-1' });
    expect(h.restoreCourse).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: true, data: { restored: { entityId: 'course-1' } } });
  });

  it('lists archived courses', async () => {
    h.listCourses.mockResolvedValue(ok({ courses: [] }));
    await run('--json', 'course', 'list', '--archived');
    expect(h.listCourses).toHaveBeenCalledExactlyOnceWith(undefined, { archived: true });
    expect(soleJson()).toEqual({ ok: true, data: { courses: [] } });
  });

  it('requires confirmation before deleting a product draft', async () => {
    await run('--json', 'product', 'delete', 'draft-1');
    expect(h.deleteProductDraft).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Product deletion requires --confirm' } });
    expect(process.exitCode).toBe(2);
  });

  it('deletes a product draft after explicit confirmation', async () => {
    await run('--json', 'product', 'delete', 'draft-1', '--confirm');
    expect(h.deleteProductDraft).toHaveBeenCalledExactlyOnceWith({ productId: 'draft-1' });
    expect(soleJson()).toEqual({ ok: true, data: { deleted: true } });
  });
});

describe('product stock CLI', () => {
  const stock = { productId: 'poster', onHand: 3, reserved: 1, available: 2, lowStockThreshold: 2, lowStockNotifiedAt: null, low: true, soldOut: false, updatedAt: '2026-11-05T10:00:00.000Z' };

  beforeEach(() => {
    h.getProductStock.mockReset().mockResolvedValue(ok({ stock }));
    h.enableProductStock.mockReset().mockResolvedValue(ok({ stock }));
    h.adjustProductStock.mockReset().mockResolvedValue(ok({ stock }));
    h.setProductStockThreshold.mockReset().mockResolvedValue(ok({ stock }));
    h.listProducts.mockReset().mockResolvedValue(ok({
      products: [
        { id: 'poster', title: 'Poster', priceCents: 4900, currency: 'PLN', published: true },
        { id: 'course', title: 'Course', priceCents: 9900, currency: 'PLN', published: true },
      ],
      stock: [stock],
    }));
  });

  it('shows stock in the JSON envelope', async () => {
    await run('--json', 'product', 'stock', 'show', 'poster');
    expect(h.getProductStock).toHaveBeenCalledExactlyOnceWith('poster');
    expect(soleJson()).toEqual({ ok: true, data: { stock } });
  });

  it('enables tracking with an optional threshold', async () => {
    await run('--json', 'product', 'stock', 'enable', 'poster', '--on-hand', '3', '--threshold', '2');
    await run('--json', 'product', 'stock', 'enable', 'poster', '--on-hand', '0');
    expect(h.enableProductStock.mock.calls).toEqual([
      [{ productId: 'poster', onHand: 3, lowStockThreshold: 2 }],
      [{ productId: 'poster', onHand: 0, lowStockThreshold: null }],
    ]);
  });

  it('adjusts by a signed delta with a reason and rejects a zero delta before calling the API', async () => {
    await run('--json', 'product', 'stock', 'adjust', 'poster', '--delta', '-1', '--reason', 'damaged');
    expect(h.adjustProductStock).toHaveBeenCalledExactlyOnceWith({ productId: 'poster', delta: -1, reason: 'damaged' });
    logSpy.mockClear();
    await run('--json', 'product', 'stock', 'adjust', 'poster', '--delta', '0', '--reason', 'count');
    expect(h.adjustProductStock).toHaveBeenCalledTimes(1);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('sets or clears the low-stock threshold', async () => {
    await run('--json', 'product', 'stock', 'threshold', 'poster', '--value', '4');
    await run('--json', 'product', 'stock', 'threshold', 'poster', '--value', 'none');
    expect(h.setProductStockThreshold.mock.calls).toEqual([
      [{ productId: 'poster', lowStockThreshold: 4 }],
      [{ productId: 'poster', lowStockThreshold: null }],
    ]);
  });

  it('maps a sold-out refusal to its own exit code', async () => {
    h.adjustProductStock.mockResolvedValue(err(appError('sold_out', '"Poster" is sold out')));
    await run('--json', 'product', 'stock', 'adjust', 'poster', '--delta', '1', '--reason', 'count');
    expect(process.exitCode).toBe(26);
  });

  it('shows stock next to tracked products in the product list', async () => {
    await run('product', 'list');
    const output = String(logSpy.mock.calls[0]?.[0]);
    expect(output).toContain('- Poster  4900 PLN  [published]  {2 available · 3 on hand · 1 reserved · low}  (poster)');
    expect(output).toContain('- Course  9900 PLN  [published]  (course)');
  });
});

describe('public offer CLI', () => {
  const offerProduct = (id: string, title: string, stock: { tracked: boolean; soldOut: boolean; low: boolean; available: number | null }, maxQuantity: number) => ({
    id, title, priceCents: 4900, currency: 'PLN', stock, maxQuantity,
  });
  const offer = {
    tenant: { slug: 'acme', name: 'Acme' },
    products: [
      offerProduct('poster', 'Poster', { tracked: true, soldOut: false, low: true, available: 3 }, 3),
      offerProduct('mug', 'Mug', { tracked: true, soldOut: true, low: false, available: 0 }, 0),
      offerProduct('course', 'Course', { tracked: false, soldOut: false, low: false, available: null }, 1),
    ],
  };

  beforeEach(() => {
    h.publicOffer.mockReset().mockResolvedValue(ok(offer));
  });

  it('appends how many units of a tracked product are left', async () => {
    await run('public', 'offer');
    expect(String(logSpy.mock.calls[0]?.[0]).split('\n')).toEqual([
      '- Poster  4900 PLN  (poster)  3 left',
      '- Mug  4900 PLN  (mug)  sold out',
      '- Course  4900 PLN  (course)',
    ]);
  });

  it('passes the counts through the JSON envelope unchanged', async () => {
    await run('--json', 'public', 'offer');
    expect(soleJson()).toEqual({ ok: true, data: offer });
  });
});

describe('team CLI', () => {
  beforeEach(() => {
    h.listTenantTeam.mockReset().mockResolvedValue(ok({
      members: [{ userId: 'admin-user', email: 'Admin@example.test', name: null, role: 'admin' }],
    }));
    h.addTenantAdmin.mockReset().mockResolvedValue(ok({ status: 'invitation_sent' }));
    h.removeTenantAdmin.mockReset().mockResolvedValue(ok({ userId: 'admin-user' }));
  });

  it('lists staff in the JSON envelope', async () => {
    await run('--json', 'team', 'list');
    expect(h.listTenantTeam).toHaveBeenCalledOnce();
    expect(soleJson()).toMatchObject({ ok: true, data: { members: [{ userId: 'admin-user' }] } });
  });

  it('normalizes an address before adding an administrator', async () => {
    await run('--json', 'team', 'add', ' Admin@Example.test ');
    expect(h.addTenantAdmin).toHaveBeenCalledWith({ email: 'admin@example.test' });
    expect(soleJson()).toEqual({ ok: true, data: { status: 'invitation_sent' } });
  });

  it('resolves an address case-insensitively before removing its user id', async () => {
    await run('--json', 'team', 'remove', ' ADMIN@EXAMPLE.TEST ');
    expect(h.removeTenantAdmin).toHaveBeenCalledWith({ userId: 'admin-user' });
  });

  it('does not remove anything when the email is absent', async () => {
    await run('--json', 'team', 'remove', 'missing@example.test');
    expect(h.removeTenantAdmin).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(process.exitCode).toBe(5);
  });

  it('sends an organization-only address to the server, which answers organization_managed', async () => {
    h.listTenantTeam.mockResolvedValue(ok({
      members: [],
      organization: { id: 'org-1', slug: 'holding', name: 'Holding', members: [{ userId: 'org-user', email: 'org@example.test', name: null, role: 'owner', source: 'organization' }] },
    }));
    h.removeTenantAdmin.mockResolvedValue(err(appError('organization_managed', 'This access comes from the organization')));
    await run('--json', 'team', 'remove', 'org@example.test');
    expect(h.removeTenantAdmin).toHaveBeenCalledWith({ userId: 'org-user' });
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'organization_managed' } });
    expect(process.exitCode).toBe(32);
  });

  it('propagates owner-only authorization failures without attempting a removal', async () => {
    h.listTenantTeam.mockResolvedValue(err(appError('forbidden', 'Owner role required')));
    await run('--json', 'team', 'remove', 'admin@example.test');
    expect(h.removeTenantAdmin).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(4);
  });
});

describe('organization member CLI', () => {
  const member = { userId: 'member-user', email: 'member@example.test', role: 'owner', createdAt: '2026-11-15T12:00:00.000Z' };
  beforeEach(() => {
    h.listOrganizations.mockReset().mockResolvedValue(ok({
      organizations: [{ id: 'org-1', slug: 'holding', name: 'Holding', status: 'active', role: 'owner' }],
    }));
    h.addOrganizationMember.mockReset().mockResolvedValue(ok({ member, changed: true }));
    h.setOrganizationMemberRole.mockReset().mockResolvedValue(ok({ member, changed: false }));
    h.removeOrganizationMember.mockReset().mockResolvedValue(ok({ member, changed: true }));
  });

  it('adds a member with a normalised address and role in the selected organization', async () => {
    await run('--json', 'org', 'member', 'add', ' Member@Example.test ', '--role', 'owner', '--org', 'holding');
    expect(h.addOrganizationMember).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-1', email: 'member@example.test', role: 'owner' });
    expect(soleJson()).toEqual({ ok: true, data: { member, changed: true } });
  });

  it('changes a role and removes a member by address', async () => {
    await run('--json', 'org', 'member', 'role', 'member@example.test', '--role', 'admin', '--org', 'org-1');
    expect(h.setOrganizationMemberRole).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-1', email: 'member@example.test', role: 'admin' });
    logSpy.mockClear();
    await run('--json', 'org', 'member', 'remove', 'member@example.test', '--org', 'holding');
    expect(h.removeOrganizationMember).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-1', email: 'member@example.test' });
    expect(soleJson()).toEqual({ ok: true, data: { member, changed: true } });
  });

  it.each([
    ['add', 'member@example.test', '--org', 'holding'],
    ['role', 'member@example.test', '--role', 'member', '--org', 'holding'],
    ['remove', 'not-an-email', '--org', 'holding'],
  ])('refuses %s with a missing role, an unknown role or a malformed address before calling the API', async (...args) => {
    await run('--json', 'org', 'member', ...args);
    expect(h.addOrganizationMember).not.toHaveBeenCalled();
    expect(h.setOrganizationMemberRole).not.toHaveBeenCalled();
    expect(h.removeOrganizationMember).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('propagates the last-owner conflict with its exit code', async () => {
    h.removeOrganizationMember.mockResolvedValue(err(appError('conflict', 'The last owner of an organization cannot be demoted or removed')));
    await run('--json', 'org', 'member', 'remove', 'member@example.test', '--org', 'holding');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(process.exitCode).toBe(6);
  });
});

describe('organization settings, secrets and sources CLI', () => {
  const secret = { key: 'smtp.password', maskedPreview: '••••1234', updatedAt: '2026-11-15T12:00:00.000Z' };
  beforeEach(() => {
    h.listOrganizations.mockReset().mockResolvedValue(ok({
      organizations: [{ id: 'org-1', slug: 'holding', name: 'Holding', status: 'active', role: 'owner' }],
    }));
    h.updateOrganization.mockReset().mockResolvedValue(ok({ organization: { id: 'org-1' }, settings: {}, changed: true }));
    h.listOrganizationSecrets.mockReset().mockResolvedValue(ok({ secrets: [secret] }));
    h.setOrganizationSecret.mockReset().mockResolvedValue(ok({ secret }));
    h.deleteOrganizationSecret.mockReset().mockResolvedValue(ok({ key: 'smtp.password' }));
    h.listOrganizationWorkspaces.mockReset().mockResolvedValue(ok({ workspaces: [{ id: 'tenant-acme', slug: 'acme', name: 'Acme', status: 'active' }] }));
    h.getWorkspaceConfigSources.mockReset().mockResolvedValue(ok({ workspace: { id: 'tenant-acme' }, sources: [] }));
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('reads a secret value from the named environment variable and never takes it from arguments', async () => {
    vi.stubEnv('ORG_SMTP_PASSWORD', ' smtp-secret-1234 ');
    await run('--json', 'org', 'secret', 'set', 'smtp.password', '--value-env', 'ORG_SMTP_PASSWORD', '--org', 'holding');
    expect(h.setOrganizationSecret).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-1', key: 'smtp.password', value: 'smtp-secret-1234' });
    expect(soleJson()).toEqual({ ok: true, data: { secret } });
  });

  it.each([
    ['stripe.restrictedKey', '--value-env', 'ORG_SMTP_PASSWORD'],
    ['s3.accessKeyId', '--value-env', 'ORG_SMTP_PASSWORD'],
    ['smtp.password', '--value-env', 'ORG_UNSET_VARIABLE'],
  ])('refuses secret set %s with %s before calling the API', async (...args) => {
    vi.stubEnv('ORG_SMTP_PASSWORD', 'smtp-secret-1234');
    await run('--json', 'org', 'secret', 'set', ...args, '--org', 'holding');
    expect(h.setOrganizationSecret).not.toHaveBeenCalled();
    const output = soleJson();
    expect(output).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(JSON.stringify(output)).not.toContain('smtp-secret-1234');
  });

  it('lists and deletes secrets, updates settings and shows workspace sources', async () => {
    await run('--json', 'org', 'secret', 'list', '--org', 'holding');
    expect(soleJson()).toEqual({ ok: true, data: { secrets: [secret] } });
    logSpy.mockClear();
    await run('--json', 'org', 'secret', 'delete', 'smtp.password', '--org', 'holding');
    expect(h.deleteOrganizationSecret).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-1', key: 'smtp.password' });
    logSpy.mockClear();
    await run('--json', 'org', 'update', '--org', 'holding', '--legal-name', 'Holding Ltd', '--legal-address', '', '--invoicing-provider', 'none', '--shipx-environment', 'production');
    expect(h.updateOrganization).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1', update: { legalName: 'Holding Ltd', legalAddress: null, invoicingProvider: null, shipxEnvironment: 'production' },
    });
    logSpy.mockClear();
    await run('--json', 'org', 'workspace', 'sources', 'ACME', '--org', 'holding');
    expect(h.getWorkspaceConfigSources).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-1', tenantId: 'tenant-acme' });
  });

  it('refuses an update without settings or with an invalid sender before calling the API', async () => {
    await run('--json', 'org', 'update', '--org', 'holding');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    logSpy.mockClear();
    await run('--json', 'org', 'update', '--org', 'holding', '--shipx-sender', '{not json');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.updateOrganization).not.toHaveBeenCalled();
  });
});

describe('tenant analytics settings', () => {
  it('passes all five analytics settings through the existing update path', async () => {
    h.updateTenantSettings.mockResolvedValue(ok({ settings: {} }));
    await run('--json', 'tenant', 'settings-set',
      '--analytics-tag-id', 'G-ABCD123',
      '--analytics-meta-pixel-id', '12345678',
      '--analytics-consent-cookie-name', 'site_consent',
      '--analytics-consent-cookie-value', 'analytics:true',
      '--analytics-load-without-consent', 'true');
    expect(h.updateTenantSettings).toHaveBeenCalledWith({
      analyticsTagId: 'G-ABCD123',
      analyticsMetaPixelId: '12345678',
      analyticsConsentCookieName: 'site_consent',
      analyticsConsentCookieValue: 'analytics:true',
      analyticsLoadWithoutConsent: true,
    });
  });

  it('accepts empty strings to clear text settings and false to restore consent checks', async () => {
    h.updateTenantSettings.mockResolvedValue(ok({ settings: {} }));
    await run('--json', 'tenant', 'settings-set',
      '--analytics-tag-id', '',
      '--analytics-meta-pixel-id', '',
      '--analytics-consent-cookie-name', '',
      '--analytics-consent-cookie-value', '',
      '--analytics-load-without-consent', 'false');
    expect(h.updateTenantSettings).toHaveBeenCalledWith({
      analyticsTagId: '',
      analyticsMetaPixelId: '',
      analyticsConsentCookieName: '',
      analyticsConsentCookieValue: '',
      analyticsLoadWithoutConsent: false,
    });
  });

  it('rejects an invalid consent switch value before calling the client', async () => {
    await run('--json', 'tenant', 'settings-set', '--analytics-load-without-consent', 'yes');
    expect(h.updateTenantSettings).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('prints all five analytics settings', async () => {
    h.getTenantSettings.mockResolvedValue(ok({ settings: {
      analyticsTagId: 'G-ABCDEF1234',
      analyticsMetaPixelId: '12345678',
      analyticsConsentCookieName: 'site_consent',
      analyticsConsentCookieValue: 'analytics:true',
      analyticsLoadWithoutConsent: false,
    } }));
    await run('tenant', 'settings');
    for (const line of [
      'analytics tag ID: G-ABCDEF1234',
      'analytics Meta Pixel ID: 12345678',
      'analytics consent cookie name: site_consent',
      'analytics consent cookie value: analytics:true',
      'analytics load without consent: false',
    ]) {
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(line));
    }
  });
});


describe('orders list CLI text', () => {
  const order = {
    id: 'order-12345678', createdAt: '2026-11-15T10:00:00.000Z', status: 'paid', amountCents: 9400, currency: 'PLN',
    kind: 'one_time', productTitle: 'Paperback', memberEmail: 'buyer@example.com',
  };
  const line = { productType: 'physical', grossCents: 4000, netCents: 3810, vatRate: 5, vatCents: 190, vatExemptionBasis: null, issuedCount: 0 };

  it('names a product line above one unit "2 × Title" and leaves out the delivery line', async () => {
    h.listOrders.mockResolvedValue(ok({ orders: [{ ...order, lines: [
      { ...line, productId: 'paperback', name: 'Paperback', quantity: 2 },
      { ...line, productId: 'poster', name: 'Poster', quantity: 1 },
      { ...line, productId: 'courier', name: 'Courier', productType: 'shipping', quantity: 1, issuedCount: null },
    ] }], total: 1, page: 1, pageSize: 20, sources: [] }));
    await run('orders', 'list');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('\t2 × Paperback; Poster\tbuyer@example.com\t'));
  });

  it('shows the client reference only of an order that has one', async () => {
    h.listOrders.mockResolvedValue(ok({ orders: [{ ...order, clientReference: 'shop-cart-8812' }, { ...order, id: 'order-87654321' }], total: 2, page: 1, pageSize: 20, sources: [] }));
    await run('orders', 'list');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('\tbuyer@example.com\tref shop-cart-8812\t(order-12)\n'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('\tbuyer@example.com\t(order-87)\n'));
  });

  it('keeps the product title for orders of one unit per line', async () => {
    h.listOrders.mockResolvedValue(ok({ orders: [{ ...order, lines: [{ ...line, productId: 'paperback', name: 'Paperback (old title)', quantity: 1 }] }], total: 1, page: 1, pageSize: 20, sources: [] }));
    await run('orders', 'list');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('\tPaperback\tbuyer@example.com\t'));
  });
});

describe('orders changes CLI', () => {
  it('reads the change feed after a cursor and prints each change and the next cursor', async () => {
    h.orderChanges.mockResolvedValue(ok({ changes: [{ cursor: '9.4', order: {
      id: 'order-12345678', tenantId: 'workspace', memberId: 'member', productId: 'paperback', priceId: null, kind: 'one_time',
      status: 'paid', mode: 'live', amountCents: 9400, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null,
      discountCents: 0, createdAt: '2026-11-15T10:00:00.000Z', memberEmail: 'buyer@example.com', memberName: 'Buyer',
      productTitle: 'Paperback', couponCode: null, fulfilmentStatus: 'shipped',
    } }], nextCursor: '9.4' }));
    await run('orders', 'changes', '--after', '8.7', '--limit', '50', '--mode', 'live');
    expect(h.orderChanges).toHaveBeenCalledExactlyOnceWith({ after: '8.7', limit: 50, mode: 'live' });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('9.4\torder-12345678\tpaid\tshipped\nnext cursor: 9.4');
  });
});

describe('order attribution CLI', () => {
  it.each(['meta', 'none'])('passes --source %s and preserves attribution in JSON', async (source) => {
    const attribution = { utmSource: 'meta', utmMedium: 'paid', capturedAt: '2026-10-15T12:00:00.000Z' };
    h.listOrders.mockResolvedValue(ok({ orders: [{ id: 'order', attribution }], total: 1, page: 1, pageSize: 20, sources: ['meta'] }));
    await run('--json', 'orders', 'list', '--source', source);
    expect(h.listOrders).toHaveBeenCalledExactlyOnceWith({ source });
    expect(soleJson()).toMatchObject({ ok: true, data: { orders: [{ attribution }] } });
  });
});

it('distinguishes the campaign source none from missing attribution in CLI lists and exports', async () => {
  h.listOrders.mockResolvedValue(ok({ orders: [], total: 0, page: 1, pageSize: 20, sources: ['none'] }));
  h.exportOrders.mockResolvedValue(ok({ filename: 'orders.json', mimeType: 'application/json', content: '[]' }));
  await run('--json', 'orders', 'list', '--source', 'none', '--source-exact');
  expect(h.listOrders).toHaveBeenCalledExactlyOnceWith({ source: 'none', sourceMatch: 'exact' });
  await run('--json', 'orders', 'export', '--format', 'json', '--source', 'none', '--source-exact');
  expect(h.exportOrders).toHaveBeenCalledExactlyOnceWith({ format: 'json', source: 'none', sourceMatch: 'exact' });
});

describe('shipping CLI', () => {
  it('creates and updates a shipped product with --delivery-method', async () => {
    await run('--json', 'product', 'create', '--title', 'Printed accessory', '--type', 'physical', '--price-cents', '4900', '--delivery-method', 'shipping');
    expect(h.createProduct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'physical', deliveryMethod: 'shipping' }));
    await run('--json', 'product', 'update', 'product-1', '--delivery-method', 'pickup');
    expect(h.updateProduct).toHaveBeenCalledExactlyOnceWith({ id: 'product-1', deliveryMethod: 'pickup' });
  });

  it('rejects an unknown delivery method before calling the server', async () => {
    await run('--json', 'product', 'create', '--title', 'Printed accessory', '--price-cents', '4900', '--delivery-method', 'drone');
    expect(h.createProduct).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('filters and exports orders that still need shipping', async () => {
    h.listOrders.mockReset().mockResolvedValue(ok({ orders: [], total: 0, page: 1, pageSize: 20, sources: [] }));
    h.exportOrders.mockReset().mockResolvedValue(ok({ filename: 'orders.csv', mimeType: 'text/csv', content: '' }));
    await run('--json', 'orders', 'list', '--fulfilment', 'to_pack');
    expect(h.listOrders).toHaveBeenCalledExactlyOnceWith({ fulfilmentStatus: 'to_pack' });
    await run('--json', 'orders', 'export', '--format', 'csv', '--fulfilment', 'to_pack');
    expect(h.exportOrders).toHaveBeenCalledExactlyOnceWith({ format: 'csv', fulfilmentStatus: 'to_pack' });
  });

  it('sets shipping rates from inline JSON and the parcel locker map token', async () => {
    const rates = [{ id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true }];
    h.updateTenantSettings.mockResolvedValue(ok({ settings: { shippingRates: [{ ...rates[0], vatRatePercent: 23 }], inpostGeowidgetToken: 'public-token' } }));
    await run('tenant', 'settings-set', '--shipping-rates', JSON.stringify(rates), '--inpost-geowidget-token', 'public-token');
    expect(h.updateTenantSettings).toHaveBeenCalledExactlyOnceWith({ shippingRates: [{ ...rates[0], vatRatePercent: 23 }], inpostGeowidgetToken: 'public-token' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('shipping rates: locker Parcel locker 1499 (active)'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('InPost parcel locker map token: (set)'));
  });

  it('sets and clears the checkout return origins from a comma-separated list', async () => {
    h.updateTenantSettings.mockResolvedValue(ok({ settings: { checkoutReturnOrigins: ['https://shop.example.test', 'https://www.shop.example.test'] } }));
    await run('tenant', 'settings-set', '--checkout-return-origins', ' https://shop.example.test, https://www.shop.example.test ');
    expect(h.updateTenantSettings).toHaveBeenCalledExactlyOnceWith({ checkoutReturnOrigins: ['https://shop.example.test', 'https://www.shop.example.test'] });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('checkout return origins: https://shop.example.test, https://www.shop.example.test'));
    h.updateTenantSettings.mockClear();
    h.updateTenantSettings.mockResolvedValue(ok({ settings: { checkoutReturnOrigins: [] } }));
    await run('tenant', 'settings-set', '--checkout-return-origins', '');
    expect(h.updateTenantSettings).toHaveBeenCalledExactlyOnceWith({ checkoutReturnOrigins: [] });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('checkout return origins: (none)'));
  });

  it('rejects more than five shipping rates before calling the server', async () => {
    const rates = Array.from({ length: 6 }, (_, index) => ({ id: `rate-${index}`, label: 'Rate', amountCents: 100, carrier: 'other', pickupPoint: 'none', active: true }));
    await run('--json', 'tenant', 'settings-set', '--shipping-rates', JSON.stringify(rates));
    expect(h.updateTenantSettings).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });
});

describe('staff refund CLI', () => {
  it('parses the refund flags and sends a partial refund with stock and the packing list kept', async () => {
    await run('order', 'refund', 'order-number', '--amount', '12.50', '--remainder', '40.99', '--reason', 'Damaged cover', '--request-key', 'retry-7', '--yes');
    expect(h.orderRefundPreview).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({
      orderId: 'order-number', requestKey: 'retry-7', amountCents: 1250, expectedRemainderCents: 4099, reason: 'Damaged cover', restock: false, removeFromPackingList: false,
      expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false },
    });
    expect(logSpy).toHaveBeenCalledWith('refund refund-1: 12.50 PLN (partial), pending\nrequest key: retry-7 (repeat with --request-key retry-7 to retry without a second refund)');
  });

  it('leaves the full-refund defaults to the server and refuses without --yes', async () => {
    await run('--json', 'orders', 'refund', 'order-number', '--request-key', 'auto-1');
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Refunding 40.99 PLN of order order-number cannot be undone; to confirm, repeat it as: order refund order-number --remainder 40.99 --request-key auto-1 --yes', details: { command: 'order refund order-number --remainder 40.99 --request-key auto-1 --yes' } } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    process.exitCode = 0;
    logSpy.mockClear();
    await run('order', 'refund', 'order-number', '--yes', '--remainder', '40.99');
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number', requestKey: expect.stringMatching(/^cli-/), expectedAmountCents: 4099, expectedRemainderCents: 4099, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
  });

  it('prints the refund preview and puts an order back on the packing list', async () => {
    await run('--json', 'order', 'refund-preview', 'order-number');
    expect(soleJson()).toMatchObject({ ok: true, data: { orderId: 'order-number', remainderCents: 4099 } });
    logSpy.mockClear();
    await run('order', 'ship-anyway', 'order-number');
    expect(h.shipOrderAnyway).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number' });
    expect(logSpy).toHaveBeenCalledWith('back on the packing list: order-number');
  });
});

describe('fulfilment CLI', () => {
  it('ships an order with the carrier and tracking number', async () => {
    await run('orders', 'ship', 'order-number', '--carrier', 'inpost', '--tracking', 'ABCD1234');
    expect(h.shipOrder).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number', carrier: 'inpost', trackingNumber: 'ABCD1234' });
    expect(logSpy).toHaveBeenCalledWith('shipped: order-number (inpost ABCD1234)');
  });

  it('rejects an unknown carrier before calling the server and maps a second shipment to its exit code', async () => {
    await run('--json', 'orders', 'ship', 'order-number', '--carrier', 'dhl', '--tracking', 'ABCD1234');
    expect(h.shipOrder).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    h.shipOrder.mockResolvedValue(err(appError('fulfilment_conflict', 'Order has already been shipped')));
    await run('--json', 'orders', 'ship', 'order-number', '--carrier', 'other', '--tracking', 'RR123456789PL');
    expect(process.exitCode).toBe(27);
  });

  it('lists shipped orders and writes the packing list to a file', async () => {
    await run('--json', 'orders', 'list', '--fulfilment', 'shipped');
    expect(h.listOrders).toHaveBeenCalledExactlyOnceWith({ fulfilmentStatus: 'shipped' });
    await run('orders', 'packing-list', '--format', 'csv');
    expect(h.ordersPackingList).toHaveBeenCalledExactlyOnceWith({ format: 'csv', mode: 'live' });
    expect(logSpy).toHaveBeenCalledWith('order_number,paid_at');
    await run('--json', 'orders', 'packing-list', '--format', 'json');
    expect(h.ordersPackingList).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(2);
  });

  it('sends the requested payment mode with the packing list and rejects an unknown one', async () => {
    await run('--json', 'orders', 'packing-list', '--format', 'csv', '--mode', 'test', '--fulfilment', 'shipped');
    expect(h.ordersPackingList).toHaveBeenCalledExactlyOnceWith({ format: 'csv', mode: 'test', fulfilmentStatus: 'shipped' });
    await run('--json', 'orders', 'packing-list', '--format', 'csv', '--mode', 'live');
    expect(h.ordersPackingList).toHaveBeenLastCalledWith({ format: 'csv', mode: 'live' });
    await run('--json', 'orders', 'packing-list', '--format', 'csv', '--mode', 'staging');
    expect(h.ordersPackingList).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(2);
  });

  it('passes product safety information and variant fields to product create and update', async () => {
    const compliance = { manufacturerName: 'Example Workshop', manufacturerAddress: 'Example Street 1', manufacturerEmail: 'safety@example.com', modelIdentifier: 'STAND-1' };
    await run('--json', 'product', 'create', '--title', 'Printed stand', '--type', 'physical', '--price-cents', '4900',
      '--compliance', JSON.stringify(compliance), '--variant-group', 'printed-stand', '--variant-label', 'Black · ASA');
    expect(h.createProduct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      compliance: { ...compliance, manufacturerOutsideEu: false, safetyWarnings: '' }, variantGroup: 'printed-stand', variantLabel: 'Black · ASA',
    }));
    await run('--json', 'product', 'update', 'product-1', '--compliance', 'null', '--clear-variant');
    expect(h.updateProduct).toHaveBeenCalledExactlyOnceWith({ id: 'product-1', compliance: null, variantGroup: null, variantLabel: null });
  });

  it('passes the responsible person of a manufacturer outside the EU and refuses it missing', async () => {
    const compliance = {
      manufacturerName: 'Example Lamp Works', manufacturerAddress: '1 Example Road', manufacturerEmail: 'safety@example.com', modelIdentifier: 'LAMP-2',
      manufacturerOutsideEu: true,
    };
    const responsiblePerson = { responsiblePersonName: 'Example EU Representative', responsiblePersonAddress: 'Example Street 1, Warsaw', responsiblePersonEmail: 'eu-rep@example.com' };
    await run('--json', 'product', 'create', '--title', 'Lamp', '--type', 'physical', '--price-cents', '4900', '--compliance', JSON.stringify(compliance));
    expect(h.createProduct).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    await run('--json', 'product', 'update', 'product-1', '--compliance', JSON.stringify({ ...compliance, ...responsiblePerson }));
    expect(h.updateProduct).toHaveBeenCalledExactlyOnceWith({ id: 'product-1', compliance: { ...compliance, ...responsiblePerson, safetyWarnings: '' } });
  });

  it('rejects invalid product safety information before calling the server', async () => {
    await run('--json', 'product', 'create', '--title', 'Printed stand', '--price-cents', '4900', '--compliance', '{"manufacturerName":"Only a name"}');
    expect(h.createProduct).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });
});

describe('product image-upload CLI', () => {
  const imageFile = async (name: string): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), 'product-image-'));
    const path = join(directory, name);
    await writeFile(path, new Uint8Array([137, 80, 78, 71]));
    return path;
  };

  it('uploads a gallery image and prints only its URL', async () => {
    const path = await imageFile('front.PNG');
    await run('product', 'image-upload', path);
    expect(h.uploadProductImage).toHaveBeenCalledExactlyOnceWith({
      kind: 'product-image', fileName: 'front.PNG', contentType: 'image/png', sizeBytes: 4, body: new Uint8Array([137, 80, 78, 71]),
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('/api/public/assets/product-image/1.png');
    expect(h.createProduct).not.toHaveBeenCalled();
    expect(h.updateProduct).not.toHaveBeenCalled();
    await rm(join(path, '..'), { recursive: true, force: true });
  });

  it('prints the upload result as JSON with --json and passes a server refusal through', async () => {
    const path = await imageFile('side.jpeg');
    await run('--json', 'product', 'image-upload', path);
    expect(soleJson()).toEqual({ ok: true, data: { url: '/api/public/assets/product-image/1.png' } });
    expect(h.uploadProductImage).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'side.jpeg', contentType: 'image/jpeg' }));
    logSpy.mockClear();
    h.uploadProductImage.mockResolvedValue(err(appError('forbidden', 'Not allowed')));
    await run('--json', 'product', 'image-upload', path);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.forbidden);
    await rm(join(path, '..'), { recursive: true, force: true });
  });

  it('refuses a missing file and an unsupported type with the validation exit code before any upload', async () => {
    const gif = await imageFile('front.gif');
    for (const file of [join(gif, '..', 'missing.png'), gif]) {
      process.exitCode = 0;
      logSpy.mockClear();
      await run('--json', 'product', 'image-upload', file);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    }
    expect(h.uploadProductImage).not.toHaveBeenCalled();
    await rm(join(gif, '..'), { recursive: true, force: true });
  });
});

describe('personalisation CLI', () => {
  const engraving = { label: 'Add an engraving', inputLabel: 'Engraving text', condition: 'I understand a personalised item is made to my order.' };
  const settingFile = async (content: unknown): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), 'personalization-'));
    const path = join(directory, 'personalization.json');
    await writeFile(path, JSON.stringify(content));
    return path;
  };

  it('sends the personalisation file with product create and update, null for --no-personalization and nothing when neither is given', async () => {
    const path = await settingFile(engraving);
    await run('--json', 'product', 'create', '--title', 'Printed book', '--type', 'physical', '--price-cents', '4900', '--personalization-file', path);
    expect(h.createProduct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      personalization: { ...engraving, description: '', maxLength: 200 },
    }));
    await run('--json', 'product', 'update', 'product-1', '--personalization-file', path);
    expect(h.updateProduct).toHaveBeenLastCalledWith({ id: 'product-1', personalization: { ...engraving, description: '', maxLength: 200 } });
    await run('--json', 'product', 'update', 'product-1', '--no-personalization');
    expect(h.updateProduct).toHaveBeenLastCalledWith({ id: 'product-1', personalization: null });
    await run('--json', 'product', 'update', 'product-1', '--title', 'Renamed');
    expect(h.updateProduct).toHaveBeenLastCalledWith({ id: 'product-1', title: 'Renamed' });
    await rm(join(path, '..'), { recursive: true, force: true });
  });

  it('refuses an invalid personalisation file and both personalisation flags before calling the server', async () => {
    const invalid = await settingFile({ ...engraving, surchargeCents: 500 });
    await run('--json', 'product', 'create', '--title', 'Printed book', '--price-cents', '4900', '--personalization-file', invalid);
    expect(h.createProduct).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    await run('--json', 'product', 'update', 'product-1', '--personalization-file', invalid, '--no-personalization');
    expect(h.updateProduct).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    await rm(join(invalid, '..'), { recursive: true, force: true });
  });

  it('corrects the personalisation text of an order line through the order alias', async () => {
    await run('order', 'personalization', 'order-number', 'product-1', '--text', 'For Ann: with love');
    expect(h.correctOrderPersonalization).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number', productId: 'product-1', text: 'For Ann: with love' });
    expect(logSpy).toHaveBeenCalledWith('corrected personalisation: order-number (product-1)');
    h.correctOrderPersonalization.mockResolvedValue(err(appError('validation', 'This order line has no personalisation')));
    await run('--json', 'orders', 'personalization', 'order-number', 'product-2', '--text', 'For Bo');
    expect(process.exitCode).toBe(2);
  });

  it('sends the requested personalisations with a checkout session and a simulated purchase', async () => {
    await run('--json', 'checkout', 'session', '--sales-link', 'link-1', '--product', 'product-1',
      '--personalization', 'product-1:For Ann: with love', '--personalization', 'product-2:For Bo', '--accept-condition');
    expect(h.createCheckoutSession).toHaveBeenCalledExactlyOnceWith({
      productId: 'product-1',
      salesLinkId: 'link-1',
      personalizations: [
        { productId: 'product-1', text: 'For Ann: with love', conditionAccepted: true },
        { productId: 'product-2', text: 'For Bo', conditionAccepted: true },
      ],
    });
    await run('--json', 'simulate-purchase', '--product', 'product-1', '--email', 'buyer@example.test', '--personalization', 'product-1:For Ann');
    expect(h.simulatePurchase).toHaveBeenCalledExactlyOnceWith({
      productId: 'product-1',
      email: 'buyer@example.test',
      personalizations: [{ productId: 'product-1', text: 'For Ann', conditionAccepted: false }],
    });
  });

  it('refuses a malformed personalisation, a condition acceptance without one and a personalised cart before calling the server', async () => {
    await run('--json', 'checkout', 'session', '--product', 'product-1', '--personalization', 'product-1');
    await run('--json', 'checkout', 'session', '--product', 'product-1', '--accept-condition');
    await run('--json', 'checkout', 'session', '--line', 'product-1:1', '--personalization', 'product-1:For Ann');
    await run('--json', 'simulate-purchase', '--product', 'product-1', '--email', 'buyer@example.test', '--accept-condition');
    expect(h.createCheckoutSession).not.toHaveBeenCalled();
    expect(h.createCartCheckoutSession).not.toHaveBeenCalled();
    expect(h.simulatePurchase).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });
});

describe('InPost ShipX CLI', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('creates the shipment through the order alias and maps ShipX failures to their exit codes', async () => {
    await run('order', 'shipx', 'create', 'order-number');
    expect(h.shipxCreate).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number' });
    expect(logSpy).toHaveBeenCalledWith('shipped: order-number (inpost 520000011395200025754311)');
    h.shipxCreate.mockResolvedValue(err(appError('shipx_unavailable', 'InPost ShipX is unavailable')));
    await run('--json', 'orders', 'shipx', 'create', 'order-number');
    expect(process.exitCode).toBe(28);
    process.exitCode = 0;
    h.shipxCreate.mockResolvedValue(err(appError('shipx_rejected', 'InPost rejected the shipment data')));
    await run('--json', 'orders', 'shipx', 'create', 'order-number');
    expect(process.exitCode).toBe(29);
  });

  it('passes a chosen parcel template and rejects an unknown one before calling the server', async () => {
    await run('order', 'shipx', 'create', 'order-number', '--parcel-template', 'large');
    expect(h.shipxCreate).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number', parcelTemplate: 'large' });
    h.shipxCreate.mockClear();
    await run('--json', 'order', 'shipx', 'create', 'order-number', '--parcel-template', 'huge');
    expect(h.shipxCreate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('discards an unconfirmed attempt and maps a running operation to the fulfilment conflict exit code', async () => {
    await run('order', 'shipx', 'discard', 'order-number');
    expect(h.shipxDiscard).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number' });
    expect(logSpy).toHaveBeenCalledWith('discarded the unconfirmed InPost attempt of order-number');
    h.shipxDiscard.mockResolvedValue(err(appError('fulfilment_conflict', 'Another request is working on the InPost shipment')));
    await run('--json', 'order', 'shipx', 'discard', 'order-number');
    expect(process.exitCode).toBe(27);
  });

  it('writes the PDF label to the requested file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shipx-label-'));
    const out = join(directory, 'label.pdf');
    await run('--json', 'order', 'shipx', 'label', 'order-number', '--out', out);
    expect(h.shipxLabel).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number' });
    expect(await readFile(out, 'utf8')).toBe('%PDF-1.4');
    await rm(directory, { recursive: true, force: true });
  });

  it('shows the stored order readiness through the read route and refreshes it only on request', async () => {
    await run('order', 'shipx', 'show', 'order-number');
    expect(h.shipxShipment).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number' });
    expect(h.shipxRefresh).not.toHaveBeenCalled();
    await run('--json', 'order', 'shipx', 'refresh', 'order-number');
    expect(h.shipxRefresh).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-number' });
    expect(h.shipxShipment).toHaveBeenCalledTimes(1);
    h.shipxRefresh.mockResolvedValue(err(appError('forbidden', 'order:write is not permitted')));
    await run('--json', 'order', 'shipx', 'refresh', 'order-number');
    expect(process.exitCode).toBe(4);
  });

  it('shows the order readiness and configures the integration with a parsed sender', async () => {
    await run('orders', 'shipx', 'show', 'order-number');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('available: true'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('environment: sandbox'));
    const sender = { name: 'Anna Sender', email: 'shop@example.org', phone: '500600700', street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001' };
    vi.stubEnv('SHIPX_PRODUCTION_TOKEN', 'token-5678');
    await run('--json', 'tenant', 'shipx-set', '--slot', 'production', '--organization-id', '1234', '--token-env', 'SHIPX_PRODUCTION_TOKEN', '--sender', JSON.stringify(sender));
    expect(h.shipxConfigure).toHaveBeenCalledExactlyOnceWith({
      production: { organizationId: '1234', token: 'token-5678' }, sender: { ...sender, company: null },
    });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('token-5678');
    await run('--json', 'tenant', 'shipx-set', '--sender', '{"name":"Only a name"}');
    expect(h.shipxConfigure).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(2);
  });

  it('changes one ShipX connection named by --slot and the sender without a slot', async () => {
    await run('--json', 'tenant', 'shipx-set', '--slot', 'sandbox', '--clear-credentials');
    expect(h.shipxConfigure).toHaveBeenLastCalledWith({ sandbox: { clearCredentials: true } });
    await run('--json', 'tenant', 'shipx-set', '--sender', 'null');
    expect(h.shipxConfigure).toHaveBeenLastCalledWith({ sender: null });
    await run('tenant', 'shipx');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('production: not connected, organization id (not set), token (not set)'));
    expect(h.shipxConfigure).toHaveBeenCalledTimes(2);
  });

  it.each([
    [['--organization-id', '1234']],
    [['--clear-credentials']],
    [['--slot', 'production']],
    [['--slot', 'staging', '--organization-id', '1234']],
    [['--environment', 'production', '--organization-id', '1234']],
    [['--slot', 'production', '--token', 'token-5678']],
    [['--slot', 'production', '--token-env', 'SHIPX_TOKEN', '--token-stdin']],
  ])('refuses tenant shipx-set %j without calling the API', async (args) => {
    await run('--json', 'tenant', 'shipx-set', ...args);
    expect(h.shipxConfigure).not.toHaveBeenCalled();
    expect(process.exitCode).not.toBe(0);
  });

  it('passes the parcel template to product create and update', async () => {
    await run('--json', 'product', 'create', '--title', 'Printed stand', '--type', 'physical', '--delivery-method', 'shipping', '--price-cents', '4900', '--parcel-template', 'large');
    expect(h.createProduct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ parcelTemplate: 'large' }));
    await run('--json', 'product', 'update', 'product-1', '--parcel-template', 'small');
    expect(h.updateProduct).toHaveBeenCalledExactlyOnceWith({ id: 'product-1', parcelTemplate: 'small' });
    await run('--json', 'product', 'update', 'product-1', '--parcel-template', 'huge');
    expect(h.updateProduct).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(2);
  });
});

const ownerProposal = {
  id: 'proposal-1', groupId: null, groupTitle: null, groupPosition: null, operation: 'product.update', target: { kind: 'product', id: 'product-1' },
  targetLabel: 'Handbook',
  input: { id: 'product-1', title: 'Renamed' }, effect: { title: { before: 'Handbook', after: 'Renamed' }, onHand: { delta: 5 } }, status: 'pending',
  proposedBy: { keyId: 'shop-key', keyName: 'Catalogue agent', keyState: 'active', issuerUserId: 'owner-1', issuerEmail: 'owner@acme.example.test', issuerIsVerifiedOwner: true },
  createdAt: '1998-08-01T00:00:00.000Z', expiresAt: '1998-08-31T00:00:00.000Z', decidedByUserId: null, decidedByEmail: null, decidedAt: null,
  decisionNote: null, appliedResourceId: null, failureCode: null, failureMessage: null,
};

describe('owner change proposal commands', () => {
  it('lists the workspace proposals with status and paging options', async () => {
    h.listChangeProposals.mockReset().mockResolvedValue(ok({ proposals: [ownerProposal], nextCursor: 'proposal-1' }));
    await run('proposals', 'list', '--status', 'pending', '--limit', '10', '--cursor', 'proposal-0');
    expect(h.listChangeProposals).toHaveBeenCalledWith({ status: 'pending', cursor: 'proposal-0', limit: 10 });
    expect(logSpy).toHaveBeenCalledWith(
      '1998-08-01T00:00:00.000Z\tpending\tproduct.update\tproduct:product-1\tCatalogue agent\t-\t(proposal-1)\nnext: --cursor proposal-1',
    );
  });
  it('shows the group of each listed item and filters by group', async () => {
    h.listChangeProposals.mockReset().mockResolvedValue(ok({ proposals: [{ ...ownerProposal, groupId: 'group-1', groupTitle: 'Spring launch', groupPosition: 2 }], nextCursor: null }));
    await run('proposals', 'list', '--group', 'group-1');
    expect(h.listChangeProposals).toHaveBeenCalledWith({ groupId: 'group-1' });
    expect(logSpy).toHaveBeenCalledWith(
      '1998-08-01T00:00:00.000Z\tpending\tproduct.update\tproduct:product-1\tCatalogue agent\tgroup Spring launch #2 (group-1)\t(proposal-1)',
    );
  });
  it('lists the decided proposals, the filter the history page uses', async () => {
    h.listChangeProposals.mockReset().mockResolvedValue(ok({ proposals: [], nextCursor: null }));
    await run('proposals', 'list', '--status', 'decided');
    expect(h.listChangeProposals).toHaveBeenCalledWith({ status: 'decided' });
    expect(logSpy).toHaveBeenCalledWith('no change proposals');
  });
  it('names the decided filter in the list help', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await run('proposals', 'list', '--help');
    expect(output).toHaveBeenCalledWith(expect.stringMatching(/expired,\s+or\s+decided\s+\(every\s+proposal\s+no\s+longer\s+waiting\)/));
    output.mockRestore();
  });
  it('refuses an unknown status before calling the API', async () => {
    h.listChangeProposals.mockReset();
    await run('--json', 'proposals', 'list', '--status', 'approved');
    expect(h.listChangeProposals).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('shows one proposal with its before/after effect and history', async () => {
    h.getChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, events: [
      { sequence: 1, kind: 'proposed', actorUserId: null, apiKeyId: 'shop-key', note: null, at: '1998-08-01T00:00:00.000Z' },
    ] } }));
    await run('proposals', 'show', 'proposal-1');
    expect(h.getChangeProposal).toHaveBeenCalledWith({ id: 'proposal-1' });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed).toContain('  title: "Handbook" -> "Renamed"');
    expect(printed).toContain('  onHand: +5');
    expect(printed).toContain('proposed by key: Catalogue agent (shop-key, active), issued by owner-1');
    expect(printed).toContain('  1998-08-01T00:00:00.000Z\tproposed\tshop-key');
  });
  it('lists the file a proposal attaches, its copy source and, while it is pending, whether it is held and how to download it', async () => {
    h.getChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, operation: 'download.add', events: [], proposedFiles: [
      { id: 'staged-1', available: true, copiedFrom: { productId: 'product-2', productTitle: 'Field guide', versionNumber: 2 } },
    ] } }));
    await run('proposals', 'show', 'proposal-1');
    const printed = String(logSpy.mock.calls[0]?.[0]).split('\n');
    expect(printed).toContain('files:');
    expect(printed).toContain('  staged-1: held by this proposal; copy of version 2 of Field guide (product-2)');
    expect(printed).toContain('    download it with: together proposals file proposal-1 staged-1 --out <path>');
    logSpy.mockClear();
    h.getChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, operation: 'download.add', events: [], proposedFiles: [
      { id: 'staged-1', available: false, copiedFrom: null },
    ] } }));
    await run('proposals', 'show', 'proposal-1');
    const gone = String(logSpy.mock.calls[0]?.[0]);
    expect(gone).toContain('  staged-1: no longer available; approving changes nothing');
    expect(gone).not.toContain('download it with');
    logSpy.mockClear();
    h.getChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, operation: 'download.add', status: 'applied', events: [], proposedFiles: [
      { id: 'staged-1', available: false, copiedFrom: null },
    ] } }));
    await run('proposals', 'show', 'proposal-1');
    const applied = String(logSpy.mock.calls[0]?.[0]).split('\n');
    expect(applied).toContain('  staged-1');
    expect(applied.join('\n')).not.toContain('no longer available');
  });
  it('names the courses, modules and lessons of a proposed access change and says which no longer exist', async () => {
    h.getChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, operation: 'product.set-access', events: [],
      effect: { accessItems: { before: [{ level: 'course', courseId: 'course-1' }], after: [{ level: 'lessons', courseId: 'course-1', lessonIds: ['lesson-1', 'lesson-2'] }] } },
      accessLabels: { courses: [{ id: 'course-1', title: 'Intro course' }], modules: [], lessons: [{ id: 'lesson-1', title: 'Welcome' }, { id: 'lesson-2', title: null }] },
    } }));
    await run('proposals', 'show', 'proposal-1');
    const printed = String(logSpy.mock.calls[0]?.[0]).split('\n');
    expect(printed).toEqual(expect.arrayContaining([
      'names:', '  course course-1: Intro course', '  lesson lesson-1: Welcome', '  lesson lesson-2: no longer exists',
    ]));
    logSpy.mockClear();
    h.getChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, events: [] } }));
    await run('proposals', 'show', 'proposal-1');
    expect(String(logSpy.mock.calls[0]?.[0])).not.toContain('names:');
  });
  it('downloads a proposed file through the short-lived link to --out, never printing the link, and refuses to overwrite without --force', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'proposal-file-cli-'));
    const bytes = new TextEncoder().encode('%PDF-1.7\nreviewed\n');
    const url = 'https://storage.example.test/acme/file?X-Amz-Signature=secret-signature';
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response(bytes));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const out = join(directory, 'review.pdf');
      h.getChangeProposalFileLink.mockReset().mockResolvedValue(ok({ download: { url, expiresAt: '1998-08-01T00:01:00.000Z', fileName: 'workbook.pdf', sizeBytes: bytes.byteLength } }));
      await run('proposals', 'file', 'proposal-1', 'staged-1', '--out', out);
      expect(h.getChangeProposalFileLink).toHaveBeenCalledWith({ id: 'proposal-1', fileId: 'staged-1' });
      expect(fetchSpy).toHaveBeenCalledWith(url, { redirect: 'error', credentials: 'omit' });
      expect(new Uint8Array(await readFile(out))).toEqual(bytes);
      expect(logSpy).toHaveBeenCalledWith(`wrote workbook.pdf (${String(bytes.byteLength)} bytes) to ${out}`);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain('secret-signature');
      await writeFile(out, 'kept');
      logSpy.mockClear();
      fetchSpy.mockClear();
      await run('--json', 'proposals', 'file', 'proposal-1', 'staged-1', '--out', out);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'conflict' } });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await readFile(out, 'utf8')).toBe('kept');
      logSpy.mockClear();
      await run('--json', 'proposals', 'file', 'proposal-1', 'staged-1', '--out', out, '--force');
      expect(soleJson()).toEqual({ ok: true, data: { fileName: 'workbook.pdf', sizeBytes: bytes.byteLength, out } });
      expect(new Uint8Array(await readFile(out))).toEqual(bytes);
    } finally {
      vi.unstubAllGlobals();
      await rm(directory, { recursive: true });
    }
  });
  it('writes nothing when the proposed file is gone or the storage sends a different size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'proposal-file-cli-'));
    try {
      const out = join(directory, 'review.pdf');
      h.getChangeProposalFileLink.mockReset().mockResolvedValue(err(appError('not_found', 'No proposed file awaiting approval under this address')));
      await run('--json', 'proposals', 'file', 'proposal-1', 'staged-1', '--out', out);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
      logSpy.mockClear();
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(new Uint8Array(3))));
      h.getChangeProposalFileLink.mockReset().mockResolvedValue(ok({ download: { url: 'https://storage.example.test/f', expiresAt: '1998-08-01T00:01:00.000Z', fileName: 'workbook.pdf', sizeBytes: 9 } }));
      await run('--json', 'proposals', 'file', 'proposal-1', 'staged-1', '--out', out);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
      await expect(readFile(out)).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
      await rm(directory, { recursive: true });
    }
  });
  it('rejects a proposal with an optional note', async () => {
    h.rejectChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, status: 'rejected', decisionNote: 'Not now' } }));
    await run('--json', 'proposals', 'reject', 'proposal-1', '--note', 'Not now');
    expect(h.rejectChangeProposal).toHaveBeenCalledWith({ id: 'proposal-1', note: 'Not now' });
    expect(soleJson()).toMatchObject({ ok: true, data: { proposal: { status: 'rejected', decisionNote: 'Not now' } } });
    h.rejectChangeProposal.mockClear();
    await run('--json', 'proposals', 'reject', 'proposal-1');
    expect(h.rejectChangeProposal).toHaveBeenCalledWith({ id: 'proposal-1' });
  });
  it('approves a proposal and exits 0 when it was applied', async () => {
    h.approveChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, status: 'applied', appliedResourceId: 'product-1' } }));
    await run('proposals', 'approve', 'proposal-1');
    expect(h.approveChangeProposal).toHaveBeenCalledWith({ id: 'proposal-1' });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed.split('\n')[0]).toBe('applied: product product-1');
    expect(printed).toContain('  title: "Handbook" -> "Renamed"');
    expect(process.exitCode ?? 0).toBe(0);
  });
  it.each([
    ['stale', { status: 'stale' }, 'stale: the live state changed since this change was proposed; nothing was applied. The key can propose the change again from the current state.'],
    ['failed', { status: 'failed', failureCode: 'conflict', failureMessage: 'Stock cannot go below zero' }, 'failed: conflict: Stock cannot go below zero; nothing was applied'],
  ] as const)('prints a %s approval with its reason and exits with the conflict code', async (_status, fields, line) => {
    h.approveChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, ...fields } }));
    await run('proposals', 'approve', 'proposal-1');
    expect(String(logSpy.mock.calls[0]?.[0]).split('\n')[0]).toBe(line);
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
    logSpy.mockClear();
    process.exitCode = 0;
    await run('--json', 'proposals', 'approve', 'proposal-1');
    expect(soleJson()).toMatchObject({ ok: true, data: { proposal: fields } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });
  it.each([
    ['file', 'file_unavailable: The proposed file staged-1 is no longer available, so the proposal cannot be applied; nothing was changed'],
    ['image', 'image_unavailable: The proposed image /proposal-images/logo.png is no longer available, so the proposal cannot be applied; nothing was changed'],
  ] as const)('prints why an approval ended stale when its %s is gone, without the note code', async (_kind, note) => {
    h.approveChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, status: 'stale' } }));
    h.getChangeProposal.mockReset().mockResolvedValue(ok({ proposal: { ...ownerProposal, status: 'stale', events: [
      { sequence: 1, kind: 'proposed', actorUserId: null, apiKeyId: 'shop-key', note: null, at: '1998-08-01T00:00:00.000Z' },
      { sequence: 2, kind: 'stale', actorUserId: 'owner-1', apiKeyId: null, note, at: '1998-08-02T00:00:00.000Z' },
    ] } }));
    await run('proposals', 'approve', 'proposal-1');
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed.split('\n')[0]).toBe(`stale: ${note.slice(note.indexOf(': ') + 2)}`);
    expect(printed).not.toContain('_unavailable');
    expect(printed).not.toContain('the live state changed');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });
  it('answers a repeated approve with the conflict error and its exit code', async () => {
    h.approveChangeProposal.mockReset().mockResolvedValue(err(appError('conflict', 'This change proposal is no longer pending', { changeProposalStatus: 'applied' })));
    await run('--json', 'proposals', 'approve', 'proposal-1');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'applied' } } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });
});

const groupItem = (position: number, fields: Record<string, unknown> = {}) => ({
  ...ownerProposal, id: `proposal-${String(position)}`, groupId: 'group-1', groupTitle: 'Spring launch', groupPosition: position, events: [], ...fields,
});

const ownerGroup = (status: string, items: ReturnType<typeof groupItem>[]) => ({
  id: 'group-1', title: 'Spring launch', status,
  proposedBy: { keyId: 'shop-key', keyName: 'Catalogue agent', issuerUserId: 'owner-1', issuerEmail: 'owner@acme.example.test', issuerIsVerifiedOwner: true, keyState: 'active' },
  createdAt: '1998-08-01T00:00:00.000Z', expiresAt: '1998-08-31T00:00:00.000Z', items,
});

describe('owner change proposal group commands', () => {
  const pending = ownerGroup('open', [
    groupItem(1, { operation: 'product.create', target: { kind: 'product', id: null }, effect: { title: { before: null, after: 'Handbook' } } }),
    groupItem(2, { operation: 'price.create', input: { productId: '$proposal:proposal-1', kind: 'one_time', amountCents: 4900 }, effect: { activePrices: { before: [], after: [{ amountCents: 4900 }] } } }),
  ]);

  const shownDigest = changeProposalGroupItemsDigest(['proposal-1', 'proposal-2']);

  it('shows a group with its items in order, each effect, the items digest and the command that approves exactly them', async () => {
    h.getChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: pending }));
    await run('proposals', 'group', 'show', 'group-1');
    expect(h.getChangeProposalGroup).toHaveBeenCalledWith({ id: 'group-1' });
    const printed = String(logSpy.mock.calls[0]?.[0]).split('\n');
    expect(shownDigest).toMatch(/^[0-9a-f]{16}$/u);
    expect(printed.slice(-2)).toEqual([
      `items digest: ${shownDigest}`,
      `approve exactly these items with: together --tenant one proposals group approve group-1 --items-digest ${shownDigest}`,
    ]);
    expect(printed.slice(0, 6)).toEqual([
      'group group-1: Spring launch [open]',
      'proposed by key: Catalogue agent (shop-key, active), issued by owner-1',
      'created: 1998-08-01T00:00:00.000Z',
      'expires: 1998-08-31T00:00:00.000Z',
      'items: 2',
      'item 1: product.create [pending] product (new) (proposal-1)',
    ]);
    expect(printed.indexOf('item 2: price.create [pending] product product-1 (proposal-2)')).toBeGreaterThan(printed.indexOf('  title: null -> "Handbook"'));

    logSpy.mockClear();
    await run('--json', 'proposals', 'group', 'show', 'group-1');
    expect(soleJson()).toMatchObject({
      ok: true,
      data: { group: { id: 'group-1' }, itemsDigest: shownDigest, approveCommand: `together --tenant one proposals group approve group-1 --items-digest ${shownDigest}` },
    });
  });

  it.each([[[]], [['--json']]])('sends nothing when the group grew between show and approve (%j)', async (flags) => {
    const grown = ownerGroup('open', [...pending.items, groupItem(3, { operation: 'product.publish', input: { id: '$proposal:proposal-1' } })]);
    h.getChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: grown }));
    h.approveChangeProposalGroup.mockReset();
    await run(...flags, 'proposals', 'group', 'approve', 'group-1', '--items-digest', shownDigest);
    expect(h.approveChangeProposalGroup).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
    const grownDigest = changeProposalGroupItemsDigest(['proposal-1', 'proposal-2', 'proposal-3']);
    if (flags.length === 0) {
      const printed = String(logSpy.mock.calls[0]?.[0]);
      expect(printed.split('\n')[0]).toBe('the group now holds:');
      expect(printed).toContain('item 3: product.publish [pending]');
      expect(printed).toContain(`--items-digest ${grownDigest}`);
    } else {
      expect(soleJson()).toMatchObject({
        ok: false,
        error: { code: 'conflict', details: { changeProposalGroupItemIds: ['proposal-1', 'proposal-2', 'proposal-3'], itemsDigest: grownDigest } },
      });
    }
  });

  const withFile = ownerGroup('open', [
    pending.items[0] ?? groupItem(1),
    groupItem(2, { operation: 'download.add', input: { productId: '$proposal:proposal-1', stagedFileId: 'staged-1' }, effect: { files: { before: [], after: [{ id: 'staged-1' }] } },
      proposedFiles: [{ id: 'staged-1', available: true, copiedFrom: { productId: 'product-2', productTitle: 'Field guide', versionNumber: 2 } }] }),
  ]);
  const fileLines = [
    '  files:',
    '    staged-1: held by this proposal; copy of version 2 of Field guide (product-2)',
    '      download it with: together proposals file proposal-2 staged-1 --out <path>',
  ];

  it('shows, before the group is approved, which staged file an item attaches, that it is a copy and how to download it', async () => {
    h.getChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: withFile }));
    await run('proposals', 'group', 'show', 'group-1');
    const shown = String(logSpy.mock.calls[0]?.[0]).split('\n');
    const item = shown.indexOf('item 2: download.add [pending] product product-1 (proposal-2)');
    expect(shown.slice(item + 2, item + 5)).toEqual(fileLines);

    logSpy.mockClear();
    h.approveChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: ownerGroup('applied', [groupItem(1, { status: 'applied' }), groupItem(2, { status: 'applied' })]) }));
    await run('proposals', 'group', 'approve', 'group-1', '--items-digest', shownDigest);
    const approving = String(logSpy.mock.calls[0]?.[0]).split('\n');
    expect(approving[0]).toBe('approving:');
    expect(approving).toEqual(expect.arrayContaining(fileLines));
  });

  it('prints the item whose file is gone as the reason a group approval ended stale, without the note code', async () => {
    const note = 'file_unavailable: The proposed file staged-1 is no longer available, so the proposal cannot be applied; nothing was changed';
    h.getChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: withFile }));
    h.approveChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: ownerGroup('stale', [
      groupItem(1, { status: 'stale', events: [{ sequence: 2, kind: 'stale', actorUserId: 'owner-1', apiKeyId: null, note: 'Not applied: item 2 (proposal-2) of this group could not be applied, so nothing in the group was changed', at: '1998-08-02T00:00:00.000Z' }] }),
      groupItem(2, { status: 'stale', events: [{ sequence: 2, kind: 'stale', actorUserId: 'owner-1', apiKeyId: null, note, at: '1998-08-02T00:00:00.000Z' }] }),
    ]) }));
    await run('proposals', 'group', 'approve', 'group-1', '--items-digest', shownDigest);
    const outcome = String(logSpy.mock.calls[1]?.[0]);
    expect(outcome.split('\n')[0]).toBe('stale: item 2: The proposed file staged-1 is no longer available, so the proposal cannot be applied; nothing was changed; nothing in the group was applied');
    expect(outcome).not.toContain('file_unavailable');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('refuses an approval without a well-formed items digest before reading the group', async () => {
    h.getChangeProposalGroup.mockReset();
    h.approveChangeProposalGroup.mockReset();
    await run('--json', 'proposals', 'group', 'approve', 'group-1', '--items-digest', 'not-a-digest');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.getChangeProposalGroup).not.toHaveBeenCalled();
    expect(h.approveChangeProposalGroup).not.toHaveBeenCalled();
  });

  it('approves exactly the items it read and shown, in order, and exits 0 when the group was applied', async () => {
    h.getChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: pending }));
    h.approveChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: ownerGroup('applied', [
      groupItem(1, { status: 'applied', operation: 'product.create', appliedResourceId: 'product-9' }),
      groupItem(2, { status: 'applied', operation: 'price.create', appliedResourceId: 'price-9' }),
    ]) }));
    await run('proposals', 'group', 'approve', 'group-1', '--items-digest', shownDigest);
    expect(h.approveChangeProposalGroup).toHaveBeenCalledWith({ id: 'group-1', itemIds: ['proposal-1', 'proposal-2'] });
    expect(String(logSpy.mock.calls[0]?.[0]).split('\n')[0]).toBe('approving:');
    const outcome = String(logSpy.mock.calls[1]?.[0]);
    expect(outcome.split('\n')[0]).toBe('applied: all 2 items of the group');
    expect(outcome).toContain('  applied: product product-9');
    expect(outcome).toContain('  applied: price price-9');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it.each([
    ['stale', 'stale: an item no longer applies to the live state; nothing in the group was applied. The key can propose the group again from the current state.'],
    ['failed', 'failed: an item was refused by the live rules; nothing in the group was applied'],
  ] as const)('prints a %s group approval and exits with the conflict code', async (status, line) => {
    h.getChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: pending }));
    const note = 'Not applied: item 2 (proposal-2) of this group could not be applied, so nothing in the group was changed';
    h.approveChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: ownerGroup(status, [
      groupItem(1, { status: 'stale', events: [{ sequence: 2, kind: 'stale', actorUserId: 'owner-1', apiKeyId: null, note, at: '1998-08-02T00:00:00.000Z' }] }),
      groupItem(2, status === 'failed' ? { status: 'failed', failureCode: 'conflict', failureMessage: 'Stock cannot go below zero' } : { status: 'stale' }),
    ]) }));
    await run('proposals', 'group', 'approve', 'group-1', '--items-digest', shownDigest);
    const outcome = String(logSpy.mock.calls[1]?.[0]);
    expect(outcome.split('\n')[0]).toBe(line);
    expect(outcome).toContain(`  stale: ${note}`);
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
    logSpy.mockClear();
    process.exitCode = 0;
    await run('--json', 'proposals', 'group', 'approve', 'group-1', '--items-digest', shownDigest);
    expect(soleJson()).toMatchObject({ ok: true, data: { group: { status } } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('sends nothing when the group cannot be read', async () => {
    h.getChangeProposalGroup.mockReset().mockResolvedValue(err(appError('not_found', 'No change proposal group "group-1" in this workspace')));
    h.approveChangeProposalGroup.mockReset();
    await run('--json', 'proposals', 'group', 'approve', 'group-1', '--items-digest', shownDigest);
    expect(h.approveChangeProposalGroup).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.not_found);
  });

  it('answers an approval of items that changed since they were read with the conflict error', async () => {
    h.getChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: pending }));
    h.approveChangeProposalGroup.mockReset().mockResolvedValue(err(appError('conflict', 'The items of this group differ from the ones you were shown', { changeProposalGroupItemIds: ['proposal-1', 'proposal-2', 'proposal-3'] })));
    await run('--json', 'proposals', 'group', 'approve', 'group-1', '--items-digest', shownDigest);
    expect(h.approveChangeProposalGroup).toHaveBeenCalledWith({ id: 'group-1', itemIds: ['proposal-1', 'proposal-2'] });
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupItemIds: ['proposal-1', 'proposal-2', 'proposal-3'] } } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('rejects a whole group with an optional note', async () => {
    h.rejectChangeProposalGroup.mockReset().mockResolvedValue(ok({ group: ownerGroup('rejected', [groupItem(1, { status: 'rejected', decisionNote: 'Not now' })]) }));
    await run('--json', 'proposals', 'group', 'reject', 'group-1', '--note', 'Not now');
    expect(h.rejectChangeProposalGroup).toHaveBeenCalledWith({ id: 'group-1', note: 'Not now' });
    expect(soleJson()).toMatchObject({ ok: true, data: { group: { status: 'rejected' } } });
    h.rejectChangeProposalGroup.mockClear();
    await run('--json', 'proposals', 'group', 'reject', 'group-1');
    expect(h.rejectChangeProposalGroup).toHaveBeenCalledWith({ id: 'group-1' });
  });
});
