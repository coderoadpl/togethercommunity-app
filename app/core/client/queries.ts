import type {
  DefaultError,
  FetchQueryOptions,
  MutationFunction,
  MutationKey,
  MutationOptions,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
} from '@tanstack/query-core';

import type {
  CourseCreateInput,
  ApiKeyCreateInput,
  ApiKeyImportAuditQuery,
  ApiKeyRevokeInput,
  CheckoutSessionRequest,
  CouponCheckoutValidationRequest,
  CouponArchiveRequest,
  CouponCreateRequest,
  CouponStatsExportQueryInput,
  CouponStatsQueryInput,
  CourseUpdateInput,
  EventCreateInput,
  EventRefInput,
  EventRsvpInput,
  EventUpdateInput,
  EventsBySpaceInput,
  GrantCreateInput,
  GrantRevokeInput,
  EmailSendsExportQueryInput,
  EmailSendsQueryInput,
  SchedulerRunsQueryInput,
  LastViewedInput,
  LessonCompleteInput,
  LessonUncompleteInput,
  LessonCreateInput,
  LessonUpdateInput,
  MemberUpcomingEventsInput,
  MeProfileUpdateInput,
  MessagesListInput,
  MessagesReadInput,
  MessagesSendInput,
  MessagesStartInput,
  MessagesThreadInput,
  MemberHomeFeedGetInput,
  MemberProgressResetInput,
  MemberBanInput,
  MemberRemoveInput,
  MemberErasureRequestCreateInput,
  MemberErasureRequestsQueryInput,
  MarketingAudiencePreviewInput,
  MarketingCampaignActionInput,
  MarketingCampaignCreateInput,
  MarketingCampaignScheduleInput,
  MarketingCampaignUpdateInput,
  MarketingConsentDefinitionCreateInput,
  MarketingConsentDefinitionUpdateInput,
  MarketingDocumentCreateInput,
  MarketingDocumentPublishInput,
  MarketingDocumentUpdateInput,
  MarketingLayoutSaveInput,
  MarketingSesSettingsUpdateInput,
  MarketingSesIdentityStartInput,
  ModuleAttachInput,
  ModuleDetachInput,
  ModuleCreateInput,
  ModuleUpdateInput,
  NotificationReadInput,
  NotificationsListInput,
  DiscussionGetInput,
  PostCreateInput,
  PostDeleteInput,
  PostPinInput,
  PostReportInput,
  ReportResolveInput,
  ReportsListInput,
  PostReactInput,
  PostUpdateInput,
  PostsSearchInput,
  PublicSpaceEventInput,
  PublicSpaceThreadGetInput,
  SpaceArchiveInput,
  SpaceCreateInput,
  SpaceFeedGetInput,
  SpaceFollowInput,
  SpaceSeenInput,
  SpaceUpdateInput,
  SupportMessageInput,
  ProductsAccessItemsInput,
  ProductsPublishInput,
  ProductsUnpublishInput,
  ProductsUpdateInput,
  ProductPriceCreateInput,
  ProductPriceDeactivateInput,
  OrdersListQueryInput,
  OrdersReconciliationQueryInput,
  OrdersExportQueryInput,
  SimulatePurchaseInput,
  TenantCreateInput,
  TenantSecretDeleteInput,
  IntegrationTestInput,
  StorageConfigureInput,
  StorageProbeInput,
  StripeConfigureInput,
  TenantSecretSetInput,
  TenantSettingsUpdateInput,
} from '#core/contract/index.js';
import type { MemberExportFormat, NewProductInput, OrderExportFormat } from '#core/domain/index.js';

import type { AuthClientPort, AuthSessionResult } from './auth-port.js';
import {
  unwrap,
  type ApiClient,
  type ProductDownloadFileUpload,
  type ImageAssetFileUpload,
  type ReadResult,
  type WriteResult,
} from './http.js';
import type { LessonAttachmentFileUpload } from './http.js';

/**
 * Identity helpers that type descriptors against `@tanstack/query-core` option
 * types (never `@tanstack/react-query`, which `core/client` may not import).
 * They bind the `queryFn` result type to the key so `useQuery`/`useMutation`
 * infer `data`/`variables` at the call site without explicit generics.
 *
 * CQRS partition is enforced here: `defineQuery` accepts only a read-tagged
 * `call` (a GET contract route), `defineMutation` only a write-tagged one.
 * Each helper owns the `unwrap` so the tag never leaks into `data`/`variables`.
 */
export type QueryDescriptor<TQueryFnData, TQueryKey extends QueryKey> = FetchQueryOptions<
  TQueryFnData,
  DefaultError,
  TQueryFnData,
  TQueryKey
> & { queryFn: QueryFunction<TQueryFnData, TQueryKey> };

type ReadCall<TQueryFnData, TQueryKey extends QueryKey> = (
  context: QueryFunctionContext<TQueryKey>,
) => Promise<ReadResult<TQueryFnData>>;

type DefineQueryInput<TQueryFnData, TQueryKey extends QueryKey> = Omit<
  QueryDescriptor<TQueryFnData, TQueryKey>,
  'queryFn'
> & { call: ReadCall<TQueryFnData, TQueryKey> };

const defineQuery = <TQueryFnData, TQueryKey extends QueryKey>(
  input: DefineQueryInput<TQueryFnData, TQueryKey>,
): QueryDescriptor<TQueryFnData, TQueryKey> => {
  const { call, ...rest } = input;
  return { ...rest, queryFn: async (context) => unwrap(await call(context)) };
};

export type MutationDescriptor<TData, TVariables> = MutationOptions<
  TData,
  DefaultError,
  TVariables
> & { mutationKey: MutationKey; mutationFn: MutationFunction<TData, TVariables> };

type WriteCall<TData, TVariables> = (variables: TVariables) => Promise<WriteResult<TData>>;

type DefineMutationInput<TData, TVariables> = Omit<
  MutationDescriptor<TData, TVariables>,
  'mutationFn'
> & { call: WriteCall<TData, TVariables> };

const defineMutation = <TData, TVariables>(
  input: DefineMutationInput<TData, TVariables>,
): MutationDescriptor<TData, TVariables> => {
  const { call, ...rest } = input;
  return { ...rest, mutationFn: async (variables) => unwrap(await call(variables)) };
};

/**
 * Query keys are the public API of each resource: general → specific, matched
 * by prefix for invalidation and per-prefix defaults. Never hand-copy a key.
 */
const meScopes = {
  all: () => ['me'] as const,
};

const healthScopes = {
  all: () => ['health'] as const,
};

const tenantsScopes = {
  all: () => ['tenants'] as const,
};

const publicOfferScopes = {
  all: () => ['public-offer'] as const,
};

const publicSurfaceScopes = {
  navigation: () => ['public-navigation'] as const,
  courseStructure: (courseId: string) => ['public-course-structure', courseId] as const,
  spaceFeed: (spaceId: string, limit?: number) =>
    ['public-space-feed', spaceId, limit ?? null] as const,
  spaceThread: (spaceId: string, postId: string) =>
    ['public-space-thread', spaceId, postId] as const,
  spaceEvents: (spaceId: string, scope?: string) =>
    ['public-space-events', spaceId, scope ?? null] as const,
  spaceEvent: (spaceId: string, eventId: string) =>
    ['public-space-event', spaceId, eventId] as const,
};

const authConfigScopes = {
  all: () => ['auth-config'] as const,
};

const memberBillingOrdersScopes = {
  all: () => ['member-billing-orders'] as const,
};

const productsScopes = {
  all: () => ['products'] as const,
  lists: () => ['products', 'list'] as const,
  issues: () => ['products', 'issues'] as const,
};

const productPricesScopes = {
  all: () => ['product-prices'] as const,
  list: (productId: string) => ['product-prices', 'list', productId] as const,
};

const productDownloadsScopes = {
  all: () => ['product-downloads'] as const,
  list: (productId: string) => ['product-downloads', 'list', productId] as const,
};

const imageAssetsScopes = {
  all: () => ['image-assets'] as const,
};

const salesScopes = {
  all: () => ['sales'] as const,
  orders: (input: OrdersListQueryInput) => ['sales', 'orders', input] as const,
  order: (id: string) => ['sales', 'order', id] as const,
  export: (format: OrderExportFormat, input: OrdersExportQueryInput) => ['sales', 'export', format, input] as const,
  summary: () => ['sales', 'summary'] as const,
  reconciliation: (input: OrdersReconciliationQueryInput) =>
    ['sales', 'reconciliation', input] as const,
};

const couponScopes = {
  all: () => ['coupons'] as const,
  options: () => ['coupons', 'options'] as const,
  list: (input: CouponStatsQueryInput) => ['coupons', 'list', input] as const,
  detail: (id: string) => ['coupons', 'detail', id] as const,
  export: (input: CouponStatsExportQueryInput) => ['coupons', 'export', input] as const,
};

const myProductsScopes = {
  all: () => ['my-products'] as const,
};

const memberNavigationScopes = {
  all: () => ['member-navigation'] as const,
};

const memberHomeFeedScopes = {
  all: () => ['member-home-feed'] as const,
  page: (limit?: number) => ['member-home-feed', 'page', limit ?? null] as const,
};

const membersScopes = {
  all: () => ['members'] as const,
  export: (format: MemberExportFormat) => ['members', 'export', format] as const,
  grants: (memberId: string) => ['members', 'grants', memberId] as const,
  commerce: (memberId: string) => ['members', 'commerce', memberId] as const,
  timeline: (memberId: string) => ['members', 'timeline', memberId] as const,
  learningSummary: (memberId: string) => ['members', 'learning-summary', memberId] as const,
};

const authScopes = {
  all: () => ['auth'] as const,
  magicLink: (email: string) => ['auth', 'dev-magic-link', email] as const,
};

const tenantSecretsScopes = {
  all: () => ['tenant-secrets'] as const,
  lists: () => ['tenant-secrets', 'list'] as const,
};

const apiKeyScopes = {
  all: () => ['api-keys'] as const,
  lists: () => ['api-keys', 'list'] as const,
  audit: (input: ApiKeyImportAuditQuery) => ['api-keys', 'audit', input] as const,
};

const bunnyScopes = {
  all: () => ['bunny'] as const,
  videos: (search: string, page: number) => ['bunny', 'videos', search, page] as const,
};

const tenantSettingsScopes = {
  all: () => ['tenant-settings'] as const,
};

const onboardingScopes = {
  all: () => ['onboarding'] as const,
};

const coursesScopes = {
  all: () => ['courses'] as const,
  lists: () => ['courses', 'list'] as const,
};

const modulesScopes = {
  all: () => ['modules'] as const,
};

const contentHistoryScopes = {
  all: () => ['content-history'] as const,
  list: (courseId: string) => ['content-history', 'list', courseId] as const,
};

const lessonsScopes = {
  all: () => ['lessons'] as const,
  references: (lessonId: string) => ['lessons', 'references', lessonId] as const,
  attachments: (lessonId: string) => ['lessons', 'attachments', lessonId] as const,
};

const studentScopes = {
  all: () => ['student'] as const,
  courses: () => ['student', 'courses'] as const,
  courseStructure: (courseId: string) => ['student', 'course-structure', courseId] as const,
  lesson: (lessonId: string) => ['student', 'lesson', lessonId] as const,
  attachments: (lessonId: string) => ['student', 'attachments', lessonId] as const,
  nextLesson: (lessonId: string) => ['student', 'next-lesson', lessonId] as const,
  progress: (courseId: string) => ['student', 'progress', courseId] as const,
};

const discussionScopes = {
  all: () => ['discussion'] as const,
  lesson: (lessonId: string, limit?: number) => ['discussion', 'lesson', lessonId, limit ?? null] as const,
  search: (query: string, lessonIds: readonly string[], spaceIds: readonly string[]) =>
    ['discussion', 'search', query, lessonIds.join(','), spaceIds.join(',')] as const,
};

const spacesScopes = {
  all: () => ['spaces'] as const,
  lists: () => ['spaces', 'list'] as const,
  staff: () => ['spaces', 'staff'] as const,
  feed: (spaceId: string, limit?: number) => ['spaces', 'feed', spaceId, limit ?? null] as const,
};

const reportScopes = {
  all: () => ['reports'] as const,
  list: (input: ReportsListInput) => ['reports', 'list', input] as const,
};

const notificationScopes = {
  all: () => ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
  page: (limit?: number) => ['notifications', 'page', limit ?? null] as const,
  unread: () => ['notifications', 'unread'] as const,
};

const messagesScopes = {
  all: () => ['messages'] as const,
  list: (limit?: number) => ['messages', 'list', limit ?? null] as const,
  thread: (conversationId: string, limit?: number) =>
    ['messages', 'thread', conversationId, limit ?? null] as const,
  unread: () => ['messages', 'unread'] as const,
};

const eventsScopes = {
  all: () => ['events'] as const,
  bySpace: (input: EventsBySpaceInput) => ['events', 'space', input] as const,
  detail: (eventId: string) => ['events', 'detail', eventId] as const,
  upcoming: (limit?: number) => ['events', 'upcoming', limit ?? null] as const,
  ics: (eventId: string) => ['events', 'ics', eventId] as const,
};

const marketingScopes = {
  all: () => ['marketing'] as const,
  campaigns: () => ['marketing', 'campaigns'] as const,
  campaign: (id: string) => ['marketing', 'campaigns', id] as const,
  consents: () => ['marketing', 'consents'] as const,
  consent: (id: string) => ['marketing', 'consents', id] as const,
  documents: () => ['marketing', 'documents'] as const,
  document: (id: string) => ['marketing', 'documents', id] as const,
  layouts: () => ['marketing', 'layouts'] as const,
  settings: () => ['marketing', 'settings'] as const,
  reputation: () => ['marketing', 'reputation'] as const,
  sends: (input: EmailSendsQueryInput) => ['marketing', 'sends', input] as const,
  send: (kind: 'transactional' | 'marketing', id: string) => ['marketing', 'sends', kind, id] as const,
  memberSends: (memberId: string) => ['marketing', 'member-sends', memberId] as const,
  sendsExport: (input: EmailSendsExportQueryInput) => ['marketing', 'sends-export', input] as const,
  schedulerRuns: (input: SchedulerRunsQueryInput) => ['marketing', 'scheduler-runs', input] as const,
  schedulerRun: (id: string) => ['marketing', 'scheduler-runs', id] as const,
};

export const marketingCampaignsQuery = (api: ApiClient) => defineQuery({
  queryKey: marketingScopes.campaigns(), call: ({ signal }) => api.listMarketingCampaigns(signal),
});
export const marketingCampaignQuery = (api: ApiClient, id: string) => defineQuery({
  queryKey: marketingScopes.campaign(id), call: ({ signal }) => api.getMarketingCampaign(id, signal),
});
export const createMarketingCampaignMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.campaigns(), 'create'], call: (input: MarketingCampaignCreateInput) => api.createMarketingCampaign(input),
});
export const updateMarketingCampaignMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.campaigns(), 'update'], call: (input: MarketingCampaignUpdateInput) => api.updateMarketingCampaign(input),
});
export const scheduleMarketingCampaignMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.campaigns(), 'schedule'], call: (input: MarketingCampaignScheduleInput) => api.scheduleMarketingCampaign(input),
});
export const marketingCampaignActionMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.campaigns(), 'action'], call: (input: MarketingCampaignActionInput) => api.actOnMarketingCampaign(input),
});
export const testMarketingCampaignMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.campaigns(), 'test'], call: (input: { campaignId: string }) => api.testMarketingCampaign(input),
});
export const previewMarketingAudienceMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.campaigns(), 'audience'], call: (input: MarketingAudiencePreviewInput) => api.previewMarketingAudience(input),
});
export const marketingConsentsQuery = (api: ApiClient) => defineQuery({
  queryKey: marketingScopes.consents(), call: ({ signal }) => api.listMarketingConsentDefinitions(signal),
});
export const marketingConsentQuery = (api: ApiClient, id: string) => defineQuery({
  queryKey: marketingScopes.consent(id), call: ({ signal }) => api.getMarketingConsentDefinition(id, signal),
});
export const createMarketingConsentMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.consents(), 'create'], call: (input: MarketingConsentDefinitionCreateInput) => api.createMarketingConsentDefinition(input),
});
export const updateMarketingConsentMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.consents(), 'update'], call: (input: MarketingConsentDefinitionUpdateInput) => api.updateMarketingConsentDefinition(input),
});
export const marketingDocumentsQuery = (api: ApiClient) => defineQuery({
  queryKey: marketingScopes.documents(), call: ({ signal }) => api.listMarketingDocuments(signal),
});
export const marketingDocumentQuery = (api: ApiClient, id: string) => defineQuery({
  queryKey: marketingScopes.document(id), call: ({ signal }) => api.getMarketingDocument(id, signal),
});
export const createMarketingDocumentMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.documents(), 'create'], call: (input: MarketingDocumentCreateInput) => api.createMarketingDocument(input),
});
export const updateMarketingDocumentMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.documents(), 'update'], call: (input: MarketingDocumentUpdateInput) => api.updateMarketingDocument(input),
});
export const publishMarketingDocumentMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.documents(), 'publish'], call: (input: MarketingDocumentPublishInput) => api.publishMarketingDocument(input),
});
export const marketingLayoutsQuery = (api: ApiClient) => defineQuery({
  queryKey: marketingScopes.layouts(), call: ({ signal }) => api.listMarketingLayouts(signal),
});
export const saveMarketingLayoutMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.layouts(), 'save'], call: (input: MarketingLayoutSaveInput) => api.saveMarketingLayout(input),
});
export const marketingSesSettingsQuery = (api: ApiClient) => defineQuery({
  queryKey: marketingScopes.settings(), call: ({ signal }) => api.getMarketingSesSettings(signal),
});
export const pollMarketingSesOnboardingMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.settings(), 'onboarding'],
  call: api.pollMarketingSesOnboarding,
});
export const startMarketingSesIdentityMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.settings(), 'identity'],
  call: (input: MarketingSesIdentityStartInput) => api.startMarketingSesIdentity(input),
});
export const provisionMarketingSesMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.settings(), 'provision'],
  call: api.provisionMarketingSes,
});
export const testMarketingSesSimulatorMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.settings(), 'simulator'],
  call: api.testMarketingSesSimulator,
});
export const marketingReputationQuery = (api: ApiClient) => defineQuery({
  queryKey: marketingScopes.reputation(), call: ({ signal }) => api.getMarketingReputation(signal),
});
export const updateMarketingSesSettingsMutation = (api: ApiClient) => defineMutation({
  mutationKey: [...marketingScopes.settings(), 'update'], call: (input: MarketingSesSettingsUpdateInput) => api.updateMarketingSesSettings(input),
});
export const emailSendsQuery = (api: ApiClient, input: EmailSendsQueryInput) => defineQuery({
  queryKey: marketingScopes.sends(input), call: ({ signal }) => api.listEmailSends(input, signal),
});
export const emailSendQuery = (api: ApiClient, kind: 'transactional' | 'marketing', id: string) => defineQuery({
  queryKey: marketingScopes.send(kind, id), call: ({ signal }) => api.getEmailSend(kind, id, signal),
});
export const memberEmailSendsQuery = (api: ApiClient, memberId: string) => defineQuery({
  queryKey: marketingScopes.memberSends(memberId), call: ({ signal }) => api.listMemberEmailSends(memberId, signal),
});
export const emailSendsExportQuery = (api: ApiClient, input: EmailSendsExportQueryInput) => defineQuery({
  queryKey: marketingScopes.sendsExport(input),
  staleTime: 0,
  gcTime: 0,
  call: ({ signal }) => api.exportEmailSends(input, signal),
});

export const schedulerRunsQuery = (api: ApiClient, input: SchedulerRunsQueryInput) => defineQuery({
  queryKey: marketingScopes.schedulerRuns(input),
  call: ({ signal }) => api.listTenantSchedulerRuns(input, signal),
});

export const schedulerRunQuery = (api: ApiClient, id: string) => defineQuery({
  queryKey: marketingScopes.schedulerRun(id),
  call: ({ signal }) => api.getTenantSchedulerRun(id, signal),
});

export const marketingInvalidates = () => ({ queryKey: marketingScopes.all() });

export const meQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: meScopes.all(),
    call: ({ signal }) => api.me(signal),
  });

export const meInvalidates = () => ({ queryKey: meScopes.all() });

export const updateMyProfileMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['me', 'profile'],
    call: (input: MeProfileUpdateInput) => api.updateMyProfile(input),
  });

export const healthQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: healthScopes.all(),
    call: ({ signal }) => api.health(signal),
  });

export const tenantsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantsScopes.all(),
    call: ({ signal }) => api.listTenants(signal),
  });

export const publicOfferQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: publicOfferScopes.all(),
    call: ({ signal }) => api.publicOffer(signal),
  });

export const publicOfferInvalidates = () => ({ queryKey: publicOfferScopes.all() });

export const publicNavigationQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: publicSurfaceScopes.navigation(),
    call: ({ signal }) => api.publicNavigation(signal),
  });

export const publicCourseStructureQuery = (api: ApiClient, courseId: string) =>
  defineQuery({
    queryKey: publicSurfaceScopes.courseStructure(courseId),
    call: ({ signal }) => api.publicCourseStructure(courseId, signal),
  });

export const publicSpaceFeedQuery = (api: ApiClient, input: SpaceFeedGetInput) =>
  defineQuery({
    queryKey: publicSurfaceScopes.spaceFeed(input.spaceId, input.limit),
    call: ({ signal }) => api.publicSpaceFeed(input, signal),
  });

export const publicSpaceThreadQuery = (api: ApiClient, input: PublicSpaceThreadGetInput) =>
  defineQuery({
    queryKey: publicSurfaceScopes.spaceThread(input.spaceId, input.postId),
    call: ({ signal }) => api.publicSpaceThread(input, signal),
  });

export const publicSpaceEventsQuery = (api: ApiClient, input: EventsBySpaceInput) =>
  defineQuery({
    queryKey: publicSurfaceScopes.spaceEvents(input.spaceId, input.scope),
    call: ({ signal }) => api.publicSpaceEvents(input, signal),
  });

export const publicSpaceEventQuery = (api: ApiClient, input: PublicSpaceEventInput) =>
  defineQuery({
    queryKey: publicSurfaceScopes.spaceEvent(input.spaceId, input.eventId),
    call: ({ signal }) => api.publicSpaceEvent(input, signal),
  });

export const publicPaymentConfigQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: ['payment-config'] as const,
    call: ({ signal }) => api.publicPaymentConfig(signal),
  });

export const createCheckoutSessionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['checkout-session'] as const,
    call: (input: CheckoutSessionRequest) => api.createCheckoutSession(input),
  });

export const validateCouponForCheckoutMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['coupon-checkout-validation'] as const,
    call: (input: CouponCheckoutValidationRequest) => api.validateCouponForCheckout(input),
  });

export const recordTermsConsentMutation = (
  api: ApiClient,
): MutationDescriptor<{ recorded: boolean }, { accepted: boolean }> =>
  defineMutation({
    mutationKey: ['terms-consent'] as const,
    call: (input) => api.recordTermsConsent(input),
  });

export const authConfigQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: authConfigScopes.all(),
    call: ({ signal }) => api.authConfig(signal),
  });

export const createTenantMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantsScopes.all(), 'create'],
    call: (input: TenantCreateInput) => api.createTenant(input),
  });

export const productsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: productsScopes.lists(),
    call: ({ signal }) => api.listProducts(signal),
  });

export const createProductMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'create'],
    call: (input: NewProductInput) => api.createProduct(input),
  });

export const publishProductMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'publish'],
    call: (input: ProductsPublishInput) => api.publishProduct(input),
  });

export const unpublishProductMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'unpublish'],
    call: (input: ProductsUnpublishInput) => api.unpublishProduct(input),
  });

export const updateProductMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'update'],
    call: (input: ProductsUpdateInput) => api.updateProduct(input),
  });

export const myProductsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: myProductsScopes.all(),
    call: ({ signal }) => api.myProducts(signal),
  });

export const memberNavigationQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: memberNavigationScopes.all(),
    call: ({ signal }) => api.memberNavigation(signal),
  });

export const memberHomeFeedQuery = (api: ApiClient, input: MemberHomeFeedGetInput) =>
  defineQuery({
    queryKey: memberHomeFeedScopes.page(input.limit),
    call: ({ signal }) => api.memberHomeFeed(input, signal),
  });

export const membersQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: membersScopes.all(),
    call: ({ signal }) => api.listMembers(signal),
  });

export const productPricesQuery = (api: ApiClient, productId: string) =>
  defineQuery({
    queryKey: productPricesScopes.list(productId),
    call: ({ signal }) => api.listProductPrices(productId, signal),
  });

export const productPricesInvalidates = (productId: string) => ({
  queryKey: productPricesScopes.list(productId),
});

export const createProductPriceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productPricesScopes.all(), 'create'],
    call: (input: ProductPriceCreateInput) => api.createProductPrice(input),
  });

export const deactivateProductPriceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productPricesScopes.all(), 'deactivate'],
    call: (input: ProductPriceDeactivateInput) => api.deactivateProductPrice(input),
  });

export const productDownloadAssetsQuery = (api: ApiClient, productId: string) =>
  defineQuery({
    queryKey: productDownloadsScopes.list(productId),
    call: ({ signal }) => api.listProductDownloadAssets(productId, signal),
  });

export const uploadProductDownloadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productDownloadsScopes.all(), 'upload'],
    call: (input: ProductDownloadFileUpload) => api.uploadProductDownload(input),
  });

export const uploadCourseCoverMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...imageAssetsScopes.all(), 'course-cover', 'upload'],
    call: (input: ImageAssetFileUpload) => api.uploadCourseCover(input),
  });

export const uploadProductCoverMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...imageAssetsScopes.all(), 'product-cover', 'upload'],
    call: (input: ImageAssetFileUpload) => api.uploadProductCover(input),
  });

export const uploadBrandingAssetMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...imageAssetsScopes.all(), 'branding', 'upload'],
    call: (input: ImageAssetFileUpload) => api.uploadBrandingAsset(input),
  });

export const deleteProductDownloadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productDownloadsScopes.all(), 'delete'],
    call: (input: { productId: string; assetId: string }) => api.deleteProductDownload(input),
  });

export const productDownloadAssetsInvalidates = (productId: string) => ({
  queryKey: productDownloadsScopes.list(productId),
});

export const ordersQuery = (api: ApiClient, input: OrdersListQueryInput) =>
  defineQuery({
    queryKey: salesScopes.orders(input),
    call: ({ signal }) => api.listOrders(input, signal),
  });

export const orderReconciliationQuery = (
  api: ApiClient,
  input: OrdersReconciliationQueryInput = {},
) =>
  defineQuery({
    queryKey: salesScopes.reconciliation(input),
    call: ({ signal }) => api.listOrderReconciliation(input, signal),
  });

export const memberBillingOrdersQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: memberBillingOrdersScopes.all(),
    call: ({ signal }) => api.listMemberBillingOrders(1, 25, signal),
  });

export const orderQuery = (api: ApiClient, id: string) =>
  defineQuery({
    queryKey: salesScopes.order(id),
    call: ({ signal }) => api.getOrder(id, signal),
  });

export const issueInvoiceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...salesScopes.all(), 'invoice'],
    call: (orderId: string) => api.issueInvoice(orderId),
  });

export const refreshInvoiceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...salesScopes.all(), 'invoice-refresh'],
    call: (invoiceId: string) => api.refreshInvoice(invoiceId),
  });

export const ordersExportQuery = (api: ApiClient, input: OrdersExportQueryInput) =>
  defineQuery({
    queryKey: salesScopes.export(input.format, input),
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.exportOrders(input, signal),
  });

export const salesSummaryQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: salesScopes.summary(),
    call: ({ signal }) => api.salesSummary(signal),
  });

export const couponStatsQuery = (api: ApiClient, input: CouponStatsQueryInput) =>
  defineQuery({
    queryKey: couponScopes.list(input),
    call: ({ signal }) => api.listCouponStats(input, signal),
  });

export const couponOptionsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: couponScopes.options(),
    call: ({ signal }) => api.listCouponOptions(signal),
  });

export const couponStatsDetailQuery = (api: ApiClient, id: string) =>
  defineQuery({
    queryKey: couponScopes.detail(id),
    call: ({ signal }) => api.getCouponStats(id, signal),
  });

export const couponStatsExportQuery = (api: ApiClient, input: CouponStatsExportQueryInput) =>
  defineQuery({
    queryKey: couponScopes.export(input),
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.exportCouponStats(input, signal),
  });

export const createCouponMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...couponScopes.all(), 'create'],
    call: (input: CouponCreateRequest) => api.createCoupon(input),
  });

export const archiveCouponMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...couponScopes.all(), 'archive'],
    call: (input: CouponArchiveRequest) => api.archiveCoupon(input),
  });

export const couponsInvalidates = () => ({ queryKey: couponScopes.all() });

export const membersExportQuery = (api: ApiClient, format: MemberExportFormat) =>
  defineQuery({
    queryKey: membersScopes.export(format),
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.exportMembers(format, signal),
  });

export const myDataExportQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: ['my-data-export'],
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.exportMyData(signal),
  });

export const myErasureRequestQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: ['my-erasure-request'],
    call: ({ signal }) => api.getMyErasureRequest(signal),
  });

export const requestMyErasureMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['my-erasure-request', 'create'],
    call: (input: MemberErasureRequestCreateInput) => api.requestMyErasure(input),
  });

export const cancelMyErasureRequestMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['my-erasure-request', 'cancel'],
    call: () => api.cancelMyErasureRequest(),
  });

export const erasureRequestsQuery = (
  api: ApiClient,
  input: MemberErasureRequestsQueryInput,
) =>
  defineQuery({
    queryKey: ['erasure-requests', input],
    call: ({ signal }) => api.listErasureRequests(input, signal),
  });

export const rejectErasureRequestMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['erasure-requests', 'reject'],
    call: (input: { requestId: string; note: string }) =>
      api.rejectErasureRequest(input.requestId, input.note),
  });

export const removeMemberMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'remove'],
    call: (input: MemberRemoveInput) => api.removeMember(input),
  });

export const memberGrantsQuery = (api: ApiClient, memberId: string) =>
  defineQuery({
    queryKey: membersScopes.grants(memberId),
    call: ({ signal }) => api.listMemberGrants(memberId, signal),
  });

export const memberCommerceQuery = (api: ApiClient, memberId: string) =>
  defineQuery({
    queryKey: membersScopes.commerce(memberId),
    call: ({ signal }) => api.memberCommerce(memberId, signal),
  });

export const memberTimelineQuery = (api: ApiClient, memberId: string) =>
  defineQuery({
    queryKey: membersScopes.timeline(memberId),
    call: ({ signal }) => api.memberTimeline(memberId, signal),
  });

export const memberLearningSummaryQuery = (api: ApiClient, memberId: string) =>
  defineQuery({
    queryKey: membersScopes.learningSummary(memberId),
    call: ({ signal }) => api.memberLearningSummary(memberId, signal),
  });

export const resetMemberProgressMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'reset-progress'],
    call: (input: MemberProgressResetInput) => api.resetMemberProgress(input),
  });

export const grantProductToMemberMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'grant'],
    call: (input: GrantCreateInput) => api.grantProductToMember(input),
  });

export const revokeGrantMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'revoke-grant'],
    call: (input: GrantRevokeInput) => api.revokeGrant(input),
  });

export const simulatePurchaseMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...myProductsScopes.all(), 'simulate-purchase'],
    call: (input: SimulatePurchaseInput) => api.simulatePurchase(input),
  });

export const devMagicLinkQuery = (api: ApiClient, email: string) =>
  defineQuery({
    queryKey: authScopes.magicLink(email),
    call: ({ signal }) => api.devMagicLink(email, signal),
  });

export const coursesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: coursesScopes.lists(),
    call: ({ signal }) => api.listCourses(signal),
  });

export const createCourseMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...coursesScopes.all(), 'create'],
    call: (input: CourseCreateInput) => api.createCourse(input),
  });

export const updateCourseMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...coursesScopes.all(), 'update'],
    call: (input: CourseUpdateInput) => api.updateCourse(input),
  });

export const modulesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: modulesScopes.all(),
    call: ({ signal }) => api.listModules(signal),
  });

export const contentHistoryQuery = (
  api: ApiClient,
  input: { courseId: string; limit?: number },
) =>
  defineQuery({
    queryKey: contentHistoryScopes.list(input.courseId),
    call: ({ signal }) => api.listContentHistory(input, signal),
  });

export const lessonsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: lessonsScopes.all(),
    call: ({ signal }) => api.listLessons(signal),
  });

export const createModuleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...modulesScopes.all(), 'create'],
    call: (input: ModuleCreateInput) => api.createModule(input),
  });

export const updateModuleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...modulesScopes.all(), 'update'],
    call: (input: ModuleUpdateInput) => api.updateModule(input),
  });

export const attachModuleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...modulesScopes.all(), 'attach'],
    call: (input: ModuleAttachInput) => api.attachModuleToCourse(input),
  });

export const detachModuleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...modulesScopes.all(), 'detach'],
    call: (input: ModuleDetachInput) => api.detachModuleFromCourse(input),
  });

export const createLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...lessonsScopes.all(), 'create'],
    call: (input: LessonCreateInput) => api.createLesson(input),
  });

export const updateLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...lessonsScopes.all(), 'update'],
    call: (input: LessonUpdateInput) => api.updateLesson(input),
  });

export const lessonReferencesQuery = (api: ApiClient, lessonId: string) =>
  defineQuery({
    queryKey: lessonsScopes.references(lessonId),
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.lessonReferences(lessonId, signal),
  });

export const deleteLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...lessonsScopes.all(), 'delete'],
    call: (lessonId: string) => api.deleteLesson(lessonId),
  });

export const lessonAttachmentsQuery = (api: ApiClient, lessonId: string) =>
  defineQuery({
    queryKey: lessonsScopes.attachments(lessonId),
    call: ({ signal }) => api.listLessonAttachments(lessonId, signal),
  });

export const uploadLessonAttachmentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...lessonsScopes.all(), 'upload-attachment'],
    call: (input: LessonAttachmentFileUpload) => api.uploadLessonAttachment(input),
  });

export const deleteLessonAttachmentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...lessonsScopes.all(), 'delete-attachment'],
    call: (input: { lessonId: string; attachmentId: string }) => api.deleteLessonAttachment(input),
  });

export const updateProductAccessItemsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'access-items'],
    call: (input: ProductsAccessItemsInput) => api.updateProductAccessItems(input),
  });

export const productAccessIssuesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: productsScopes.issues(),
    call: ({ signal }) => api.listProductAccessIssues(signal),
  });

export const studentCoursesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: studentScopes.courses(),
    call: ({ signal }) => api.studentCourses(signal),
  });

export const courseStructureQuery = (api: ApiClient, courseId: string) =>
  defineQuery({
    queryKey: studentScopes.courseStructure(courseId),
    call: ({ signal }) => api.studentCourseStructure(courseId, signal),
  });

export const studentLessonQuery = (api: ApiClient, lessonId: string) =>
  defineQuery({
    queryKey: studentScopes.lesson(lessonId),
    call: ({ signal }) => api.studentLesson(lessonId, signal),
  });

export const studentLessonAttachmentsQuery = (api: ApiClient, lessonId: string) =>
  defineQuery({
    queryKey: studentScopes.attachments(lessonId),
    call: ({ signal }) => api.studentLessonAttachments(lessonId, signal),
  });

export const nextLessonQuery = (api: ApiClient, lessonId: string) =>
  defineQuery({
    queryKey: studentScopes.nextLesson(lessonId),
    call: ({ signal }) => api.nextLesson(lessonId, signal),
  });

export const studentProgressQuery = (api: ApiClient, courseId: string) =>
  defineQuery({
    queryKey: studentScopes.progress(courseId),
    call: ({ signal }) => api.studentProgress(courseId, signal),
  });

export const completeLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...studentScopes.all(), 'complete-lesson'],
    call: (input: LessonCompleteInput) => api.completeLesson(input),
  });

export const uncompleteLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...studentScopes.all(), 'uncomplete-lesson'],
    call: (input: LessonUncompleteInput) => api.uncompleteLesson(input),
  });

export const updateLastViewedMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...studentScopes.all(), 'last-viewed'],
    call: (input: LastViewedInput) => api.updateLastViewed(input),
  });

export const discussionQuery = (api: ApiClient, input: DiscussionGetInput) =>
  defineQuery({
    queryKey: discussionScopes.lesson(input.contextId, input.limit),
    call: ({ signal }) => api.discussion(input, signal),
  });

export const createPostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'create-post'],
    call: (input: PostCreateInput) => api.createPost(input),
  });

export const updatePostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'update-post'],
    call: (input: PostUpdateInput) => api.updatePost(input),
  });

export const deletePostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'delete-post'],
    call: (input: PostDeleteInput) => api.deletePost(input),
  });

export const subscribeThreadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'subscribe'],
    call: (input: { rootPostId: string }) => api.subscribeThread(input),
  });

export const muteThreadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'mute'],
    call: (input: { rootPostId: string }) => api.muteThread(input),
  });

export const postsSearchQuery = (api: ApiClient, input: PostsSearchInput) =>
  defineQuery({
    queryKey: discussionScopes.search(input.query, input.lessonIds ?? [], input.spaceIds ?? []),
    call: ({ signal }) => api.searchPosts(input, signal),
  });

export const spacesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: spacesScopes.lists(),
    call: ({ signal }) => api.listSpaces(signal),
  });

export const staffSpacesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: spacesScopes.staff(),
    call: ({ signal }) => api.listStaffSpaces(signal),
  });

export const archiveSpaceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'archive'],
    call: (input: SpaceArchiveInput) => api.archiveSpace(input),
  });

export const createSpaceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'create'],
    call: (input: SpaceCreateInput) => api.createSpace(input),
  });

export const updateSpaceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'update'],
    call: (input: SpaceUpdateInput) => api.updateSpace(input),
  });

export const spaceFeedQuery = (api: ApiClient, input: SpaceFeedGetInput) =>
  defineQuery({
    queryKey: spacesScopes.feed(input.spaceId, input.limit),
    call: ({ signal }) => api.spaceFeed(input, signal),
  });

export const followSpaceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'follow'],
    call: (input: SpaceFollowInput) => api.followSpace(input),
  });

export const unfollowSpaceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'unfollow'],
    call: (input: SpaceFollowInput) => api.unfollowSpace(input),
  });

export const markSpaceSeenMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'seen'],
    call: (input: SpaceSeenInput) => api.markSpaceSeen(input),
  });

export const reactToPostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'react'],
    call: (input: PostReactInput) => api.reactToPost(input),
  });

export const pinPostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'pin'],
    call: (input: PostPinInput) => api.pinPost(input),
  });

export const reportsQuery = (api: ApiClient, input: ReportsListInput = {}) =>
  defineQuery({
    queryKey: reportScopes.list(input),
    call: ({ signal }) => api.listReports(input, signal),
  });

export const reportPostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'report'],
    call: (input: PostReportInput) => api.reportPost(input),
  });

export const resolveReportMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...reportScopes.all(), 'resolve'],
    call: (input: ReportResolveInput) => api.resolveReport(input),
  });

export const reportsInvalidates = () => ({ queryKey: reportScopes.all() });

export const unreactToPostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...spacesScopes.all(), 'unreact'],
    call: (input: PostReactInput) => api.unreactToPost(input),
  });

export const spacesInvalidates = () => ({ queryKey: spacesScopes.all() });

export const notificationsQuery = (api: ApiClient, input: NotificationsListInput = {}) =>
  defineQuery({
    queryKey: notificationScopes.list(),
    call: ({ signal }) => api.listNotifications(input, signal),
  });

export const notificationsPageQuery = (api: ApiClient, input: NotificationsListInput = {}) =>
  defineQuery({
    queryKey: notificationScopes.page(input.limit),
    call: ({ signal }) => api.listNotifications(input, signal),
  });

export const unreadNotificationsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: notificationScopes.unread(),
    call: ({ signal }) => api.unreadNotificationCount(signal),
  });

export const markNotificationReadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...notificationScopes.all(), 'read'],
    call: (input: NotificationReadInput) => api.markNotificationRead(input),
  });

export const markAllNotificationsReadMutation = (
  api: ApiClient,
): MutationDescriptor<{ read: number }, void> =>
  defineMutation({
    mutationKey: [...notificationScopes.all(), 'read-all'],
    call: () => api.markAllNotificationsRead(),
  });

/** @public */
export const conversationsQuery = (api: ApiClient, input: MessagesListInput = {}) =>
  defineQuery({
    queryKey: messagesScopes.list(input.limit),
    call: ({ signal }) => api.listConversations(input, signal),
  });

/** @public */
export const conversationQuery = (api: ApiClient, input: MessagesThreadInput) =>
  defineQuery({
    queryKey: messagesScopes.thread(input.conversationId, input.limit),
    call: ({ signal }) => api.getConversation(input, signal),
  });

/** @public */
export const unreadMessagesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: messagesScopes.unread(),
    call: ({ signal }) => api.unreadMessageCount(signal),
  });

/** @public */
export const startConversationMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...messagesScopes.all(), 'start'],
    call: (input: MessagesStartInput) => api.startConversation(input),
  });

/** @public */
export const sendMessageMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...messagesScopes.all(), 'send'],
    call: (input: MessagesSendInput) => api.sendMessage(input),
  });

/** @public */
export const markConversationReadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...messagesScopes.all(), 'read'],
    call: (input: MessagesReadInput) => api.markConversationRead(input),
  });

/** @public */
export const spaceEventsQuery = (api: ApiClient, input: EventsBySpaceInput) =>
  defineQuery({
    queryKey: eventsScopes.bySpace(input),
    call: ({ signal }) => api.listSpaceEvents(input, signal),
  });

/** @public */
export const eventQuery = (api: ApiClient, input: EventRefInput) =>
  defineQuery({
    queryKey: eventsScopes.detail(input.eventId),
    call: ({ signal }) => api.getEvent(input, signal),
  });

/** @public */
export const upcomingEventsQuery = (api: ApiClient, input: MemberUpcomingEventsInput = {}) =>
  defineQuery({
    queryKey: eventsScopes.upcoming(input.limit),
    call: ({ signal }) => api.listUpcomingEvents(input, signal),
  });

/** @public */
export const eventIcsQuery = (api: ApiClient, input: EventRefInput) =>
  defineQuery({
    queryKey: eventsScopes.ics(input.eventId),
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.getEventIcs(input, signal),
  });

/** @public */
export const createEventMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...eventsScopes.all(), 'create'],
    call: (input: EventCreateInput) => api.createEvent(input),
  });

/** @public */
export const updateEventMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...eventsScopes.all(), 'update'],
    call: (input: EventUpdateInput) => api.updateEvent(input),
  });

/** @public */
export const deleteEventMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...eventsScopes.all(), 'delete'],
    call: (input: EventRefInput) => api.deleteEvent(input),
  });

/** @public */
export const rsvpEventMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...eventsScopes.all(), 'rsvp'],
    call: (input: EventRsvpInput) => api.rsvpEvent(input),
  });

export const tenantSecretsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantSecretsScopes.lists(),
    call: ({ signal }) => api.listTenantSecrets(signal),
  });

export const apiKeysQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: apiKeyScopes.lists(),
    call: ({ signal }) => api.listApiKeys(signal),
  });

export const apiKeyImportAuditQuery = (api: ApiClient, input: ApiKeyImportAuditQuery) =>
  defineQuery({
    queryKey: apiKeyScopes.audit(input),
    call: ({ signal }) => api.listApiKeyImportAudit(input, signal),
  });

export const createApiKeyMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...apiKeyScopes.all(), 'create'],
    call: (input: ApiKeyCreateInput) => api.createApiKey(input),
  });

export const revokeApiKeyMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...apiKeyScopes.all(), 'revoke'],
    call: (input: ApiKeyRevokeInput) => api.revokeApiKey(input),
  });

export const apiKeysInvalidates = () => ({ queryKey: apiKeyScopes.all() });

export const setTenantSecretMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'set'],
    call: (input: TenantSecretSetInput) => api.setTenantSecret(input),
  });

export const deleteTenantSecretMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'delete'],
    call: (input: TenantSecretDeleteInput) => api.deleteTenantSecret(input),
  });

export const deleteStripeSecretsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'delete-stripe'],
    call: async () => {
      const webhookSecret = await api.deleteTenantSecret({ key: 'stripe.webhookSecret' });
      if (!webhookSecret.ok) return webhookSecret;
      return api.deleteTenantSecret({ key: 'stripe.restrictedKey' });
    },
  });

export const testIntegrationMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'provider-test'],
    call: (input: IntegrationTestInput) => api.testIntegration(input),
  });

export const probeStorageMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'storage-probe'],
    call: (input: StorageProbeInput) => api.probeStorage(input),
  });

export const configureStorageMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'storage-configure'],
    call: (input: StorageConfigureInput) => api.configureStorage(input),
  });

export const configureStripeMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'configure-stripe'],
    call: (input: StripeConfigureInput) => api.configureStripe(input),
  });

export const testIfirmaConnectionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'ifirma-test'],
    call: () => api.testIfirmaConnection(),
  });

export const testKsefConnectionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'ksef-test'],
    call: () => api.testKsefConnection(),
  });

export const bunnyVideosQuery = (api: ApiClient, input: { search?: string; page?: number } = {}) =>
  defineQuery({
    queryKey: bunnyScopes.videos(input.search ?? '', input.page ?? 1),
    call: ({ signal }) => api.listBunnyVideos(input, signal),
  });

export const testBunnyConnectionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'bunny-test'],
    call: () => api.testBunnyConnection(),
  });

export const tenantSecretsInvalidates = () => ({ queryKey: tenantSecretsScopes.lists() });

export const tenantSettingsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantSettingsScopes.all(),
    call: ({ signal }) => api.getTenantSettings(signal),
  });

export const updateTenantSettingsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSettingsScopes.all(), 'update'],
    call: (input: TenantSettingsUpdateInput) => api.updateTenantSettings(input),
  });

export const tenantSettingsInvalidates = () => ({ queryKey: tenantSettingsScopes.all() });

export const sendSupportMessageMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['support', 'message'],
    call: (input: SupportMessageInput) => api.sendSupportMessage(input),
  });

export const onboardingQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: onboardingScopes.all(),
    call: ({ signal }) => api.getOnboarding(signal),
  });

export const dismissOnboardingMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...onboardingScopes.all(), 'dismiss'],
    call: () => api.dismissOnboarding(),
  });

export const onboardingInvalidates = () => ({ queryKey: onboardingScopes.all() });

/** Invalidation filters for the course tree editor (courses, modules, lessons). */
export const coursesInvalidates = () => ({ queryKey: coursesScopes.lists() });

export const modulesInvalidates = () => ({ queryKey: modulesScopes.all() });

export const lessonsInvalidates = () => ({ queryKey: lessonsScopes.all() });

export const lessonAttachmentsInvalidates = (lessonId: string) => ({
  queryKey: lessonsScopes.attachments(lessonId),
});

/** The invalidation filter product mutations apply after they settle. */
export const productsInvalidates = () => ({ queryKey: productsScopes.all() });

/** The invalidation filter a simulated purchase applies after it settles. */
export const myProductsInvalidates = () => ({ queryKey: myProductsScopes.all() });

/** Every surface that changes a member's progress or follow state refreshes the shell aggregate. */
export const memberNavigationInvalidates = () => ({ queryKey: memberNavigationScopes.all() });

/** Every surface that adds or removes a space post refreshes the aggregated home feed. */
export const memberHomeFeedInvalidates = () => ({ queryKey: memberHomeFeedScopes.all() });

export const membersInvalidates = () => ({ queryKey: membersScopes.all() });

export const setMemberBannedMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'ban'],
    call: (input: MemberBanInput) => api.setMemberBanned(input),
  });

export const memberGrantsInvalidates = (memberId: string) => ({ queryKey: membersScopes.grants(memberId) });

export const memberLearningSummaryInvalidates = (memberId: string) => ({
  queryKey: membersScopes.learningSummary(memberId),
});

/** Invalidation filter progress mutations apply to refresh a course's tree. */
export const studentCourseInvalidates = () => ({ queryKey: studentScopes.all() });

export const notificationsInvalidates = () => ({ queryKey: notificationScopes.all() });

/** @public */
export const messagesInvalidates = () => ({ queryKey: messagesScopes.all() });

/** @public */
export const eventsInvalidates = () => ({ queryKey: eventsScopes.all() });

export const discussionInvalidates = () => ({ queryKey: discussionScopes.all() });

/**
 * Auth side effects are mutation descriptors over `AuthClientPort` like any
 * other action — never hand-rolled pending/error state around a port call.
 */
export const signUpMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-up'],
    call: (input: Parameters<AuthClientPort['signUp']>[0]) => auth.signUp(input),
  });

export const signInMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in'],
    call: (input: { email: string; password: string }) => auth.signIn(input),
  });

export const requestMagicLinkMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'magic-link'],
    call: (input: { email: string; callbackURL: string; language?: string }) => auth.requestMagicLink(input),
  });

export const sendVerificationEmailMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'send-verification-email'],
    call: (input: Parameters<AuthClientPort['sendVerificationEmail']>[0]) =>
      auth.sendVerificationEmail(input),
  });

export const requestPasswordResetMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'request-password-reset'],
    call: (input: Parameters<AuthClientPort['requestPasswordReset']>[0]) => auth.requestPasswordReset(input),
  });

export const resetPasswordMutation = (auth: AuthClientPort): MutationDescriptor<AuthSessionResult, { token: string; newPassword: string }> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'reset-password'],
    call: (input: { token: string; newPassword: string }) => auth.resetPassword(input),
  });

export const changePasswordMutation = (
  auth: AuthClientPort,
): MutationDescriptor<void, {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
}> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'change-password'],
    call: (input) => auth.changePassword(input),
  });

export const signOutMutation = (auth: AuthClientPort): MutationDescriptor<void, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-out'],
    call: () => auth.signOut(),
  });

export const registerPasskeyMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'register-passkey'],
    call: (input: { name: string; password: string }) => auth.registerPasskey(input),
  });

export const passkeysQuery = (auth: AuthClientPort) =>
  defineQuery({
    queryKey: [...authScopes.all(), 'passkeys'],
    call: () => auth.listPasskeys(),
  });

export const passkeysInvalidates = () => ({ queryKey: [...authScopes.all(), 'passkeys'] });

export const removePasskeyMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'remove-passkey'],
    call: (input: { id: string; password: string }) => auth.removePasskey(input),
  });

export const signInWithPasskeyMutation = (auth: AuthClientPort): MutationDescriptor<AuthSessionResult, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in-passkey'],
    call: () => auth.signInWithPasskey(),
  });

export const enableTwoFactorMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'enable-two-factor'],
    call: (input: { password: string }) => auth.enableTwoFactor(input.password),
  });

export const verifyTotpMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'verify-totp'],
    call: (input: { code: string }) => auth.verifyTotp(input.code),
  });

export const verifyBackupCodeMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'verify-backup-code'],
    call: (input: { code: string }) => auth.verifyBackupCode(input.code),
  });

export const disableTwoFactorMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'disable-two-factor'],
    call: (input: { password: string }) => auth.disableTwoFactor(input.password),
  });

export const regenerateBackupCodesMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'regenerate-backup-codes'],
    call: (input: { password: string }) => auth.regenerateBackupCodes(input.password),
  });

export const signInWithGoogleMutation = (auth: AuthClientPort): MutationDescriptor<void, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in-google'],
    call: () => auth.signInWithGoogle(),
  });
