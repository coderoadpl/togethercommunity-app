import { type z } from 'zod';

import {
  API_ROUTES,
  looseEnvelopeSchema,
  apiKeyCreateOutputSchema,
  apiKeyRevokeOutputSchema,
  apiKeysListOutputSchema,
  authConfigOutputSchema,
  bunnyTestConnectionOutputSchema,
  bunnyVideosOutputSchema,
  courseOutputSchema,
  checkoutSessionOutputSchema,
  couponCheckoutValidationOutputSchema,
  couponOutputSchema,
  couponOptionsOutputSchema,
  couponStatsDetailOutputSchema,
  couponStatsExportOutputSchema,
  couponStatsOutputSchema,
  courseStructureOutputSchema,
  coursesListOutputSchema,
  contentHistoryOutputSchema,
  contentVersionOutputSchema,
  devGrantOutputSchema,
  devEmailOutputSchema,
  devMagicLinkOutputSchema,
  grantCreateOutputSchema,
  grantRevokeOutputSchema,
  healthOutputSchema,
  healthLiveOutputSchema,
  healthReadyOutputSchema,
  ifirmaTestConnectionOutputSchema,
  ksefTestConnectionOutputSchema,
  emailDispatchOutputSchema,
  EMAIL_DISPATCH_SECRET_HEADER,
  lessonOutputSchema,
  lessonsListOutputSchema,
  lessonReferencesOutputSchema,
  lessonDeleteOutputSchema,
  m2mEnrollOutputSchema,
  marketingConsentDefinitionOutputSchema,
  marketingConsentDefinitionDetailOutputSchema,
  marketingConsentDefinitionsOutputSchema,
  marketingAudiencePreviewOutputSchema,
  marketingCampaignOutputSchema,
  marketingCampaignDetailOutputSchema,
  marketingCampaignsOutputSchema,
  marketingCampaignTestOutputSchema,
  marketingDocumentDetailOutputSchema,
  marketingDocumentsOutputSchema,
  marketingLayoutOutputSchema,
  marketingLayoutsOutputSchema,
  marketingSesSettingsOutputSchema,
  marketingSesIdentityStartOutputSchema,
  marketingSesOnboardingStatusSchema,
  marketingSesProvisionOutputSchema,
  marketingSesSimulatorOutputSchema,
  marketingSmtpTestOutputSchema,
  marketingReputationOutputSchema,
  marketingSuppressionOutputSchema,
  marketingSuppressionsOutputSchema,
  emailSendDetailOutputSchema,
  emailSendsExportOutputSchema,
  emailSendsOutputSchema,
  memberEmailSendsOutputSchema,
  globalSchedulerRunOutputSchema,
  globalSchedulerRunsOutputSchema,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  tenantSchedulerRunOutputSchema,
  tenantSchedulerRunsOutputSchema,
  meOutputSchema,
  memberBillingOrdersOutputSchema,
  memberGrantsOutputSchema,
  memberLearningSummaryOutputSchema,
  memberProgressResetOutputSchema,
  memberRemoveOutputSchema,
  membersListOutputSchema,
  membersExportOutputSchema,
  moduleOutputSchema,
  modulesListOutputSchema,
  myProductsOutputSchema,
  nextLessonOutputSchema,
  notificationReadOutputSchema,
  notificationsListOutputSchema,
  notificationsReadAllOutputSchema,
  notificationsUnreadOutputSchema,
  ordersListOutputSchema,
  ordersReconciliationOutputSchema,
  orderDetailOutputSchema,
  invoiceOutputSchema,
  ordersExportOutputSchema,
  productPriceCreateOutputSchema,
  productPriceDeactivateOutputSchema,
  productPricesListOutputSchema,
  salesSummaryOutputSchema,
  subscriptionSimulateOutputSchema,
  discussionOutputSchema,
  postOutputSchema,
  postPinOutputSchema,
  postReportOutputSchema,
  reportResolveOutputSchema,
  reportsListOutputSchema,
  postReactOutputSchema,
  postsSearchOutputSchema,
  spaceDeleteOutputSchema,
  spaceFeedOutputSchema,
  spaceFollowOutputSchema,
  spaceOutputSchema,
  spacesListOutputSchema,
  staffSpacesListOutputSchema,
  productsAccessItemsOutputSchema,
  productsAccessIssuesOutputSchema,
  progressOutputSchema,
  publicOfferOutputSchema,
  publicPaymentConfigOutputSchema,
  productsCreateOutputSchema,
  productsListOutputSchema,
  productsPublishOutputSchema,
  simulatePurchaseOutputSchema,
  stripeTestConnectionOutputSchema,
  stripeWebhookOutputSchema,
  studentCoursesOutputSchema,
  studentLessonOutputSchema,
  supportMessageOutputSchema,
  tenantCreateOutputSchema,
  tenantListOutputSchema,
  tenantSecretsListOutputSchema,
  tenantSecretSetOutputSchema,
  tenantSecretDeleteOutputSchema,
  tenantSettingsOutputSchema,
  termsConsentOutputSchema,
  onboardingOutputSchema,
  threadSubscriptionOutputSchema,
  type ApiKeyCreateInput,
  type ApiKeyRevokeInput,
  type CourseCreateInput,
  type CheckoutSessionRequest,
  type CouponCheckoutValidationRequest,
  type CouponArchiveRequest,
  type CouponCreateRequest,
  type CouponStatsExportQueryInput,
  type CouponStatsQueryInput,
  type CourseUpdateInput,
  type GrantCreateInput,
  type GrantRevokeInput,
  type HttpMethod,
  type LastViewedInput,
  type LessonCompleteInput,
  type LessonUncompleteInput,
  type MemberProgressResetInput,
  type LessonCreateInput,
  type LessonUpdateInput,
  type M2mEnrollRequest,
  type MarketingConsentDefinitionCreateInput,
  type MarketingConsentDefinitionUpdateInput,
  type MarketingAudiencePreviewInput,
  type MarketingCampaignCreateInput,
  type MarketingCampaignActionInput,
  type MarketingCampaignScheduleInput,
  type MarketingCampaignUpdateInput,
  type MarketingDocumentCreateInput,
  type MarketingDocumentPublishInput,
  type MarketingDocumentUpdateInput,
  type MarketingLayoutSaveInput,
  type MarketingSesSettingsUpdateInput,
  type MarketingSesIdentityStartInput,
  type MarketingSuppressionCreateInput,
  type EmailSendsExportQueryInput,
  type EmailSendsQueryInput,
  type SchedulerRunsQueryInput,
  type MemberRemoveInput,
  type ModuleAttachInput,
  type ModuleDetachInput,
  type ModuleCreateInput,
  type ModuleUpdateInput,
  type NotificationReadInput,
  type NotificationsListInput,
  type OrdersListQueryInput,
  type OrdersReconciliationQueryInput,
  type OrdersExportQueryInput,
  type ProductPriceCreateInput,
  type ProductPriceDeactivateInput,
  type SubscriptionSimulateInput,
  type DiscussionGetInput,
  type PostCreateInput,
  type PostDeleteInput,
  type PostPinInput,
  type PostReportInput,
  type ReportResolveInput,
  type ReportsListInput,
  type PostReactInput,
  type PostUpdateInput,
  type PostsSearchInput,
  type SpaceArchiveInput,
  type SpaceCreateInput,
  type SpaceDeleteInput,
  type SpaceFeedGetInput,
  type SpaceFollowInput,
  type SpaceUpdateInput,
  type SupportMessageInput,
  type ProductsAccessItemsInput,
  type ProductsPublishInput,
  type ReadMethod,
  type SimulatePurchaseInput,
  type TenantCreateInput,
  type TenantSecretDeleteInput,
  type TenantSecretSetInput,
  type TenantSettingsUpdateInput,
  type TermsConsentRequest,
  type WriteMethod,
} from '#core/contract/index.js';
import {
  err,
  internal,
  ok,
  type AppError,
  type DevGrantInput,
  type MemberExportFormat,
  type NewProductInput,
  type Result,
} from '#core/domain/index.js';

declare const HTTP_METHOD_BRAND: unique symbol;

/**
 * Phantom read/write tag on a call's result, driven by the contract's HTTP
 * method. Optional and never assigned at runtime (zero cost, no `as`): a plain
 * `Result` is assignable, yet a `'GET'`-tagged result is not assignable to a
 * `'POST'`-tagged one, so `defineQuery`/`defineMutation` can reject mismatches.
 */
type Branded<T, M extends HttpMethod> = T & { readonly [HTTP_METHOD_BRAND]?: M };
export type ReadResult<T> = Branded<Result<T, AppError>, ReadMethod>;
export type WriteResult<T> = Branded<Result<T, AppError>, WriteMethod>;

/** Same-origin SSE endpoint for the browser EventSource wrapper. */
export const NOTIFICATIONS_STREAM_PATH = API_ROUTES.notificationsStream.path;

export interface ApiClientOptions {
  /** '' for same-origin (web); absolute URL for CLI and other clients. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Extra headers per request: Authorization bearer token, X-Tenant, ... */
  headers?: () => Record<string, string>;
  /**
   * W3C `traceparent` for the currently active span, or `undefined` when no
   * trace is active. Injected header-provider (bound in the composition root)
   * rather than an in-core OTel dependency: keeps `core/client` framework- and
   * SDK-free and makes propagation trivially testable by passing a stub.
   */
  traceparent?: () => string | undefined;
}

const request = async <S extends z.ZodTypeAny, M extends HttpMethod>(
  options: ApiClientOptions,
  method: M,
  path: string,
  outputSchema: S,
  body?: unknown,
  signal?: AbortSignal,
  raw?: { body?: string; headers: Record<string, string> },
): Promise<Branded<Result<z.output<S>, AppError>, M>> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const traceparent = options.traceparent?.();
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined && raw?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(traceparent === undefined ? {} : { traceparent }),
        ...options.headers?.(),
        ...raw?.headers,
      },
      body: raw?.body ?? (body === undefined ? null : JSON.stringify(body)),
      credentials: 'include',
      signal: signal ?? null,
    });
  } catch (cause) {
    return err(internal(`Network error calling ${path}: ${String(cause)}`));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return err(internal(`Non-JSON response from ${path} (HTTP ${response.status})`));
  }

  const envelope = looseEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return err(internal(`Response from ${path} does not match the contract envelope`));
  }
  if (!envelope.data.ok) return err(envelope.data.error);

  const data = outputSchema.safeParse(envelope.data.data);
  if (!data.success) {
    return err(internal(`Response data from ${path} does not match the contract`));
  }
  return ok(data.data);
};

/** The single typed gateway to the API. No client ever hand-writes HTTP. */
export const createApiClient = (options: ApiClientOptions) => ({
  health: (signal?: AbortSignal) =>
    request(options, API_ROUTES.health.method, API_ROUTES.health.path, healthOutputSchema, undefined, signal),
  healthLive: (signal?: AbortSignal) =>
    request(options, API_ROUTES.healthLive.method, API_ROUTES.healthLive.path, healthLiveOutputSchema, undefined, signal),
  healthReady: (signal?: AbortSignal) =>
    request(options, API_ROUTES.healthReady.method, API_ROUTES.healthReady.path, healthReadyOutputSchema, undefined, signal),
  listMarketingConsentDefinitions: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingConsentDefinitions.method, API_ROUTES.marketingConsentDefinitions.path, marketingConsentDefinitionsOutputSchema, undefined, signal),
  createMarketingConsentDefinition: (input: MarketingConsentDefinitionCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingConsentDefinitionsCreate.method, API_ROUTES.marketingConsentDefinitionsCreate.path, marketingConsentDefinitionOutputSchema, input, signal),
  getMarketingConsentDefinition: (id: string, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingConsentDefinition.method, API_ROUTES.marketingConsentDefinition.path.replace(':id', encodeURIComponent(id)), marketingConsentDefinitionDetailOutputSchema, undefined, signal),
  updateMarketingConsentDefinition: (input: MarketingConsentDefinitionUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingConsentDefinitionUpdate.method, API_ROUTES.marketingConsentDefinitionUpdate.path, marketingConsentDefinitionDetailOutputSchema, input, signal),
  listMarketingCampaigns: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingCampaigns.method, API_ROUTES.marketingCampaigns.path, marketingCampaignsOutputSchema, undefined, signal),
  createMarketingCampaign: (input: MarketingCampaignCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingCampaignsCreate.method, API_ROUTES.marketingCampaignsCreate.path, marketingCampaignOutputSchema, input, signal),
  scheduleMarketingCampaign: (input: MarketingCampaignScheduleInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingCampaignSchedule.method, API_ROUTES.marketingCampaignSchedule.path, marketingCampaignOutputSchema, input, signal),
  getMarketingCampaign: (id: string, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingCampaign.method, API_ROUTES.marketingCampaign.path.replace(':id', encodeURIComponent(id)), marketingCampaignDetailOutputSchema, undefined, signal),
  updateMarketingCampaign: (input: MarketingCampaignUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingCampaignUpdate.method, API_ROUTES.marketingCampaignUpdate.path, marketingCampaignOutputSchema, input, signal),
  actOnMarketingCampaign: (input: MarketingCampaignActionInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingCampaignAction.method, API_ROUTES.marketingCampaignAction.path, marketingCampaignOutputSchema, input, signal),
  testMarketingCampaign: (input: { campaignId: string }, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingCampaignTest.method, API_ROUTES.marketingCampaignTest.path, marketingCampaignTestOutputSchema, input, signal),
  previewMarketingAudience: (input: MarketingAudiencePreviewInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingAudiencePreview.method, API_ROUTES.marketingAudiencePreview.path, marketingAudiencePreviewOutputSchema, input, signal),
  listMarketingDocuments: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingDocuments.method, API_ROUTES.marketingDocuments.path, marketingDocumentsOutputSchema, undefined, signal),
  createMarketingDocument: (input: MarketingDocumentCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingDocumentsCreate.method, API_ROUTES.marketingDocumentsCreate.path, marketingDocumentDetailOutputSchema, input, signal),
  getMarketingDocument: (id: string, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingDocument.method, API_ROUTES.marketingDocument.path.replace(':id', encodeURIComponent(id)), marketingDocumentDetailOutputSchema, undefined, signal),
  updateMarketingDocument: (input: MarketingDocumentUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingDocumentUpdate.method, API_ROUTES.marketingDocumentUpdate.path, marketingDocumentDetailOutputSchema, input, signal),
  publishMarketingDocument: (input: MarketingDocumentPublishInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingDocumentPublish.method, API_ROUTES.marketingDocumentPublish.path, marketingDocumentDetailOutputSchema, input, signal),
  listMarketingLayouts: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingLayouts.method, API_ROUTES.marketingLayouts.path, marketingLayoutsOutputSchema, undefined, signal),
  saveMarketingLayout: (input: MarketingLayoutSaveInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingLayoutsSave.method, API_ROUTES.marketingLayoutsSave.path, marketingLayoutOutputSchema, input, signal),
  getMarketingSesSettings: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingSesSettings.method, API_ROUTES.marketingSesSettings.path, marketingSesSettingsOutputSchema, undefined, signal),
  pollMarketingSesOnboarding: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingSesOnboarding.method, API_ROUTES.marketingSesOnboarding.path, marketingSesOnboardingStatusSchema, {}, signal),
  startMarketingSesIdentity: (input: MarketingSesIdentityStartInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingSesIdentityStart.method, API_ROUTES.marketingSesIdentityStart.path, marketingSesIdentityStartOutputSchema, input, signal),
  provisionMarketingSes: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingSesProvision.method, API_ROUTES.marketingSesProvision.path, marketingSesProvisionOutputSchema, {}, signal),
  testMarketingSesSimulator: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingSesSimulator.method, API_ROUTES.marketingSesSimulator.path, marketingSesSimulatorOutputSchema, {}, signal),
  getMarketingReputation: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingReputation.method, API_ROUTES.marketingReputation.path, marketingReputationOutputSchema, undefined, signal),
  updateMarketingSesSettings: (input: MarketingSesSettingsUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingSesSettingsUpdate.method, API_ROUTES.marketingSesSettingsUpdate.path, marketingSesSettingsOutputSchema, input, signal),
  testMarketingSmtp: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingSmtpTest.method, API_ROUTES.marketingSmtpTest.path, marketingSmtpTestOutputSchema, {}, signal),
  listMarketingSuppressions: (signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingStaffSuppressions.method, API_ROUTES.marketingStaffSuppressions.path, marketingSuppressionsOutputSchema, undefined, signal),
  addMarketingSuppression: (input: MarketingSuppressionCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.marketingStaffSuppressionsCreate.method, API_ROUTES.marketingStaffSuppressionsCreate.path, marketingSuppressionOutputSchema, input, signal),
  listEmailSends: (input: EmailSendsQueryInput = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.kind !== undefined) params.set('kind', input.kind);
    if (input.status !== undefined) params.set('status', input.status);
    if (input.deliveryStatus !== undefined) params.set('deliveryStatus', input.deliveryStatus);
    if (input.transport !== undefined) params.set('transport', input.transport);
    if (input.campaignId !== undefined) params.set('campaignId', input.campaignId);
    if (input.runId !== undefined) params.set('runId', input.runId);
    if (input.search !== undefined) params.set('search', input.search);
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.emailSends.method,
      suffix.length > 0 ? `${API_ROUTES.emailSends.path}?${suffix}` : API_ROUTES.emailSends.path,
      emailSendsOutputSchema,
      undefined,
      signal,
    );
  },
  listTenantSchedulerRuns: (input: SchedulerRunsQueryInput = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.kind !== undefined) params.set('kind', input.kind);
    if (input.status !== undefined) params.set('status', input.status);
    if (input.since !== undefined) params.set('since', input.since);
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.tenantSchedulerRuns.method,
      suffix.length > 0 ? `${API_ROUTES.tenantSchedulerRuns.path}?${suffix}` : API_ROUTES.tenantSchedulerRuns.path,
      tenantSchedulerRunsOutputSchema,
      undefined,
      signal,
    );
  },
  getTenantSchedulerRun: (id: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantSchedulerRun.method,
      API_ROUTES.tenantSchedulerRun.path.replace(':id', encodeURIComponent(id)),
      tenantSchedulerRunOutputSchema,
      undefined,
      signal,
    ),
  listGlobalSchedulerRuns: (input: SchedulerRunsQueryInput, secret: string, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.kind !== undefined) params.set('kind', input.kind);
    if (input.status !== undefined) params.set('status', input.status);
    if (input.since !== undefined) params.set('since', input.since);
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.globalSchedulerRuns.method,
      suffix.length > 0 ? `${API_ROUTES.globalSchedulerRuns.path}?${suffix}` : API_ROUTES.globalSchedulerRuns.path,
      globalSchedulerRunsOutputSchema,
      undefined,
      signal,
      { headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: secret } },
    );
  },
  getGlobalSchedulerRun: (id: string, secret: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.globalSchedulerRun.method,
      API_ROUTES.globalSchedulerRun.path.replace(':id', encodeURIComponent(id)),
      globalSchedulerRunOutputSchema,
      undefined,
      signal,
      { headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: secret } },
    ),
  getEmailSend: (kind: 'transactional' | 'marketing', id: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.emailSend.method,
      API_ROUTES.emailSend.path
        .replace(':kind', encodeURIComponent(kind))
        .replace(':id', encodeURIComponent(id)),
      emailSendDetailOutputSchema,
      undefined,
      signal,
    ),
  exportEmailSends: (input: EmailSendsExportQueryInput, signal?: AbortSignal) => {
    const params = new URLSearchParams({ format: input.format });
    if (input.kind !== undefined) params.set('kind', input.kind);
    if (input.status !== undefined) params.set('status', input.status);
    if (input.deliveryStatus !== undefined) params.set('deliveryStatus', input.deliveryStatus);
    if (input.campaignId !== undefined) params.set('campaignId', input.campaignId);
    if (input.runId !== undefined) params.set('runId', input.runId);
    if (input.search !== undefined) params.set('search', input.search);
    return request(
      options,
      API_ROUTES.emailSendsExport.method,
      `${API_ROUTES.emailSendsExport.path}?${params.toString()}`,
      emailSendsExportOutputSchema,
      undefined,
      signal,
    );
  },
  listMemberEmailSends: (memberId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.memberEmailSends.method,
      API_ROUTES.memberEmailSends.path.replace(':id', encodeURIComponent(memberId)),
      memberEmailSendsOutputSchema,
      undefined,
      signal,
    ),
  dispatchEmail: (secret: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.emailDispatch.method,
      API_ROUTES.emailDispatch.path,
      emailDispatchOutputSchema,
      undefined,
      signal,
      { body: '', headers: { [EMAIL_DISPATCH_SECRET_HEADER]: secret } },
    ),
  publicOffer: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.publicOffer.method,
      API_ROUTES.publicOffer.path,
      publicOfferOutputSchema,
      undefined,
      signal,
    ),
  publicPaymentConfig: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.publicPaymentConfig.method,
      API_ROUTES.publicPaymentConfig.path,
      publicPaymentConfigOutputSchema,
      undefined,
      signal,
    ),
  createCheckoutSession: (input: CheckoutSessionRequest, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.checkoutSession.method,
      API_ROUTES.checkoutSession.path,
      checkoutSessionOutputSchema,
      input,
      signal,
    ),
  validateCouponForCheckout: (input: CouponCheckoutValidationRequest, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.couponCheckoutValidation.method,
      API_ROUTES.couponCheckoutValidation.path,
      couponCheckoutValidationOutputSchema,
      input,
      signal,
    ),
  recordTermsConsent: (input: TermsConsentRequest, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.termsConsent.method,
      API_ROUTES.termsConsent.path,
      termsConsentOutputSchema,
      input,
      signal,
    ),
  deliverStripeWebhook: (tenantId: string, payloadRaw: string, signatureHeader: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.stripeWebhook.method,
      API_ROUTES.stripeWebhook.path.replace(':tenantId', encodeURIComponent(tenantId)),
      stripeWebhookOutputSchema,
      undefined,
      signal,
      { body: payloadRaw, headers: { 'stripe-signature': signatureHeader } },
    ),
  authConfig: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.authConfig.method,
      API_ROUTES.authConfig.path,
      authConfigOutputSchema,
      undefined,
      signal,
    ),
  me: (signal?: AbortSignal) =>
    request(options, API_ROUTES.me.method, API_ROUTES.me.path, meOutputSchema, undefined, signal),
  listMemberBillingOrders: (page = 1, pageSize = 25, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return request(
      options,
      API_ROUTES.memberBillingOrders.method,
      `${API_ROUTES.memberBillingOrders.path}?${params.toString()}`,
      memberBillingOrdersOutputSchema,
      undefined,
      signal,
    );
  },
  listTenants: (signal?: AbortSignal) =>
    request(options, API_ROUTES.tenants.method, API_ROUTES.tenants.path, tenantListOutputSchema, undefined, signal),
  createTenant: (input: TenantCreateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantsCreate.method,
      API_ROUTES.tenantsCreate.path,
      tenantCreateOutputSchema,
      input,
      signal,
    ),
  listProducts: (signal?: AbortSignal) =>
    request(options, API_ROUTES.products.method, API_ROUTES.products.path, productsListOutputSchema, undefined, signal),
  createProduct: (input: NewProductInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productsCreate.method,
      API_ROUTES.productsCreate.path,
      productsCreateOutputSchema,
      input,
      signal,
    ),
  publishProduct: (input: ProductsPublishInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productsPublish.method,
      API_ROUTES.productsPublish.path,
      productsPublishOutputSchema,
      input,
      signal,
    ),
  listProductPrices: (productId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productPrices.method,
      API_ROUTES.productPrices.path.replace(':productId', encodeURIComponent(productId)),
      productPricesListOutputSchema,
      undefined,
      signal,
    ),
  createProductPrice: (input: ProductPriceCreateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productPricesCreate.method,
      API_ROUTES.productPricesCreate.path,
      productPriceCreateOutputSchema,
      input,
      signal,
    ),
  deactivateProductPrice: (input: ProductPriceDeactivateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productPriceDeactivate.method,
      API_ROUTES.productPriceDeactivate.path,
      productPriceDeactivateOutputSchema,
      input,
      signal,
    ),
  listOrders: (input: OrdersListQueryInput = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.status !== undefined) params.set('status', input.status);
    if (input.productId !== undefined) params.set('productId', input.productId);
    if (input.kind !== undefined) params.set('kind', input.kind);
    if (input.couponId !== undefined) params.set('couponId', input.couponId);
    if (input.search !== undefined) params.set('search', input.search);
    if (input.page !== undefined) params.set('page', String(input.page));
    if (input.pageSize !== undefined) params.set('pageSize', String(input.pageSize));
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.orders.method,
      suffix.length > 0 ? `${API_ROUTES.orders.path}?${suffix}` : API_ROUTES.orders.path,
      ordersListOutputSchema,
      undefined,
      signal,
    );
  },
  listOrderReconciliation: (
    input: OrdersReconciliationQueryInput = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (input.minAgeMinutes !== undefined) {
      params.set('minAgeMinutes', String(input.minAgeMinutes));
    }
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.ordersReconciliation.method,
      suffix.length > 0
        ? `${API_ROUTES.ordersReconciliation.path}?${suffix}`
        : API_ROUTES.ordersReconciliation.path,
      ordersReconciliationOutputSchema,
      undefined,
      signal,
    );
  },
  getOrder: (id: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.order.method,
      API_ROUTES.order.path.replace(':orderId', encodeURIComponent(id)),
      orderDetailOutputSchema,
      undefined,
      signal,
    ),
  issueInvoice: (orderId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.invoiceIssue.method,
      API_ROUTES.invoiceIssue.path.replace(':orderId', encodeURIComponent(orderId)),
      invoiceOutputSchema,
      {},
      signal,
    ),
  refreshInvoice: (invoiceId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.invoiceRefresh.method,
      API_ROUTES.invoiceRefresh.path.replace(':invoiceId', encodeURIComponent(invoiceId)),
      invoiceOutputSchema,
      {},
      signal,
    ),
  exportOrders: (input: OrdersExportQueryInput, signal?: AbortSignal) => {
    const params = new URLSearchParams({ format: input.format });
    if (input.status !== undefined) params.set('status', input.status);
    if (input.productId !== undefined) params.set('productId', input.productId);
    if (input.kind !== undefined) params.set('kind', input.kind);
    if (input.couponId !== undefined) params.set('couponId', input.couponId);
    if (input.search !== undefined) params.set('search', input.search);
    return request(
      options,
      API_ROUTES.ordersExport.method,
      `${API_ROUTES.ordersExport.path}?${params.toString()}`,
      ordersExportOutputSchema,
      undefined,
      signal,
    );
  },
  salesSummary: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.salesSummary.method,
      API_ROUTES.salesSummary.path,
      salesSummaryOutputSchema,
      undefined,
      signal,
    ),
  listCouponStats: (input: CouponStatsQueryInput = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.partnerLabel !== undefined) params.set('partnerLabel', input.partnerLabel);
    if (input.cursorCreatedAt !== undefined) params.set('cursorCreatedAt', input.cursorCreatedAt);
    if (input.cursorId !== undefined) params.set('cursorId', input.cursorId);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.since !== undefined) params.set('since', input.since);
    if (input.through !== undefined) params.set('through', input.through);
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.couponStats.method,
      suffix === '' ? API_ROUTES.couponStats.path : `${API_ROUTES.couponStats.path}?${suffix}`,
      couponStatsOutputSchema,
      undefined,
      signal,
    );
  },
  listCouponOptions: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.couponOptions.method,
      API_ROUTES.couponOptions.path,
      couponOptionsOutputSchema,
      undefined,
      signal,
    ),
  getCouponStats: (id: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.couponStatsDetail.method,
      API_ROUTES.couponStatsDetail.path.replace(':couponId', encodeURIComponent(id)),
      couponStatsDetailOutputSchema,
      undefined,
      signal,
    ),
  createCoupon: (input: CouponCreateRequest, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.couponsCreate.method,
      API_ROUTES.couponsCreate.path,
      couponOutputSchema,
      input,
      signal,
    ),
  archiveCoupon: (input: CouponArchiveRequest, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.couponArchive.method,
      API_ROUTES.couponArchive.path,
      couponOutputSchema,
      input,
      signal,
    ),
  exportCouponStats: (input: CouponStatsExportQueryInput, signal?: AbortSignal) => {
    const params = new URLSearchParams({ format: input.format });
    if (input.partnerLabel !== undefined) params.set('partnerLabel', input.partnerLabel);
    if (input.since !== undefined) params.set('since', input.since);
    if (input.through !== undefined) params.set('through', input.through);
    return request(
      options,
      API_ROUTES.couponStatsExport.method,
      `${API_ROUTES.couponStatsExport.path}?${params.toString()}`,
      couponStatsExportOutputSchema,
      undefined,
      signal,
    );
  },
  simulateSubscriptionCycle: (input: SubscriptionSimulateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.devSubscriptionSimulateCycle.method,
      API_ROUTES.devSubscriptionSimulateCycle.path,
      subscriptionSimulateOutputSchema,
      input,
      signal,
    ),
  simulateSubscriptionFailure: (input: SubscriptionSimulateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.devSubscriptionSimulateFailure.method,
      API_ROUTES.devSubscriptionSimulateFailure.path,
      subscriptionSimulateOutputSchema,
      input,
      signal,
    ),
  myProducts: (signal?: AbortSignal) =>
    request(options, API_ROUTES.myProducts.method, API_ROUTES.myProducts.path, myProductsOutputSchema, undefined, signal),
  listMembers: (signal?: AbortSignal) =>
    request(options, API_ROUTES.members.method, API_ROUTES.members.path, membersListOutputSchema, undefined, signal),
  exportMembers: (format: MemberExportFormat, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.membersExport.method,
      `${API_ROUTES.membersExport.path}?format=${encodeURIComponent(format)}`,
      membersExportOutputSchema,
      undefined,
      signal,
    ),
  removeMember: (input: MemberRemoveInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.memberRemove.method,
      API_ROUTES.memberRemove.path.replace(':memberId', encodeURIComponent(input.memberId)),
      memberRemoveOutputSchema,
      undefined,
      signal,
    ),
  listMemberGrants: (memberId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.memberGrants.method,
      API_ROUTES.memberGrants.path.replace(':memberId', encodeURIComponent(memberId)),
      memberGrantsOutputSchema,
      undefined,
      signal,
    ),
  memberLearningSummary: (memberId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.memberLearningSummary.method,
      API_ROUTES.memberLearningSummary.path.replace(':memberId', encodeURIComponent(memberId)),
      memberLearningSummaryOutputSchema,
      undefined,
      signal,
    ),
  resetMemberProgress: (input: MemberProgressResetInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.memberProgressReset.method,
      API_ROUTES.memberProgressReset.path.replace(':memberId', encodeURIComponent(input.memberId)),
      memberProgressResetOutputSchema,
      { courseId: input.courseId },
      signal,
    ),
  grantProductToMember: (input: GrantCreateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.grantsCreate.method,
      API_ROUTES.grantsCreate.path,
      grantCreateOutputSchema,
      input,
      signal,
    ),
  revokeGrant: (input: GrantRevokeInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.grantRevoke.method,
      API_ROUTES.grantRevoke.path.replace(':grantId', encodeURIComponent(input.grantId)),
      grantRevokeOutputSchema,
      undefined,
      signal,
    ),
  simulatePurchase: (input: SimulatePurchaseInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.devSimulatePurchase.method,
      API_ROUTES.devSimulatePurchase.path,
      simulatePurchaseOutputSchema,
      input,
      signal,
    ),
  devMagicLink: (email: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.devMagicLink.method,
      `${API_ROUTES.devMagicLink.path}?email=${encodeURIComponent(email)}`,
      devMagicLinkOutputSchema,
      undefined,
      signal,
    ),
  devEmail: (to: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.devEmail.method,
      `${API_ROUTES.devEmail.path}?to=${encodeURIComponent(to)}`,
      devEmailOutputSchema,
      undefined,
      signal,
    ),
  updateProductAccessItems: (input: ProductsAccessItemsInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productsAccessItems.method,
      API_ROUTES.productsAccessItems.path,
      productsAccessItemsOutputSchema,
      input,
      signal,
    ),
  listProductAccessIssues: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productsAccessIssues.method,
      API_ROUTES.productsAccessIssues.path,
      productsAccessIssuesOutputSchema,
      undefined,
      signal,
    ),
  listCourses: (signal?: AbortSignal) =>
    request(options, API_ROUTES.courses.method, API_ROUTES.courses.path, coursesListOutputSchema, undefined, signal),
  createCourse: (input: CourseCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.coursesCreate.method, API_ROUTES.coursesCreate.path, courseOutputSchema, input, signal),
  updateCourse: (input: CourseUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.coursesUpdate.method, API_ROUTES.coursesUpdate.path, courseOutputSchema, input, signal),
  listContentHistory: (
    input: { courseId: string; limit?: number },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ courseId: input.courseId });
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    return request(
      options,
      API_ROUTES.coursesHistory.method,
      `${API_ROUTES.coursesHistory.path}?${params.toString()}`,
      contentHistoryOutputSchema,
      undefined,
      signal,
    );
  },
  getContentVersion: (id: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.coursesHistoryVersion.method,
      `${API_ROUTES.coursesHistoryVersion.path}?id=${encodeURIComponent(id)}`,
      contentVersionOutputSchema,
      undefined,
      signal,
    ),
  listModules: (signal?: AbortSignal) =>
    request(options, API_ROUTES.modules.method, API_ROUTES.modules.path, modulesListOutputSchema, undefined, signal),
  createModule: (input: ModuleCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.modulesCreate.method, API_ROUTES.modulesCreate.path, moduleOutputSchema, input, signal),
  updateModule: (input: ModuleUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.modulesUpdate.method, API_ROUTES.modulesUpdate.path, moduleOutputSchema, input, signal),
  attachModuleToCourse: (input: ModuleAttachInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.modulesAttach.method, API_ROUTES.modulesAttach.path, moduleOutputSchema, input, signal),
  detachModuleFromCourse: (input: ModuleDetachInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.modulesDetach.method, API_ROUTES.modulesDetach.path, moduleOutputSchema, input, signal),
  listLessons: (signal?: AbortSignal) =>
    request(options, API_ROUTES.lessons.method, API_ROUTES.lessons.path, lessonsListOutputSchema, undefined, signal),
  createLesson: (input: LessonCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.lessonsCreate.method, API_ROUTES.lessonsCreate.path, lessonOutputSchema, input, signal),
  updateLesson: (input: LessonUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.lessonsUpdate.method, API_ROUTES.lessonsUpdate.path, lessonOutputSchema, input, signal),
  lessonReferences: (lessonId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.lessonReferences.method,
      `${API_ROUTES.lessonReferences.path}?id=${encodeURIComponent(lessonId)}`,
      lessonReferencesOutputSchema,
      undefined,
      signal,
    ),
  deleteLesson: (lessonId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.lessonsDelete.method,
      API_ROUTES.lessonsDelete.path.replace(':lessonId', encodeURIComponent(lessonId)),
      lessonDeleteOutputSchema,
      undefined,
      signal,
    ),
  studentCourses: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentCourses.method,
      API_ROUTES.studentCourses.path,
      studentCoursesOutputSchema,
      undefined,
      signal,
    ),
  studentCourseStructure: (courseId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentCourseStructure.method,
      API_ROUTES.studentCourseStructure.path.replace(':courseId', encodeURIComponent(courseId)),
      courseStructureOutputSchema,
      undefined,
      signal,
    ),
  studentLesson: (lessonId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLesson.method,
      API_ROUTES.studentLesson.path.replace(':lessonId', encodeURIComponent(lessonId)),
      studentLessonOutputSchema,
      undefined,
      signal,
    ),
  completeLesson: (input: LessonCompleteInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLessonComplete.method,
      API_ROUTES.studentLessonComplete.path,
      progressOutputSchema,
      input,
      signal,
    ),
  uncompleteLesson: (input: LessonUncompleteInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLessonUncomplete.method,
      API_ROUTES.studentLessonUncomplete.path,
      progressOutputSchema,
      input,
      signal,
    ),
  nextLesson: (lessonId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLessonNext.method,
      `${API_ROUTES.studentLessonNext.path}?lessonId=${encodeURIComponent(lessonId)}`,
      nextLessonOutputSchema,
      undefined,
      signal,
    ),
  updateLastViewed: (input: LastViewedInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLastViewed.method,
      API_ROUTES.studentLastViewed.path,
      progressOutputSchema,
      input,
      signal,
    ),
  studentProgress: (courseId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentProgress.method,
      `${API_ROUTES.studentProgress.path}?courseId=${encodeURIComponent(courseId)}`,
      progressOutputSchema,
      undefined,
      signal,
    ),
  createPost: (input: PostCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.postsCreate.method, API_ROUTES.postsCreate.path, postOutputSchema, input, signal),
  pinPost: (input: PostPinInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.postsPin.method,
      API_ROUTES.postsPin.path,
      postPinOutputSchema,
      input,
      signal,
    ),
  reportPost: (input: PostReportInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.postsReport.method,
      API_ROUTES.postsReport.path,
      postReportOutputSchema,
      input,
      signal,
    ),
  listReports: (input: ReportsListInput = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.status !== undefined) params.set('status', input.status);
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const query = params.size === 0 ? '' : `?${params.toString()}`;
    return request(
      options,
      API_ROUTES.reports.method,
      `${API_ROUTES.reports.path}${query}`,
      reportsListOutputSchema,
      undefined,
      signal,
    );
  },
  resolveReport: (input: ReportResolveInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.reportResolve.method,
      API_ROUTES.reportResolve.path,
      reportResolveOutputSchema,
      input,
      signal,
    ),
  updatePost: (input: PostUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.postsUpdate.method, API_ROUTES.postsUpdate.path, postOutputSchema, input, signal),
  deletePost: (input: PostDeleteInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.postsDelete.method,
      API_ROUTES.postsDelete.path.replace(':postId', encodeURIComponent(input.id)),
      postOutputSchema,
      undefined,
      signal,
    ),
  discussion: (input: DiscussionGetInput, signal?: AbortSignal) => {
    const params = new URLSearchParams({ contextKind: input.contextKind, contextId: input.contextId });
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    return request(
      options,
      API_ROUTES.discussion.method,
      `${API_ROUTES.discussion.path}?${params.toString()}`,
      discussionOutputSchema,
      undefined,
      signal,
    );
  },
  subscribeThread: (input: { rootPostId: string }, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.threadSubscribe.method,
      API_ROUTES.threadSubscribe.path,
      threadSubscriptionOutputSchema,
      input,
      signal,
    ),
  muteThread: (input: { rootPostId: string }, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.threadMute.method,
      API_ROUTES.threadMute.path,
      threadSubscriptionOutputSchema,
      input,
      signal,
    ),
  searchPosts: (input: PostsSearchInput, signal?: AbortSignal) => {
    const params = new URLSearchParams({ query: input.query });
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    for (const lessonId of input.lessonIds ?? []) params.append('lessonId', lessonId);
    return request(
      options,
      API_ROUTES.postsSearch.method,
      `${API_ROUTES.postsSearch.path}?${params.toString()}`,
      postsSearchOutputSchema,
      undefined,
      signal,
    );
  },
  reactToPost: (input: PostReactInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.postsReact.method, API_ROUTES.postsReact.path, postReactOutputSchema, input, signal),
  unreactToPost: (input: PostReactInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.postsUnreact.method,
      API_ROUTES.postsUnreact.path,
      postReactOutputSchema,
      input,
      signal,
    ),
  listSpaces: (signal?: AbortSignal) =>
    request(options, API_ROUTES.spaces.method, API_ROUTES.spaces.path, spacesListOutputSchema, undefined, signal),
  listStaffSpaces: (signal?: AbortSignal) =>
    request(options, API_ROUTES.spacesStaff.method, API_ROUTES.spacesStaff.path, staffSpacesListOutputSchema, undefined, signal),
  archiveSpace: (input: SpaceArchiveInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.spacesArchive.method, API_ROUTES.spacesArchive.path, spaceOutputSchema, input, signal),
  createSpace: (input: SpaceCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.spacesCreate.method, API_ROUTES.spacesCreate.path, spaceOutputSchema, input, signal),
  updateSpace: (input: SpaceUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.spacesUpdate.method, API_ROUTES.spacesUpdate.path, spaceOutputSchema, input, signal),
  deleteSpace: (input: SpaceDeleteInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.spacesDelete.method,
      API_ROUTES.spacesDelete.path.replace(':spaceId', encodeURIComponent(input.id)),
      spaceDeleteOutputSchema,
      undefined,
      signal,
    ),
  spaceFeed: (input: SpaceFeedGetInput, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const path = API_ROUTES.spaceFeed.path.replace(':spaceId', encodeURIComponent(input.spaceId));
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.spaceFeed.method,
      suffix.length > 0 ? `${path}?${suffix}` : path,
      spaceFeedOutputSchema,
      undefined,
      signal,
    );
  },
  followSpace: (input: SpaceFollowInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.spaceFollow.method, API_ROUTES.spaceFollow.path, spaceFollowOutputSchema, input, signal),
  unfollowSpace: (input: SpaceFollowInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.spaceUnfollow.method,
      API_ROUTES.spaceUnfollow.path,
      spaceFollowOutputSchema,
      input,
      signal,
    ),
  listNotifications: (input: NotificationsListInput = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.notifications.method,
      suffix.length > 0 ? `${API_ROUTES.notifications.path}?${suffix}` : API_ROUTES.notifications.path,
      notificationsListOutputSchema,
      undefined,
      signal,
    );
  },
  markNotificationRead: (input: NotificationReadInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.notificationRead.method,
      API_ROUTES.notificationRead.path,
      notificationReadOutputSchema,
      input,
      signal,
    ),
  markAllNotificationsRead: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.notificationsReadAll.method,
      API_ROUTES.notificationsReadAll.path,
      notificationsReadAllOutputSchema,
      {},
      signal,
    ),
  unreadNotificationCount: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.notificationsUnread.method,
      API_ROUTES.notificationsUnread.path,
      notificationsUnreadOutputSchema,
      undefined,
      signal,
    ),
  devGrant: (input: DevGrantInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.devGrant.method, API_ROUTES.devGrant.path, devGrantOutputSchema, input, signal),
  listApiKeys: (signal?: AbortSignal) =>
    request(options, API_ROUTES.apiKeys.method, API_ROUTES.apiKeys.path, apiKeysListOutputSchema, undefined, signal),
  createApiKey: (input: ApiKeyCreateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.apiKeysCreate.method,
      API_ROUTES.apiKeysCreate.path,
      apiKeyCreateOutputSchema,
      input,
      signal,
    ),
  revokeApiKey: (input: ApiKeyRevokeInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.apiKeyRevoke.method,
      API_ROUTES.apiKeyRevoke.path.replace(':id', encodeURIComponent(input.id)),
      apiKeyRevokeOutputSchema,
      undefined,
      signal,
    ),
  listTenantSecrets: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantSecrets.method,
      API_ROUTES.tenantSecrets.path,
      tenantSecretsListOutputSchema,
      undefined,
      signal,
    ),
  setTenantSecret: (input: TenantSecretSetInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantSecretSet.method,
      API_ROUTES.tenantSecretSet.path,
      tenantSecretSetOutputSchema,
      input,
      signal,
    ),
  deleteTenantSecret: (input: TenantSecretDeleteInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantSecretDelete.method,
      API_ROUTES.tenantSecretDelete.path.replace(':key', encodeURIComponent(input.key)),
      tenantSecretDeleteOutputSchema,
      undefined,
      signal,
    ),
  testStripeConnection: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.stripeTestConnection.method,
      API_ROUTES.stripeTestConnection.path,
      stripeTestConnectionOutputSchema,
      {},
      signal,
    ),
  testIfirmaConnection: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.ifirmaTestConnection.method,
      API_ROUTES.ifirmaTestConnection.path,
      ifirmaTestConnectionOutputSchema,
      {},
      signal,
    ),
  testKsefConnection: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.ksefTestConnection.method,
      API_ROUTES.ksefTestConnection.path,
      ksefTestConnectionOutputSchema,
      {},
      signal,
    ),
  listBunnyVideos: (input: { search?: string; page?: number } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (input.search !== undefined && input.search !== '') params.set('search', input.search);
    if (input.page !== undefined) params.set('page', String(input.page));
    const suffix = params.toString();
    return request(
      options,
      API_ROUTES.bunnyVideos.method,
      suffix.length > 0 ? `${API_ROUTES.bunnyVideos.path}?${suffix}` : API_ROUTES.bunnyVideos.path,
      bunnyVideosOutputSchema,
      undefined,
      signal,
    );
  },
  testBunnyConnection: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.bunnyTestConnection.method,
      API_ROUTES.bunnyTestConnection.path,
      bunnyTestConnectionOutputSchema,
      {},
      signal,
    ),
  m2mEnroll: (input: M2mEnrollRequest, signal?: AbortSignal) =>
    request(options, API_ROUTES.m2mEnroll.method, API_ROUTES.m2mEnroll.path, m2mEnrollOutputSchema, input, signal),
  getTenantSettings: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantSettings.method,
      API_ROUTES.tenantSettings.path,
      tenantSettingsOutputSchema,
      undefined,
      signal,
    ),
  updateTenantSettings: (input: TenantSettingsUpdateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantSettingsUpdate.method,
      API_ROUTES.tenantSettingsUpdate.path,
      tenantSettingsOutputSchema,
      input,
      signal,
    ),
  sendSupportMessage: (input: SupportMessageInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.supportMessage.method,
      API_ROUTES.supportMessage.path,
      supportMessageOutputSchema,
      input,
      signal,
    ),
  getOnboarding: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.onboarding.method,
      API_ROUTES.onboarding.path,
      onboardingOutputSchema,
      undefined,
      signal,
    ),
  dismissOnboarding: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.onboardingDismiss.method,
      API_ROUTES.onboardingDismiss.path,
      onboardingOutputSchema,
      {},
      signal,
    ),
});

export type ApiClient = ReturnType<typeof createApiClient>;

/** For TanStack Query: converts a Result into value-or-throw at the query boundary. */
export const unwrap = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new ApiError(result.error);
  return result.value;
};

export class ApiError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'ApiError';
    this.appError = appError;
  }
}
