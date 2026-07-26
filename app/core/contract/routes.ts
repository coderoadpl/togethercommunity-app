import { z } from 'zod';

import {
  attachModuleToCourseInputSchema,
  checkoutSessionInputSchema,
  courseLessonSchema,
  courseModuleSchema,
  courseSchema,
  courseStructureWithAccessSchema,
  createPostInputSchema,
  createSpaceInputSchema,
  deletePostInputSchema,
  deleteSpaceInputSchema,
  followSpaceInputSchema,
  listSpaceFeedInputSchema,
  memberSpaceSchema,
  reactToPostInputSchema,
  reactionSummarySchema,
  setSpaceArchivedInputSchema,
  spaceFeedSchema,
  spaceSchema,
  staffSpaceSchema,
  updateSpaceInputSchema,
  detachModuleFromCourseInputSchema,
  discussionSchema,
  lessonReferencesSchema,
  listDiscussionInputSchema,
  createApiKeyInputSchema,
  creatorOnboardingSchema,
  courseHistoryEntrySchema,
  courseHistoryQuerySchema,
  entityVersionDetailSchema,
  grantProductToMemberInputSchema,
  grantWindowStatusSchema,
  languageSchema,
  listOrdersQuerySchema,
  listStreamVideosInputSchema,
  m2mEnrollInputSchema,
  memberSubscriptionSchema,
  memberSubscriptionSummarySchema,
  newProductPriceSchema,
  orderListItemSchema,
  priceIntervalSchema,
  priceKindSchema,
  productPriceSchema,
  orderExportFileSchema,
  playableCourseLessonSchema,
  exportOrdersQuerySchema,
  salesSummarySchema,
  memberExportFileSchema,
  memberGrantSchema,
  memberLearningSummarySchema,
  memberWithProductIdsSchema,
  muteThreadInputSchema,
  revokeGrantInputSchema,
  membershipSchema,
  newCourseLessonSchema,
  newCourseModuleSchema,
  newCourseSchema,
  notificationListInputSchema,
  notificationMarkReadInputSchema,
  notificationSchema,
  newProductSchema,
  nextLessonSchema,
  publicPostSchema,
  postSearchHitSchema,
  productAccessIssuesSchema,
  productSchema,
  progressViewSchema,
  searchPostsInputSchema,
  setTenantSecretInputSchema,
  staffRoleSchema,
  streamVideoPageSchema,
  subscribeThreadInputSchema,
  tenantApiKeyPublicSchema,
  tenantBrandingSchema,
  tenantSchema,
  tenantSecretKeySchema,
  tenantSecretMaskedSchema,
  tenantSettingsSchema,
  campaignSchema,
  campaignEngagementStatsSchema,
  consentDefinitionVersionSchema,
  consentDocumentRefSchema,
  consentDefinitionSchema,
  emailEventSchema,
  emailLayoutSchema,
  emailSendExportFileSchema,
  emailSendExportQuerySchema,
  emailSendListQuerySchema,
  emailSendProjectionSchema,
  schedulerRunListQuerySchema,
  schedulerRunSchema,
  schedulerRunTenantItemSchema,
  schedulerRunTenantSchema,
  schedulerRunTenantSummarySchema,
  suppressionSchema,
  tenantDocumentSchema,
  tenantDocumentVersionSchema,
  tenantSesSettingsSchema,
  updateTenantSettingsInputSchema,
  updateCourseInputSchema,
  updateCourseLessonInputSchema,
  updateCourseModuleInputSchema,
  updateLastViewedInputSchema,
  updatePostInputSchema,
  updateProductAccessItemsInputSchema,
} from '@core/domain/index.js';

/**
 * Single source of truth for the HTTP API shared by server and all clients.
 * Every route is described by its method, path and zod schemas; the server
 * implements them, `core/client` consumes them. Neither side hand-writes URLs
 * or response types anywhere else.
 */

export const healthOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  database: z.enum(['up', 'down']),
});

export const emailDispatchOutputSchema = z.object({
  attemptsMade: z.number().int().nonnegative(),
  sentCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
});

export const EMAIL_DISPATCH_SECRET_HEADER = 'x-email-dispatch-secret';

export const authConfigOutputSchema = z.object({
  googleEnabled: z.boolean(),
  passkeysEnabled: z.boolean(),
  totpEnabled: z.boolean(),
  exposeMagicLinks: z.boolean(),
});

export const meOutputSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  tenant: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      staffRole: staffRoleSchema.nullable(),
      memberId: z.string().nullable(),
    })
    .nullable(),
});

export const tenantListOutputSchema = z.object({
  tenants: z.array(membershipSchema),
});

export const productsListOutputSchema = z.object({
  products: z.array(productSchema),
});

export const publicOfferPriceSchema = z.object({
  id: z.string(),
  kind: priceKindSchema,
  interval: priceIntervalSchema.nullable(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const publicLegalUrlsSchema = z.object({
  termsUrl: z.string().nullable().default(null),
  privacyUrl: z.string().nullable().default(null),
});

export const publicOfferOutputSchema = z.object({
  tenant: z.object({
    slug: z.string(),
    name: z.string(),
    branding: tenantBrandingSchema.default({}),
    legal: publicLegalUrlsSchema.default({}),
  }),
  contentVersion: z.number().int().positive(),
  products: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      priceCents: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      prices: z.array(publicOfferPriceSchema),
    }),
  ),
});

export const publicPaymentConfigOutputSchema = z.object({
  stripeConfigured: z.boolean(),
  simulatedPaymentsEnabled: z.boolean(),
});

export const checkoutSessionRequestSchema = checkoutSessionInputSchema;

export type CheckoutSessionRequest = z.input<typeof checkoutSessionRequestSchema>;

export const checkoutSessionOutputSchema = z.object({
  url: z.string().url(),
});

export const termsConsentOutputSchema = z.object({
  recorded: z.boolean(),
});

export const termsConsentRequestSchema = z.object({
  accepted: z.boolean(),
});

export type TermsConsentRequest = z.input<typeof termsConsentRequestSchema>;

export const stripeWebhookOutputSchema = z.object({
  received: z.literal(true),
  processed: z.boolean(),
});

export const myProductsOutputSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      priceCents: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      grantStatus: grantWindowStatusSchema,
      grantStartsAt: z.string().datetime(),
      grantExpiresAt: z.string().datetime().nullable(),
      subscription: memberSubscriptionSummarySchema.nullable(),
    }),
  ),
});

export const membersListOutputSchema = z.object({
  members: z.array(memberWithProductIdsSchema),
});

export const membersExportOutputSchema = memberExportFileSchema;

export const memberRemoveInputSchema = z.object({
  memberId: z.string().min(1),
});

export type MemberRemoveInput = z.input<typeof memberRemoveInputSchema>;

export const memberRemoveOutputSchema = z.object({
  memberId: z.string(),
});

export const memberGrantsOutputSchema = z.object({
  grants: z.array(memberGrantSchema),
});

export const memberLearningSummaryOutputSchema = z.object({
  summary: memberLearningSummarySchema,
});

export const memberProgressResetInputSchema = z.object({
  memberId: z.string().min(1),
  courseId: z.string().min(1),
});

export type MemberProgressResetInput = z.input<typeof memberProgressResetInputSchema>;

export const memberProgressResetOutputSchema = z.object({
  reset: z.object({
    memberId: z.string(),
    courseId: z.string(),
    clearedLessonCount: z.number().int().nonnegative(),
  }),
});

export const grantCreateInputSchema = grantProductToMemberInputSchema;

export type GrantCreateInput = z.input<typeof grantCreateInputSchema>;

export const grantCreateOutputSchema = z.object({
  memberId: z.string(),
  grantId: z.string(),
  renewed: z.boolean(),
});

export const grantRevokeInputSchema = revokeGrantInputSchema;

export type GrantRevokeInput = z.input<typeof grantRevokeInputSchema>;

export const grantRevokeOutputSchema = z.object({
  grantId: z.string(),
  expiresAt: z.string().datetime(),
});

export const magicLinkSchema = z.object({
  email: z.string(),
  url: z.string(),
  token: z.string(),
});

export const simulatePurchaseInputSchema = z.object({
  email: z.string().email(),
  productId: z.string().min(1),
  priceId: z.string().min(1).optional(),
  language: languageSchema.default('pl'),
  termsAccepted: z.boolean().optional(),
});

export type SimulatePurchaseInput = z.input<typeof simulatePurchaseInputSchema>;

export const simulatePurchaseOutputSchema = z.object({
  memberId: z.string(),
  productId: z.string(),
  alreadyOwned: z.boolean(),
  subscriptionId: z.string().nullable(),
  orderId: z.string().nullable(),
  magicLink: magicLinkSchema.nullable(),
});

export const productPricesListOutputSchema = z.object({
  prices: z.array(productPriceSchema),
});

export const productPriceCreateInputSchema = newProductPriceSchema;

export type ProductPriceCreateInput = z.input<typeof productPriceCreateInputSchema>;

export const productPriceCreateOutputSchema = z.object({
  price: productPriceSchema,
});

export const productPriceDeactivateInputSchema = z.object({
  id: z.string().min(1),
});

export type ProductPriceDeactivateInput = z.input<typeof productPriceDeactivateInputSchema>;

export const productPriceDeactivateOutputSchema = z.object({
  price: productPriceSchema,
});

export const ordersListQuerySchema = listOrdersQuerySchema;

export type OrdersListQueryInput = z.input<typeof ordersListQuerySchema>;

export const ordersListOutputSchema = z.object({
  orders: z.array(orderListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export const ordersExportQuerySchema = exportOrdersQuerySchema;

export type OrdersExportQueryInput = z.input<typeof ordersExportQuerySchema>;

export const ordersExportOutputSchema = orderExportFileSchema;

export const salesSummaryOutputSchema = z.object({
  summary: salesSummarySchema,
});

export const subscriptionSimulateInputSchema = z.object({
  subscriptionId: z.string().min(1),
});

export type SubscriptionSimulateInput = z.input<typeof subscriptionSimulateInputSchema>;

export const subscriptionSimulateOutputSchema = z.object({
  subscription: memberSubscriptionSchema,
  processed: z.boolean(),
});

export const devMagicLinkOutputSchema = z.object({
  magicLink: magicLinkSchema.nullable(),
});

export const devEmailSchema = z.object({
  to: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  headers: z.record(z.string()),
  messageId: z.string().nullable(),
  createdAt: z.string(),
});

export const devEmailOutputSchema = z.object({
  email: devEmailSchema.nullable(),
});

export const tenantCreateInputSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export type TenantCreateInput = z.input<typeof tenantCreateInputSchema>;

export const tenantCreateOutputSchema = z.object({
  tenant: tenantSchema,
});

export const productsCreateInputSchema = newProductSchema;

export const productsCreateOutputSchema = z.object({
  product: productSchema,
});

export const productsPublishInputSchema = z.object({
  id: z.string().min(1),
});

export type ProductsPublishInput = z.input<typeof productsPublishInputSchema>;

export const productsPublishOutputSchema = z.object({
  product: productSchema,
});

export const productsAccessItemsInputSchema = updateProductAccessItemsInputSchema;

export type ProductsAccessItemsInput = z.input<typeof productsAccessItemsInputSchema>;

export const productsAccessItemsOutputSchema = z.object({
  product: productSchema,
});

export const productsAccessIssuesOutputSchema = z.object({
  issues: z.array(productAccessIssuesSchema),
});

export const coursesListOutputSchema = z.object({
  courses: z.array(courseSchema),
});

export const modulesListOutputSchema = z.object({
  modules: z.array(courseModuleSchema),
});

export const lessonsListOutputSchema = z.object({
  lessons: z.array(courseLessonSchema),
});

export const courseCreateInputSchema = newCourseSchema;

export type CourseCreateInput = z.input<typeof courseCreateInputSchema>;

export const courseUpdateInputSchema = updateCourseInputSchema;

export type CourseUpdateInput = z.input<typeof courseUpdateInputSchema>;

export const courseOutputSchema = z.object({
  course: courseSchema,
});

export const moduleCreateInputSchema = newCourseModuleSchema;

export type ModuleCreateInput = z.input<typeof moduleCreateInputSchema>;

export const moduleUpdateInputSchema = updateCourseModuleInputSchema;

export type ModuleUpdateInput = z.input<typeof moduleUpdateInputSchema>;

export const moduleAttachInputSchema = attachModuleToCourseInputSchema;

export type ModuleAttachInput = z.input<typeof moduleAttachInputSchema>;

export const moduleDetachInputSchema = detachModuleFromCourseInputSchema;

export type ModuleDetachInput = z.input<typeof moduleDetachInputSchema>;

export const moduleOutputSchema = z.object({
  module: courseModuleSchema,
});

export const lessonCreateInputSchema = newCourseLessonSchema;

export type LessonCreateInput = z.input<typeof lessonCreateInputSchema>;

export const lessonUpdateInputSchema = updateCourseLessonInputSchema;

export type LessonUpdateInput = z.input<typeof lessonUpdateInputSchema>;

export const lessonOutputSchema = z.object({
  lesson: courseLessonSchema,
});

export const lessonReferencesOutputSchema = z.object({
  references: lessonReferencesSchema,
});

export const lessonDeleteOutputSchema = z.object({
  references: lessonReferencesSchema,
});

export const contentHistoryQuerySchema = courseHistoryQuerySchema;

export type ContentHistoryQueryInput = z.input<typeof contentHistoryQuerySchema>;

export const contentHistoryOutputSchema = z.object({
  versions: z.array(courseHistoryEntrySchema),
});

export const contentVersionOutputSchema = z.object({
  version: entityVersionDetailSchema,
});

export const studentCoursesOutputSchema = z.object({
  courses: z.array(courseSchema),
});

export const courseStructureOutputSchema = z.object({
  structure: courseStructureWithAccessSchema,
});

export const studentLessonOutputSchema = z.object({
  lesson: playableCourseLessonSchema,
});

export const lessonCompleteInputSchema = z.object({
  lessonId: z.string().min(1),
});

export type LessonCompleteInput = z.input<typeof lessonCompleteInputSchema>;

export const lessonUncompleteInputSchema = lessonCompleteInputSchema;

export type LessonUncompleteInput = z.input<typeof lessonUncompleteInputSchema>;

export const lastViewedInputSchema = updateLastViewedInputSchema;

export type LastViewedInput = z.input<typeof lastViewedInputSchema>;

export const progressOutputSchema = z.object({
  progress: progressViewSchema,
});

export const nextLessonOutputSchema = z.object({
  next: nextLessonSchema,
});

export const postCreateInputSchema = createPostInputSchema;

export type PostCreateInput = z.input<typeof postCreateInputSchema>;

export const postUpdateInputSchema = updatePostInputSchema;

export type PostUpdateInput = z.input<typeof postUpdateInputSchema>;

export const postDeleteInputSchema = deletePostInputSchema;

export type PostDeleteInput = z.input<typeof postDeleteInputSchema>;

export const postOutputSchema = z.object({
  post: publicPostSchema,
});

export const discussionGetInputSchema = listDiscussionInputSchema;

export type DiscussionGetInput = z.input<typeof discussionGetInputSchema>;

export const discussionOutputSchema = z.object({
  discussion: discussionSchema,
});

export const threadSubscribeInputSchema = subscribeThreadInputSchema;

export type ThreadSubscribeInput = z.input<typeof threadSubscribeInputSchema>;

export const threadMuteInputSchema = muteThreadInputSchema;

export type ThreadMuteInput = z.input<typeof threadMuteInputSchema>;

export const threadSubscriptionOutputSchema = z.object({
  rootPostId: z.string(),
});

export const spacesListOutputSchema = z.object({
  spaces: z.array(memberSpaceSchema),
});

export const staffSpacesListOutputSchema = z.object({
  spaces: z.array(staffSpaceSchema),
});

export const spaceCreateInputSchema = createSpaceInputSchema;

export type SpaceCreateInput = z.input<typeof spaceCreateInputSchema>;

export const spaceUpdateInputSchema = updateSpaceInputSchema;

export type SpaceUpdateInput = z.input<typeof spaceUpdateInputSchema>;

export const spaceDeleteInputSchema = deleteSpaceInputSchema;

export type SpaceDeleteInput = z.input<typeof spaceDeleteInputSchema>;

export const spaceArchiveInputSchema = setSpaceArchivedInputSchema;

export type SpaceArchiveInput = z.input<typeof spaceArchiveInputSchema>;

export const spaceOutputSchema = z.object({
  space: spaceSchema,
});

export const spaceDeleteOutputSchema = z.object({
  spaceId: z.string(),
});

export const spaceFeedGetInputSchema = listSpaceFeedInputSchema;

export type SpaceFeedGetInput = z.input<typeof spaceFeedGetInputSchema>;

export const spaceFeedOutputSchema = z.object({
  feed: spaceFeedSchema,
});

export const spaceFollowInputSchema = followSpaceInputSchema;

export type SpaceFollowInput = z.input<typeof spaceFollowInputSchema>;

export const spaceFollowOutputSchema = z.object({
  spaceId: z.string(),
  isFollowing: z.boolean(),
});

export const postReactInputSchema = reactToPostInputSchema;

export type PostReactInput = z.input<typeof postReactInputSchema>;

export const postReactOutputSchema = z.object({
  postId: z.string(),
  reactions: z.array(reactionSummarySchema),
});

export const postsSearchInputSchema = searchPostsInputSchema;

export type PostsSearchInput = z.input<typeof postsSearchInputSchema>;

export const postsSearchOutputSchema = z.object({
  hits: z.array(postSearchHitSchema),
});

export const notificationsListInputSchema = notificationListInputSchema;

export type NotificationsListInput = z.input<typeof notificationsListInputSchema>;

export const notificationsListOutputSchema = z.object({
  notifications: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});

export const notificationReadInputSchema = notificationMarkReadInputSchema;

export type NotificationReadInput = z.input<typeof notificationReadInputSchema>;

export const notificationReadOutputSchema = z.object({
  notification: notificationSchema,
});

export const notificationsReadAllOutputSchema = z.object({
  read: z.number().int().nonnegative(),
});

export const notificationsUnreadOutputSchema = z.object({
  unread: z.number().int().nonnegative(),
});

export const devGrantOutputSchema = z.object({
  memberId: z.string(),
  productId: z.string(),
  granted: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
});

export const apiKeysListOutputSchema = z.object({
  apiKeys: z.array(tenantApiKeyPublicSchema),
});

export const apiKeyCreateInputSchema = createApiKeyInputSchema;

export type ApiKeyCreateInput = z.input<typeof apiKeyCreateInputSchema>;

export const apiKeyCreateOutputSchema = z.object({
  apiKey: tenantApiKeyPublicSchema,
  secret: z.string(),
});

export const apiKeyRevokeInputSchema = z.object({
  id: z.string().min(1),
});

export type ApiKeyRevokeInput = z.input<typeof apiKeyRevokeInputSchema>;

export const apiKeyRevokeOutputSchema = z.object({
  apiKey: tenantApiKeyPublicSchema,
});

export const tenantSecretsListOutputSchema = z.object({
  secrets: z.array(tenantSecretMaskedSchema),
});

export const tenantSecretSetInputSchema = setTenantSecretInputSchema;

export type TenantSecretSetInput = z.input<typeof tenantSecretSetInputSchema>;

export const tenantSecretSetOutputSchema = z.object({
  secret: tenantSecretMaskedSchema,
});

export const tenantSecretDeleteInputSchema = z.object({
  key: tenantSecretKeySchema,
});

export type TenantSecretDeleteInput = z.input<typeof tenantSecretDeleteInputSchema>;

export const tenantSecretDeleteOutputSchema = z.object({
  key: tenantSecretKeySchema,
});

export const tenantSettingsOutputSchema = z.object({
  settings: tenantSettingsSchema,
});

export const onboardingOutputSchema = z.object({
  onboarding: creatorOnboardingSchema,
});

export const tenantSettingsUpdateInputSchema = updateTenantSettingsInputSchema;

export type TenantSettingsUpdateInput = z.input<typeof tenantSettingsUpdateInputSchema>;

export const stripeTestConnectionOutputSchema = z.object({
  ok: z.literal(true),
  diagnostic: z.string(),
});

export const bunnyVideosInputSchema = listStreamVideosInputSchema;

export const bunnyVideosOutputSchema = z.object({
  page: streamVideoPageSchema,
});

export const bunnyTestConnectionOutputSchema = z.object({
  ok: z.literal(true),
  diagnostic: z.string(),
});

export const m2mEnrollRequestSchema = m2mEnrollInputSchema;

export type M2mEnrollRequest = z.input<typeof m2mEnrollRequestSchema>;

export const m2mEnrollOutputSchema = z.object({
  memberId: z.string(),
  grantId: z.string(),
  renewed: z.boolean(),
  magicLink: magicLinkSchema.nullable(),
});

export const marketingConsentDefinitionCreateInputSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().trim().min(1),
  doubleOptIn: z.boolean().default(true),
  documentRef: consentDocumentRefSchema,
});

export const marketingConsentDefinitionsOutputSchema = z.object({ definitions: z.array(consentDefinitionSchema) });
export const marketingConsentDefinitionOutputSchema = z.object({ definition: consentDefinitionSchema.nullable() });
export const marketingConsentDefinitionDetailOutputSchema = z.object({
  definition: consentDefinitionSchema,
  versions: z.array(consentDefinitionVersionSchema),
});
export const marketingConsentDefinitionUpdateInputSchema = z.object({
  definitionId: z.string().min(1),
  label: z.string().trim().min(1),
  doubleOptIn: z.boolean(),
  documentRef: consentDocumentRefSchema,
  status: z.enum(['active', 'archived']),
});
export const marketingCampaignCreateInputSchema = z.object({
  name: z.string().trim().min(1), subject: z.string().trim().min(1),
  bodyHtml: z.string().min(1), consentDefinitionId: z.string().min(1),
  productIds: z.array(z.string().min(1)).default([]),
  layoutId: z.string().min(1).nullable().default(null),
});
export const marketingCampaignScheduleInputSchema = z.object({ campaignId: z.string().min(1), sendAt: z.string().datetime() });
export const marketingCampaignUpdateInputSchema = marketingCampaignCreateInputSchema.extend({ campaignId: z.string().min(1) });
export const marketingCampaignActionInputSchema = z.object({
  campaignId: z.string().min(1),
  action: z.enum(['pause', 'resume', 'cancel']),
});
export const marketingAudiencePreviewInputSchema = z.object({
  consentDefinitionId: z.string().min(1),
  productIds: z.array(z.string().min(1)).default([]),
});
export const marketingAudiencePreviewOutputSchema = z.object({ count: z.number().int().nonnegative() });
export const marketingCampaignOutputSchema = z.object({ campaign: campaignSchema });
export const marketingCampaignDetailOutputSchema = z.object({
  campaign: campaignSchema.extend({ engagement: campaignEngagementStatsSchema }),
});
export const marketingCampaignsOutputSchema = z.object({
  campaigns: z.array(campaignSchema.extend({ engagement: campaignEngagementStatsSchema })),
});
export const marketingCampaignTestOutputSchema = z.object({ sent: z.literal(true) });
export const marketingDocumentsOutputSchema = z.object({ documents: z.array(tenantDocumentSchema) });
export const marketingDocumentDetailOutputSchema = z.object({
  document: tenantDocumentSchema,
  versions: z.array(tenantDocumentVersionSchema),
});
export const marketingDocumentCreateInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
});
export const marketingDocumentUpdateInputSchema = z.object({
  documentId: z.string().min(1), title: z.string().trim().min(1), content: z.string().trim().min(1),
});
export const marketingDocumentPublishInputSchema = z.object({ documentId: z.string().min(1) });
export const marketingLayoutsOutputSchema = z.object({ layouts: z.array(emailLayoutSchema) });
export const marketingLayoutOutputSchema = z.object({ layout: emailLayoutSchema });
export const marketingLayoutSaveInputSchema = z.object({
  layoutId: z.string().min(1).optional(), name: z.string().trim().min(1), bodyHtml: z.string().min(1),
});
export const marketingSesSettingsOutputSchema = z.object({
  settings: tenantSesSettingsSchema.nullable(),
  credentialsConfigured: z.boolean(),
  webhookUrl: z.string().url().nullable(),
});
export const marketingSesSettingsUpdateInputSchema = z.object({
  fromAddress: z.string().email(),
  fromName: z.string().trim().min(1),
  identity: z.string().trim().min(1),
  identityVerified: z.boolean(),
  configurationSet: z.string().trim().min(1).nullable(),
  snsTopicArn: z.string().trim().min(1).nullable(),
  trackingEnabled: z.boolean(),
  footerLegalName: z.string(),
  footerAddress: z.string(),
});
export const marketingSuppressionCreateInputSchema = z.object({ email: z.string().email(), sourceRef: z.string().min(1).nullable().default(null) });
export const marketingSuppressionsOutputSchema = z.object({ suppressions: z.array(suppressionSchema), nextCursor: z.string().nullable() });
export const marketingSuppressionOutputSchema = z.object({ suppression: suppressionSchema });
export const emailSendsOutputSchema = z.object({
  sends: z.array(emailSendProjectionSchema),
  nextCursor: z.string().nullable(),
});
export const emailSendDetailOutputSchema = z.object({
  send: emailSendProjectionSchema,
  events: z.array(emailEventSchema),
});
export const memberEmailSendsOutputSchema = z.object({ sends: z.array(emailSendProjectionSchema) });
export const emailSendsExportOutputSchema = emailSendExportFileSchema;
export const emailSendsQuerySchema = emailSendListQuerySchema;
export const emailSendsExportQuerySchema = emailSendExportQuerySchema;
export const schedulerRunsQuerySchema = schedulerRunListQuerySchema;
export const tenantSchedulerRunsOutputSchema = z.object({
  items: z.array(schedulerRunTenantItemSchema),
  summary: schedulerRunTenantSummarySchema,
  nextCursor: z.string().nullable(),
});
export const tenantSchedulerRunOutputSchema = schedulerRunTenantItemSchema;
export const globalSchedulerRunsOutputSchema = z.object({
  runs: z.array(schedulerRunSchema),
  nextCursor: z.string().nullable(),
});
export const globalSchedulerRunOutputSchema = z.object({
  run: schedulerRunSchema,
  tenants: z.array(schedulerRunTenantSchema),
});
export type MarketingConsentDefinitionCreateInput = z.input<typeof marketingConsentDefinitionCreateInputSchema>;
export type MarketingCampaignCreateInput = z.input<typeof marketingCampaignCreateInputSchema>;
export type MarketingCampaignScheduleInput = z.input<typeof marketingCampaignScheduleInputSchema>;
export type MarketingCampaignUpdateInput = z.input<typeof marketingCampaignUpdateInputSchema>;
export type MarketingCampaignActionInput = z.input<typeof marketingCampaignActionInputSchema>;
export type MarketingAudiencePreviewInput = z.input<typeof marketingAudiencePreviewInputSchema>;
export type MarketingConsentDefinitionUpdateInput = z.input<typeof marketingConsentDefinitionUpdateInputSchema>;
export type MarketingDocumentCreateInput = z.input<typeof marketingDocumentCreateInputSchema>;
export type MarketingDocumentUpdateInput = z.input<typeof marketingDocumentUpdateInputSchema>;
export type MarketingDocumentPublishInput = z.input<typeof marketingDocumentPublishInputSchema>;
export type MarketingLayoutSaveInput = z.input<typeof marketingLayoutSaveInputSchema>;
export type MarketingSesSettingsUpdateInput = z.input<typeof marketingSesSettingsUpdateInputSchema>;
export type MarketingSuppressionCreateInput = z.input<typeof marketingSuppressionCreateInputSchema>;
export type EmailSendsQueryInput = z.input<typeof emailSendsQuerySchema>;
export type EmailSendsExportQueryInput = z.input<typeof emailSendsExportQuerySchema>;
export type SchedulerRunsQueryInput = z.input<typeof schedulerRunsQuerySchema>;

/**
 * Every route carries its HTTP method so clients can discriminate reads from
 * writes at the type level (CQRS partition). Safe GETs are queries; unsafe
 * verbs are commands. `core/client` brands its call surface from these methods.
 */
export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health' },
  emailDispatch: { method: 'POST', path: '/api/internal/dispatch-email' },
  publicOffer: { method: 'GET', path: '/api/public/offer' },
  publicPaymentConfig: { method: 'GET', path: '/api/public/payment-config' },
  checkoutSession: { method: 'POST', path: '/api/public/checkout/session' },
  termsConsent: { method: 'POST', path: '/api/public/terms-consent' },
  authConfig: { method: 'GET', path: '/api/public/auth-config' },
  me: { method: 'GET', path: '/api/me' },
  tenants: { method: 'GET', path: '/api/tenants' },
  tenantsCreate: { method: 'POST', path: '/api/tenants' },
  products: { method: 'GET', path: '/api/products' },
  productsCreate: { method: 'POST', path: '/api/products' },
  productsPublish: { method: 'POST', path: '/api/products/publish' },
  productsAccessItems: { method: 'POST', path: '/api/products/access-items' },
  productsAccessIssues: { method: 'GET', path: '/api/products/access-issues' },
  productPricesCreate: { method: 'POST', path: '/api/products/prices' },
  productPriceDeactivate: { method: 'POST', path: '/api/products/prices/deactivate' },
  productPrices: { method: 'GET', path: '/api/products/:productId/prices' },
  orders: { method: 'GET', path: '/api/orders' },
  ordersExport: { method: 'GET', path: '/api/orders/export' },
  salesSummary: { method: 'GET', path: '/api/sales/summary' },
  courses: { method: 'GET', path: '/api/courses' },
  coursesCreate: { method: 'POST', path: '/api/courses' },
  coursesUpdate: { method: 'POST', path: '/api/courses/update' },
  coursesHistory: { method: 'GET', path: '/api/courses/history' },
  coursesHistoryVersion: { method: 'GET', path: '/api/courses/history/version' },
  modules: { method: 'GET', path: '/api/modules' },
  modulesCreate: { method: 'POST', path: '/api/modules' },
  modulesUpdate: { method: 'POST', path: '/api/modules/update' },
  modulesAttach: { method: 'POST', path: '/api/modules/attach' },
  modulesDetach: { method: 'POST', path: '/api/modules/detach' },
  lessons: { method: 'GET', path: '/api/lessons' },
  lessonsCreate: { method: 'POST', path: '/api/lessons' },
  lessonsUpdate: { method: 'POST', path: '/api/lessons/update' },
  lessonReferences: { method: 'GET', path: '/api/lessons/references' },
  lessonsDelete: { method: 'DELETE', path: '/api/lessons/:lessonId' },
  studentCourses: { method: 'GET', path: '/api/student/courses' },
  studentCourseStructure: { method: 'GET', path: '/api/student/courses/:courseId/structure' },
  studentLesson: { method: 'GET', path: '/api/student/lessons/:lessonId' },
  studentLessonComplete: { method: 'POST', path: '/api/student/lessons/complete' },
  studentLessonUncomplete: { method: 'POST', path: '/api/student/lessons/uncomplete' },
  studentLessonNext: { method: 'GET', path: '/api/student/lessons/next' },
  studentLastViewed: { method: 'POST', path: '/api/student/progress/last-viewed' },
  studentProgress: { method: 'GET', path: '/api/student/progress' },
  postsCreate: { method: 'POST', path: '/api/posts' },
  postsUpdate: { method: 'POST', path: '/api/posts/update' },
  postsDelete: { method: 'DELETE', path: '/api/posts/:postId' },
  discussion: { method: 'GET', path: '/api/discussion' },
  threadSubscribe: { method: 'POST', path: '/api/discussion/subscribe' },
  threadMute: { method: 'POST', path: '/api/discussion/mute' },
  postsSearch: { method: 'GET', path: '/api/posts/search' },
  postsReact: { method: 'POST', path: '/api/posts/react' },
  postsUnreact: { method: 'POST', path: '/api/posts/unreact' },
  spaces: { method: 'GET', path: '/api/spaces' },
  spacesStaff: { method: 'GET', path: '/api/spaces/staff' },
  spacesCreate: { method: 'POST', path: '/api/spaces' },
  spacesUpdate: { method: 'POST', path: '/api/spaces/update' },
  spacesArchive: { method: 'POST', path: '/api/spaces/archive' },
  spacesDelete: { method: 'DELETE', path: '/api/spaces/:spaceId' },
  spaceFeed: { method: 'GET', path: '/api/spaces/:spaceId/feed' },
  spaceFollow: { method: 'POST', path: '/api/spaces/follow' },
  spaceUnfollow: { method: 'POST', path: '/api/spaces/unfollow' },
  notifications: { method: 'GET', path: '/api/notifications' },
  notificationRead: { method: 'POST', path: '/api/notifications/read' },
  notificationsReadAll: { method: 'POST', path: '/api/notifications/read-all' },
  notificationsUnread: { method: 'GET', path: '/api/notifications/unread-count' },
  notificationsStream: { method: 'GET', path: '/api/notifications/stream' },
  devGrant: { method: 'POST', path: '/api/dev/grant' },
  myProducts: { method: 'GET', path: '/api/my/products' },
  members: { method: 'GET', path: '/api/members' },
  membersExport: { method: 'GET', path: '/api/members/export' },
  memberGrants: { method: 'GET', path: '/api/members/:memberId/grants' },
  memberLearningSummary: { method: 'GET', path: '/api/members/:memberId/learning-summary' },
  memberProgressReset: { method: 'POST', path: '/api/members/:memberId/progress-reset' },
  memberRemove: { method: 'DELETE', path: '/api/members/:memberId' },
  grantsCreate: { method: 'POST', path: '/api/grants' },
  grantRevoke: { method: 'DELETE', path: '/api/grants/:grantId' },
  devSimulatePurchase: { method: 'POST', path: '/api/dev/simulate-purchase' },
  devSubscriptionSimulateCycle: { method: 'POST', path: '/api/dev/subscriptions/simulate-cycle' },
  devSubscriptionSimulateFailure: { method: 'POST', path: '/api/dev/subscriptions/simulate-failure' },
  devMagicLink: { method: 'GET', path: '/api/dev/magic-link' },
  devEmail: { method: 'GET', path: '/api/dev/email' },
  apiKeys: { method: 'GET', path: '/api/api-keys' },
  apiKeysCreate: { method: 'POST', path: '/api/api-keys' },
  apiKeyRevoke: { method: 'DELETE', path: '/api/api-keys/:id' },
  tenantSecrets: { method: 'GET', path: '/api/tenant-secrets' },
  tenantSecretSet: { method: 'POST', path: '/api/tenant-secrets' },
  tenantSecretDelete: { method: 'DELETE', path: '/api/tenant-secrets/:key' },
  stripeTestConnection: { method: 'POST', path: '/api/integrations/stripe/test' },
  bunnyVideos: { method: 'GET', path: '/api/integrations/bunny/videos' },
  bunnyTestConnection: { method: 'POST', path: '/api/integrations/bunny/test' },
  stripeWebhook: { method: 'POST', path: '/api/webhooks/stripe/:tenantId' },
  m2mEnroll: { method: 'POST', path: '/api/m2m/enroll' },
  marketingMessagesCreate: { method: 'POST', path: '/api/m2m/marketing/messages' },
  marketingMessages: { method: 'GET', path: '/api/m2m/marketing/messages' },
  marketingMessage: { method: 'GET', path: '/api/m2m/marketing/messages/:id' },
  marketingEligibility: { method: 'GET', path: '/api/m2m/marketing/eligibility' },
  marketingConsents: { method: 'POST', path: '/api/m2m/marketing/consents' },
  marketingSuppressions: { method: 'GET', path: '/api/m2m/marketing/suppressions' },
  marketingSuppressionsCreate: { method: 'POST', path: '/api/m2m/marketing/suppressions' },
  marketingTemplates: { method: 'GET', path: '/api/m2m/marketing/templates' },
  marketingTick: { method: 'POST', path: '/api/internal/marketing/tick' },
  marketingConsentDefinitions: { method: 'GET', path: '/api/marketing/consent-definitions' },
  marketingConsentDefinitionsCreate: { method: 'POST', path: '/api/marketing/consent-definitions' },
  marketingConsentDefinition: { method: 'GET', path: '/api/marketing/consent-definitions/:id' },
  marketingConsentDefinitionUpdate: { method: 'POST', path: '/api/marketing/consent-definitions/update' },
  marketingCampaigns: { method: 'GET', path: '/api/marketing/campaigns' },
  marketingCampaignsCreate: { method: 'POST', path: '/api/marketing/campaigns' },
  marketingCampaignSchedule: { method: 'POST', path: '/api/marketing/campaigns/schedule' },
  marketingCampaignUpdate: { method: 'POST', path: '/api/marketing/campaigns/update' },
  marketingCampaignAction: { method: 'POST', path: '/api/marketing/campaigns/action' },
  marketingCampaignTest: { method: 'POST', path: '/api/marketing/campaigns/test' },
  marketingAudiencePreview: { method: 'POST', path: '/api/marketing/audience-preview' },
  marketingCampaign: { method: 'GET', path: '/api/marketing/campaigns/:id' },
  marketingDocuments: { method: 'GET', path: '/api/marketing/documents' },
  marketingDocumentsCreate: { method: 'POST', path: '/api/marketing/documents' },
  marketingDocument: { method: 'GET', path: '/api/marketing/documents/:id' },
  marketingDocumentUpdate: { method: 'POST', path: '/api/marketing/documents/update' },
  marketingDocumentPublish: { method: 'POST', path: '/api/marketing/documents/publish' },
  marketingLayouts: { method: 'GET', path: '/api/marketing/layouts' },
  marketingLayoutsSave: { method: 'POST', path: '/api/marketing/layouts' },
  marketingSesSettings: { method: 'GET', path: '/api/marketing/ses-settings' },
  marketingSesSettingsUpdate: { method: 'POST', path: '/api/marketing/ses-settings' },
  marketingStaffSuppressions: { method: 'GET', path: '/api/marketing/suppressions' },
  marketingStaffSuppressionsCreate: { method: 'POST', path: '/api/marketing/suppressions' },
  emailSends: { method: 'GET', path: '/api/marketing/sends' },
  emailSendsExport: { method: 'GET', path: '/api/marketing/sends/export' },
  emailSend: { method: 'GET', path: '/api/marketing/sends/:kind/:id' },
  tenantSchedulerRuns: { method: 'GET', path: '/api/marketing/scheduler-runs' },
  tenantSchedulerRun: { method: 'GET', path: '/api/marketing/scheduler-runs/:id' },
  globalSchedulerRuns: { method: 'GET', path: '/api/internal/scheduler-runs' },
  globalSchedulerRun: { method: 'GET', path: '/api/internal/scheduler-runs/:id' },
  memberEmailSends: { method: 'GET', path: '/api/members/:id/emails' },
  tenantSettings: { method: 'GET', path: '/api/tenant/settings' },
  tenantSettingsUpdate: { method: 'POST', path: '/api/tenant/settings' },
  onboarding: { method: 'GET', path: '/api/onboarding' },
  onboardingDismiss: { method: 'POST', path: '/api/onboarding/dismiss' },
} as const;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  emailDispatch: API_ROUTES.emailDispatch.path,
  publicOffer: API_ROUTES.publicOffer.path,
  publicPaymentConfig: API_ROUTES.publicPaymentConfig.path,
  checkoutSession: API_ROUTES.checkoutSession.path,
  termsConsent: API_ROUTES.termsConsent.path,
  authConfig: API_ROUTES.authConfig.path,
  me: API_ROUTES.me.path,
  tenants: API_ROUTES.tenants.path,
  products: API_ROUTES.products.path,
  productsPublish: API_ROUTES.productsPublish.path,
  productsAccessItems: API_ROUTES.productsAccessItems.path,
  productsAccessIssues: API_ROUTES.productsAccessIssues.path,
  productPricesCreate: API_ROUTES.productPricesCreate.path,
  productPriceDeactivate: API_ROUTES.productPriceDeactivate.path,
  productPrices: API_ROUTES.productPrices.path,
  orders: API_ROUTES.orders.path,
  ordersExport: API_ROUTES.ordersExport.path,
  salesSummary: API_ROUTES.salesSummary.path,
  courses: API_ROUTES.courses.path,
  coursesUpdate: API_ROUTES.coursesUpdate.path,
  coursesHistory: API_ROUTES.coursesHistory.path,
  coursesHistoryVersion: API_ROUTES.coursesHistoryVersion.path,
  modules: API_ROUTES.modules.path,
  modulesCreate: API_ROUTES.modulesCreate.path,
  modulesUpdate: API_ROUTES.modulesUpdate.path,
  modulesAttach: API_ROUTES.modulesAttach.path,
  modulesDetach: API_ROUTES.modulesDetach.path,
  lessons: API_ROUTES.lessons.path,
  lessonsCreate: API_ROUTES.lessonsCreate.path,
  lessonsUpdate: API_ROUTES.lessonsUpdate.path,
  lessonReferences: API_ROUTES.lessonReferences.path,
  lessonsDelete: API_ROUTES.lessonsDelete.path,
  studentCourses: API_ROUTES.studentCourses.path,
  studentCourseStructure: API_ROUTES.studentCourseStructure.path,
  studentLesson: API_ROUTES.studentLesson.path,
  studentLessonComplete: API_ROUTES.studentLessonComplete.path,
  studentLessonUncomplete: API_ROUTES.studentLessonUncomplete.path,
  studentLessonNext: API_ROUTES.studentLessonNext.path,
  studentLastViewed: API_ROUTES.studentLastViewed.path,
  studentProgress: API_ROUTES.studentProgress.path,
  postsCreate: API_ROUTES.postsCreate.path,
  postsUpdate: API_ROUTES.postsUpdate.path,
  postsDelete: API_ROUTES.postsDelete.path,
  discussion: API_ROUTES.discussion.path,
  threadSubscribe: API_ROUTES.threadSubscribe.path,
  threadMute: API_ROUTES.threadMute.path,
  postsSearch: API_ROUTES.postsSearch.path,
  postsReact: API_ROUTES.postsReact.path,
  postsUnreact: API_ROUTES.postsUnreact.path,
  spaces: API_ROUTES.spaces.path,
  spacesStaff: API_ROUTES.spacesStaff.path,
  spacesUpdate: API_ROUTES.spacesUpdate.path,
  spacesArchive: API_ROUTES.spacesArchive.path,
  spacesDelete: API_ROUTES.spacesDelete.path,
  spaceFeed: API_ROUTES.spaceFeed.path,
  spaceFollow: API_ROUTES.spaceFollow.path,
  spaceUnfollow: API_ROUTES.spaceUnfollow.path,
  notifications: API_ROUTES.notifications.path,
  notificationRead: API_ROUTES.notificationRead.path,
  notificationsReadAll: API_ROUTES.notificationsReadAll.path,
  notificationsUnread: API_ROUTES.notificationsUnread.path,
  notificationsStream: API_ROUTES.notificationsStream.path,
  devGrant: API_ROUTES.devGrant.path,
  myProducts: API_ROUTES.myProducts.path,
  members: API_ROUTES.members.path,
  membersExport: API_ROUTES.membersExport.path,
  memberGrants: API_ROUTES.memberGrants.path,
  memberLearningSummary: API_ROUTES.memberLearningSummary.path,
  memberProgressReset: API_ROUTES.memberProgressReset.path,
  memberRemove: API_ROUTES.memberRemove.path,
  memberEmailSends: API_ROUTES.memberEmailSends.path,
  grantsCreate: API_ROUTES.grantsCreate.path,
  grantRevoke: API_ROUTES.grantRevoke.path,
  devSimulatePurchase: API_ROUTES.devSimulatePurchase.path,
  devSubscriptionSimulateCycle: API_ROUTES.devSubscriptionSimulateCycle.path,
  devSubscriptionSimulateFailure: API_ROUTES.devSubscriptionSimulateFailure.path,
  devMagicLink: API_ROUTES.devMagicLink.path,
  devEmail: API_ROUTES.devEmail.path,
  apiKeys: API_ROUTES.apiKeys.path,
  apiKeyRevoke: API_ROUTES.apiKeyRevoke.path,
  tenantSecrets: API_ROUTES.tenantSecrets.path,
  tenantSecretDelete: API_ROUTES.tenantSecretDelete.path,
  stripeTestConnection: API_ROUTES.stripeTestConnection.path,
  bunnyVideos: API_ROUTES.bunnyVideos.path,
  bunnyTestConnection: API_ROUTES.bunnyTestConnection.path,
  stripeWebhook: API_ROUTES.stripeWebhook.path,
  m2mEnroll: API_ROUTES.m2mEnroll.path,
  marketingMessagesCreate: API_ROUTES.marketingMessagesCreate.path,
  marketingMessages: API_ROUTES.marketingMessages.path,
  marketingMessage: API_ROUTES.marketingMessage.path,
  marketingEligibility: API_ROUTES.marketingEligibility.path,
  marketingConsents: API_ROUTES.marketingConsents.path,
  marketingSuppressions: API_ROUTES.marketingSuppressions.path,
  marketingSuppressionsCreate: API_ROUTES.marketingSuppressionsCreate.path,
  marketingTemplates: API_ROUTES.marketingTemplates.path,
  marketingTick: API_ROUTES.marketingTick.path,
  marketingConsentDefinitions: API_ROUTES.marketingConsentDefinitions.path,
  marketingConsentDefinition: API_ROUTES.marketingConsentDefinition.path,
  marketingConsentDefinitionUpdate: API_ROUTES.marketingConsentDefinitionUpdate.path,
  marketingCampaigns: API_ROUTES.marketingCampaigns.path,
  marketingCampaignSchedule: API_ROUTES.marketingCampaignSchedule.path,
  marketingCampaignUpdate: API_ROUTES.marketingCampaignUpdate.path,
  marketingCampaignAction: API_ROUTES.marketingCampaignAction.path,
  marketingCampaignTest: API_ROUTES.marketingCampaignTest.path,
  marketingAudiencePreview: API_ROUTES.marketingAudiencePreview.path,
  marketingCampaign: API_ROUTES.marketingCampaign.path,
  marketingDocuments: API_ROUTES.marketingDocuments.path,
  marketingDocument: API_ROUTES.marketingDocument.path,
  marketingDocumentUpdate: API_ROUTES.marketingDocumentUpdate.path,
  marketingDocumentPublish: API_ROUTES.marketingDocumentPublish.path,
  marketingLayouts: API_ROUTES.marketingLayouts.path,
  marketingSesSettings: API_ROUTES.marketingSesSettings.path,
  marketingStaffSuppressions: API_ROUTES.marketingStaffSuppressions.path,
  emailSends: API_ROUTES.emailSends.path,
  emailSendsExport: API_ROUTES.emailSendsExport.path,
  emailSend: API_ROUTES.emailSend.path,
  tenantSchedulerRuns: API_ROUTES.tenantSchedulerRuns.path,
  tenantSchedulerRun: API_ROUTES.tenantSchedulerRun.path,
  globalSchedulerRuns: API_ROUTES.globalSchedulerRuns.path,
  globalSchedulerRun: API_ROUTES.globalSchedulerRun.path,
  tenantSettings: API_ROUTES.tenantSettings.path,
  tenantSettingsUpdate: API_ROUTES.tenantSettingsUpdate.path,
  onboarding: API_ROUTES.onboarding.path,
  onboardingDismiss: API_ROUTES.onboardingDismiss.path,
} as const;

/**
 * Inbound Stripe webhook, one URL per tenant so the signing secret is resolved
 * from `tenant_secrets`. Stripe (not a first-party client) calls it, so it lives
 * outside the client contract, like the Better Auth handler paths.
 */
export const STRIPE_WEBHOOK_PATH_PATTERN = API_ROUTES.stripeWebhook.path;

/** Header used by non-browser clients (CLI, tests) to select the tenant. */
export const TENANT_HEADER = 'x-tenant';

/** Header carrying a tenant API-key secret for the M2M enroll endpoint. */
export const API_KEY_HEADER = 'x-api-key';
export const SCHEDULER_OPERATOR_SECRET_HEADER = 'x-scheduler-operator-secret';
