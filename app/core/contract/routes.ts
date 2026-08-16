import { z } from 'zod';

import {
  accessItemSchema,
  attachModuleToCourseInputSchema,
  checkoutSessionInputSchema,
  couponCheckoutBreakdownSchema,
  couponRecurringDurationSchema,
  couponCreateInputSchema,
  couponOptionSchema,
  couponStatsItemSchema,
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
  updateProductInputSchema,
  detachModuleFromCourseInputSchema,
  discussionSchema,
  lessonReferencesSchema,
  lessonAttachmentMetadataSchema,
  lessonAttachmentUploadInputSchema,
  lessonAttachmentViewSchema,
  productDownloadAssetMetadataSchema,
  productDownloadAssetViewSchema,
  productDownloadUploadInputSchema,
  listDiscussionInputSchema,
  listReportsInputSchema,
  createApiKeyInputSchema,
  creatorOnboardingSchema,
  courseHistoryEntrySchema,
  entityVersionDetailSchema,
  grantProductToMemberInputSchema,
  grantWindowStatusSchema,
  languageSchema,
  type listOrdersQuerySchema,
  listStreamVideosInputSchema,
  m2mEnrollInputSchema,
  memberSubscriptionSchema,
  memberSubscriptionListItemSchema,
  memberSubscriptionSummarySchema,
  newProductPriceSchema,
  orderListItemSchema,
  orderReconciliationQuerySchema,
  paidWithoutGrantRowSchema,
  invoiceSchema,
  importBatchResponseSchema,
  importAuditEventSchema,
  importValidationResponseSchema,
  importValidateRequestSchema,
  importWriteRequestSchema,
  priceIntervalSchema,
  priceKindSchema,
  productPriceSchema,
  orderExportFileSchema,
  playableCourseLessonSchema,
  exportOrdersQuerySchema,
  salesSummarySchema,
  memberExportFileSchema,
  memberGrantSchema,
  memberErasureRequestSchema,
  memberErasureRequestStatusSchema,
  memberErasureRequestWithMemberSchema,
  memberLearningSummarySchema,
  memberNavigationSchema,
  memberTimelineEventSchema,
  memberWithProductIdsSchema,
  memberSchema,
  setMemberBannedInputSchema,
  revokeGrantInputSchema,
  membershipSchema,
  newCourseLessonSchema,
  newCourseModuleSchema,
  newCourseSchema,
  notificationListInputSchema,
  notificationMarkReadInputSchema,
  notificationSchema,
  pinPostInputSchema,
  emailIntegrationTransportSchema,
  integrationProviderSchema,
  providerDiagnosticSchema,
  configureStripeInputSchema,
  stripeModeSchema,
  postReportSchema,
  reportPostInputSchema,
  reportQueueSchema,
  resolveReportInputSchema,
  newProductSchema,
  nextLessonSchema,
  publicPostSchema,
  postSearchHitSchema,
  productAccessIssuesSchema,
  productCoverUrlSchema,
  productSlugSchema,
  productSchema,
  productTypeSchema,
  progressViewSchema,
  searchPostsInputSchema,
  sendSupportMessageInputSchema,
  setTenantSecretInputSchema,
  staffRoleSchema,
  storageConfigurationSchema,
  streamVideoPageSchema,
  tenantApiKeyPublicSchema,
  tenantBrandingSchema,
  tenantSchema,
  tenantSecretKeySchema,
  tenantSecretMaskedSchema,
  tenantSettingsSchema,
  tenantSocialLinkSchema,
  tenantSupportPublicSchema,
  campaignSchema,
  campaignEngagementStatsSchema,
  consentDefinitionVersionSchema,
  consentDocumentRefSchema,
  consentDefinitionSchema,
  emailEventSchema,
  emailReputationSchema,
  emailLayoutSchema,
  emailSendExportFileSchema,
  emailSendExportQuerySchema,
  emailSendListQuerySchema,
  emailSendProjectionSchema,
  m2mTransactionalMessageInputSchema,
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
  billingDataSchema,
} from '#core/domain/index.js';

/**
 * Single source of truth for the HTTP API shared by server and all clients.
 * Every route is described by its method, path and zod schemas; the server
 * implements them, `core/client` consumes them. Neither side hand-writes URLs
 * or response types anywhere else.
 */

const attestationSchema = z.object({
  version: z.string(),
  sha: z.string(),
});

export const healthLiveOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
});

export const healthReadyOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
  database: z.literal('up'),
});

export const healthOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
  database: z.enum(['up', 'down']),
  environment: z.string(),
  production: z.boolean(),
  commit: z.string().nullable(),
  databaseFingerprint: z.string().regex(/^[0-9a-f]{12}$/).nullable(),
  expectedMigrations: z.number().int().nonnegative(),
  appliedMigrations: z.number().int().nonnegative().nullable(),
  schemaCurrent: z.boolean(),
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
  emailVerified: z.boolean(),
  tenant: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      staffRole: staffRoleSchema.nullable(),
      memberId: z.string().nullable(),
      banned: z.boolean(),
    })
    .nullable(),
});

export const memberBillingOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export const memberBillingOrdersOutputSchema = z.object({
  orders: z.array(z.object({
    id: z.string(),
    createdAt: z.string().datetime(),
    billing: billingDataSchema.nullable(),
    invoice: invoiceSchema.pick({ id: true, status: true, provider: true }).nullable().default(null),
  })),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export const tenantListOutputSchema = z.object({
  tenants: z.array(membershipSchema),
  canCreateTenant: z.boolean(),
});

export const productsListOutputSchema = z.object({
  products: z.array(productSchema),
});

const publicOfferPriceSchema = z.object({
  id: z.string(),
  kind: priceKindSchema,
  interval: priceIntervalSchema.nullable(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const publicLegalUrlsSchema = z.object({
  termsUrl: z.string().nullable().default(null),
  privacyUrl: z.string().nullable().default(null),
});

export const publicOfferOutputSchema = z.object({
  tenant: z.object({
    slug: z.string(),
    name: z.string(),
    branding: tenantBrandingSchema.default({}),
    socialLinks: z.array(tenantSocialLinkSchema).default([]),
    legal: publicLegalUrlsSchema.default({}),
    support: tenantSupportPublicSchema.default({ url: null }),
  }),
  contentVersion: z.number().int().positive(),
  previewLessons: z.array(z.object({
    id: z.string(),
    name: z.string(),
    courseId: z.string(),
  })).default([]),
  products: z.array(
    z.object({
      id: z.string(),
      type: productTypeSchema,
      slug: productSlugSchema,
      title: z.string(),
      description: z.string(),
      coverUrl: productCoverUrlSchema.nullable(),
      priceCents: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      prices: z.array(publicOfferPriceSchema),
      marketingConsents: z.array(z.object({
        definitionId: z.string().min(1),
        label: z.string().min(1),
        doubleOptIn: z.boolean(),
        documentUrl: z.union([z.string().url(), z.string().regex(/^\/legal\/[^/]+\/v\/[1-9]\d*$/)]).nullable(),
      })).default([]),
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

export const couponCheckoutValidationRequestSchema = checkoutSessionInputSchema.pick({
  productId: true,
  priceId: true,
  email: true,
  couponCode: true,
}).required({ couponCode: true });

export type CouponCheckoutValidationRequest = z.input<
  typeof couponCheckoutValidationRequestSchema
>;

export const couponCheckoutValidationOutputSchema = z.object({
  breakdown: couponCheckoutBreakdownSchema,
  recurringDuration: couponRecurringDurationSchema,
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
      type: productTypeSchema,
      title: z.string(),
      description: z.string(),
      accessItems: z.array(accessItemSchema),
      priceCents: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      grantStatus: grantWindowStatusSchema,
      grantStartsAt: z.string().datetime(),
      grantExpiresAt: z.string().datetime().nullable(),
      subscription: memberSubscriptionSummarySchema.nullable(),
      downloads: z.array(productDownloadAssetViewSchema),
    }),
  ),
});

export const membersListOutputSchema = z.object({
  members: z.array(memberWithProductIdsSchema),
});

export const membersExportOutputSchema = memberExportFileSchema;
export const memberDataExportOutputSchema = memberExportFileSchema;

export const memberErasureRequestCreateInputSchema = z.object({
  confirmEmail: z.string().email(),
  reason: z.string().trim().max(2000).optional(),
});
export type MemberErasureRequestCreateInput = z.input<
  typeof memberErasureRequestCreateInputSchema
>;

export const memberErasureRequestOutputSchema = z.object({
  request: memberErasureRequestSchema.nullable(),
});
export const memberErasureRequestMutationOutputSchema = z.object({
  request: memberErasureRequestSchema,
});
export const memberErasureRequestsQuerySchema = z.object({
  status: memberErasureRequestStatusSchema.optional(),
});
export type MemberErasureRequestsQueryInput = z.input<
  typeof memberErasureRequestsQuerySchema
>;
export const memberErasureRequestsOutputSchema = z.object({
  requests: z.array(memberErasureRequestWithMemberSchema),
});
export const memberErasureRejectInputSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

export const memberRemoveInputSchema = z.object({
  memberId: z.string().min(1),
});

export type MemberRemoveInput = z.input<typeof memberRemoveInputSchema>;

const memberSubscriptionCancellationSchema = z.object({
  subscriptionId: z.string(),
  providerSubscriptionId: z.string().nullable(),
  outcome: z.enum(['canceled', 'already_canceled', 'skipped', 'failed']),
  message: z.string().nullable(),
});

export const memberRemoveOutputSchema = z.object({
  memberId: z.string(),
  subscriptionCancellations: z.array(memberSubscriptionCancellationSchema),
  erasureRequestId: z.string().nullable(),
});

export const memberBanInputSchema = setMemberBannedInputSchema;
export type MemberBanInput = z.input<typeof memberBanInputSchema>;
export const memberBanOutputSchema = z.object({ member: memberSchema });

export const memberGrantsOutputSchema = z.object({
  grants: z.array(memberGrantSchema),
});

export const memberLearningSummaryOutputSchema = z.object({
  summary: memberLearningSummarySchema,
});

export const memberNavigationOutputSchema = z.object({
  navigation: memberNavigationSchema,
});

export const memberTimelineOutputSchema = z.object({
  events: z.array(memberTimelineEventSchema),
});

export const memberCommerceOutputSchema = z.object({
  purchases: z.array(orderListItemSchema),
  activeSubscriptions: z.array(memberSubscriptionListItemSchema),
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

const magicLinkSchema = z.object({
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
  marketingConsentDefinitionIds: z.array(z.string().min(1)).default([]),
  couponCode: z.string().trim().min(1).max(100).optional(),
  billing: billingDataSchema.optional(),
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

export type OrdersListQueryInput = z.input<typeof listOrdersQuerySchema>;

export const ordersListOutputSchema = z.object({
  orders: z.array(orderListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export const orderDetailOutputSchema = z.object({
  order: orderListItemSchema,
  invoice: invoiceSchema.nullable().default(null),
});
export const invoiceOutputSchema = z.object({ invoice: invoiceSchema });

export const ordersExportQuerySchema = exportOrdersQuerySchema;

export type OrdersExportQueryInput = z.input<typeof ordersExportQuerySchema>;

export const ordersExportOutputSchema = orderExportFileSchema;

export const ordersReconciliationQuerySchema = orderReconciliationQuerySchema;

export type OrdersReconciliationQueryInput = z.input<typeof ordersReconciliationQuerySchema>;

export const ordersReconciliationOutputSchema = z.object({
  rows: z.array(paidWithoutGrantRowSchema),
  checkedThrough: z.string().datetime(),
});

export const salesSummaryOutputSchema = z.object({
  summary: salesSummarySchema,
});

export const couponStatsQuerySchema = z.object({
  partnerLabel: z.string().trim().min(1).max(200).optional(),
  cursorCreatedAt: z.string().datetime().optional(),
  cursorId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  since: z.string().datetime().optional(),
  through: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
  if ((value.cursorCreatedAt === undefined) !== (value.cursorId === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Both cursor fields are required' });
  }
});
export type CouponStatsQueryInput = z.input<typeof couponStatsQuerySchema>;

export const couponStatsOutputSchema = z.object({
  items: z.array(couponStatsItemSchema),
  nextCursor: z.object({ createdAt: z.string().datetime(), id: z.string() }).nullable(),
});
export const couponOptionsOutputSchema = z.object({
  coupons: z.array(couponOptionSchema),
});
export const couponStatsDetailOutputSchema = z.object({ item: couponStatsItemSchema });
export const couponCreateRequestSchema = couponCreateInputSchema;
export type CouponCreateRequest = z.input<typeof couponCreateRequestSchema>;
export const couponOutputSchema = z.object({ coupon: couponStatsItemSchema.shape.coupon });
export const couponArchiveRequestSchema = z.object({ id: z.string().min(1) });
export type CouponArchiveRequest = z.input<typeof couponArchiveRequestSchema>;
export const couponStatsExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']),
  partnerLabel: z.string().trim().min(1).max(200).optional(),
  since: z.string().datetime().optional(),
  through: z.string().datetime().optional(),
});
export type CouponStatsExportQueryInput = z.input<typeof couponStatsExportQuerySchema>;
export const couponStatsExportOutputSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  content: z.string(),
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

const devEmailSchema = z.object({
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
  name: tenantSchema.shape.name,
});

export type TenantCreateInput = z.input<typeof tenantCreateInputSchema>;

export const tenantCreateOutputSchema = z.object({
  tenant: tenantSchema,
});

export const productsCreateInputSchema = newProductSchema;

export const productsCreateOutputSchema = z.object({
  product: productSchema,
});

export const productsUpdateInputSchema = updateProductInputSchema;

export type ProductsUpdateInput = z.input<typeof productsUpdateInputSchema>;

export const productsUpdateOutputSchema = z.object({
  product: productSchema,
});

export const productsPublishInputSchema = z.object({
  id: z.string().min(1),
});

export type ProductsPublishInput = z.input<typeof productsPublishInputSchema>;

export const productsPublishOutputSchema = z.object({
  product: productSchema,
});

export const productsUnpublishInputSchema = z.object({
  id: z.string().min(1),
});

export type ProductsUnpublishInput = z.input<typeof productsUnpublishInputSchema>;

export const productsUnpublishOutputSchema = z.object({
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

export const lessonAttachmentUploadRequestSchema = lessonAttachmentUploadInputSchema;

export type LessonAttachmentUploadRequest = z.input<typeof lessonAttachmentUploadRequestSchema>;

export const lessonAttachmentUploadOutputSchema = z.object({
  attachment: lessonAttachmentMetadataSchema,
  upload: z.object({
    url: z.string().url(),
    headers: z.record(z.string()),
    expiresAt: z.string().datetime(),
  }),
});

export const lessonAttachmentCompleteOutputSchema = z.object({
  attachment: lessonAttachmentViewSchema,
});

export const lessonAttachmentsOutputSchema = z.object({
  attachments: z.array(lessonAttachmentViewSchema),
});

export const lessonAttachmentDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

export const productDownloadUploadRequestSchema = productDownloadUploadInputSchema;

export type ProductDownloadUploadRequest = z.input<typeof productDownloadUploadRequestSchema>;

export const productDownloadUploadOutputSchema = z.object({
  asset: productDownloadAssetMetadataSchema,
  upload: z.object({
    url: z.string().url(),
    headers: z.record(z.string()),
    expiresAt: z.string().datetime(),
  }),
});

export const productDownloadCompleteOutputSchema = z.object({
  asset: productDownloadAssetMetadataSchema,
});

export const productDownloadAssetsOutputSchema = z.object({
  assets: z.array(productDownloadAssetMetadataSchema),
});

export const productDownloadDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

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
  authenticated: z.boolean(),
});

const bunnyPlaybackVideoSchema = z.object({
  kind: z.literal('bunny'),
  storageKey: z.string().min(1),
  videoId: z.string().min(1),
  libraryId: z.string().min(1),
  embedUrl: z.string().url(),
  hlsUrl: z.string().url().nullable(),
  signed: z.boolean(),
});

const externalPlaybackVideoSchema = z.object({
  kind: z.literal('external'),
  embedUrl: z.string().url(),
});

const unavailablePlaybackVideoSchema = z.object({
  kind: z.literal('unavailable'),
  storageKey: z.string().min(1),
  reason: z.literal('missing_library_id'),
});

export const lessonPlaybackVideoSchema = z.discriminatedUnion('kind', [
  bunnyPlaybackVideoSchema,
  externalPlaybackVideoSchema,
  unavailablePlaybackVideoSchema,
]);

export const studentLessonPlaybackOutputSchema = z.object({
  lessonId: z.string().min(1),
  expiresAt: z.string().datetime(),
  videos: z.array(lessonPlaybackVideoSchema),
});

export type LessonPlaybackVideo = z.infer<typeof lessonPlaybackVideoSchema>;
export type StudentLessonPlaybackOutput = z.infer<typeof studentLessonPlaybackOutputSchema>;

export const lessonCompleteInputSchema = z.object({
  lessonId: z.string().min(1),
});

export type LessonCompleteInput = z.input<typeof lessonCompleteInputSchema>;

export const lessonUncompleteInputSchema = z.object({
  lessonId: z.string().min(1),
});

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

export const postPinInputSchema = pinPostInputSchema;

export type PostPinInput = z.input<typeof postPinInputSchema>;

export const postPinOutputSchema = z.object({
  post: publicPostSchema,
});

export const postReportInputSchema = reportPostInputSchema;
export type PostReportInput = z.input<typeof postReportInputSchema>;
export const postReportOutputSchema = z.object({ report: postReportSchema });

export const reportsListInputSchema = listReportsInputSchema;
export type ReportsListInput = z.input<typeof reportsListInputSchema>;
export const reportsListOutputSchema = reportQueueSchema;

export const reportResolveInputSchema = resolveReportInputSchema;
export type ReportResolveInput = z.input<typeof reportResolveInputSchema>;
export const reportResolveOutputSchema = z.object({ report: postReportSchema });

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

export const apiKeyImportAuditQuerySchema = z.object({
  id: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ApiKeyImportAuditQuery = z.input<typeof apiKeyImportAuditQuerySchema>;

export const apiKeyImportAuditOutputSchema = z.object({
  events: z.array(importAuditEventSchema),
  nextCursor: z.string().nullable(),
});

export const tenantSecretsListOutputSchema = z.object({
  secrets: z.array(tenantSecretMaskedSchema),
  stripeMode: stripeModeSchema.nullable(),
  stripeWebhookUrl: z.string().url(),
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

export const supportMessageInputSchema = sendSupportMessageInputSchema;

export type SupportMessageInput = z.input<typeof supportMessageInputSchema>;

export const supportMessageOutputSchema = z.object({ queued: z.literal(true) });

export const integrationTestInputSchema = z.object({
  provider: integrationProviderSchema,
  emailTransport: emailIntegrationTransportSchema.optional(),
}).superRefine((input, ctx) => {
  if (input.emailTransport !== undefined && input.provider !== 'email') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'An email transport can only be selected for the email provider',
      path: ['emailTransport'],
    });
  }
});

export type IntegrationTestInput = z.input<typeof integrationTestInputSchema>;

export const integrationTestOutputSchema = z.object({
  diagnostic: providerDiagnosticSchema,
});

export const storageProbeInputSchema = storageConfigurationSchema;

export type StorageProbeInput = z.input<typeof storageProbeInputSchema>;

export const storageProbeOutputSchema = z.object({
  diagnostic: providerDiagnosticSchema,
});

export const storageConfigureInputSchema = storageConfigurationSchema;

export type StorageConfigureInput = z.input<typeof storageConfigureInputSchema>;

export const storageConfigureOutputSchema = z.object({
  diagnostic: providerDiagnosticSchema,
  secret: tenantSecretMaskedSchema,
});

export const stripeConfigureInputSchema = configureStripeInputSchema;

export type StripeConfigureInput = z.input<typeof stripeConfigureInputSchema>;

export const stripeConfigureOutputSchema = z.object({
  mode: stripeModeSchema,
  webhookUrl: z.string().url(),
});

export const ifirmaTestConnectionOutputSchema = z.object({
  ok: z.literal(true),
  diagnostic: z.string(),
});

export const ksefTestConnectionOutputSchema = z.object({
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

export const m2mTransactionalMessageRequestSchema = m2mTransactionalMessageInputSchema;

export type M2mTransactionalMessageRequest = z.input<typeof m2mTransactionalMessageRequestSchema>;

export const m2mTransactionalMessageOutputSchema = z.object({
  messageId: z.string().min(1),
  statusUrl: z.string().min(1),
});

export const m2mTransactionalMessageStatusOutputSchema = z.object({
  send: emailSendProjectionSchema,
  events: z.array(emailEventSchema),
});

export const m2mImportWriteRequestSchema = importWriteRequestSchema;

export const m2mImportValidateRequestSchema = importValidateRequestSchema;

export const m2mImportBatchOutputSchema = importBatchResponseSchema;

export const m2mImportValidationOutputSchema = importValidationResponseSchema;

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
  bodyHtml: z.string().min(1), bodySource: z.string().min(1).optional(),
  consentDefinitionId: z.string().min(1),
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
  smtpConfigured: z.boolean(),
  resendConfigured: z.boolean(),
  platformPool: z.object({ used: z.number().int().nonnegative(), limit: z.literal(1000) }),
  webhookUrl: z.string().url().nullable(),
});
export const marketingReputationOutputSchema = emailReputationSchema;
export const marketingSesSettingsUpdateInputSchema = z.object({
  fromAddress: z.string().email(),
  fromName: z.string().trim().min(1),
  identity: z.string().trim().min(1),
  configurationSet: z.string().trim().min(1).nullable(),
  snsTopicArn: z.string().trim().min(1).nullable(),
  trackingEnabled: z.boolean(),
  autoPauseOnCritical: z.boolean(),
  footerLegalName: z.string(),
  footerAddress: z.string(),
});
export const marketingSesIdentityStartInputSchema = z.object({
  kind: z.enum(['domain', 'email']),
});
export const marketingSesIdentityStartOutputSchema = z.object({
  identity: z.string().min(1),
  kind: z.enum(['domain', 'email']),
  records: z.array(z.object({
    name: z.string().min(1),
    type: z.literal('CNAME'),
    value: z.string().min(1),
  })),
});
export const marketingSesOnboardingStatusSchema = z.object({
  identityVerified: z.boolean(),
  dkimVerified: z.boolean(),
  identityRegressed: z.boolean(),
  records: marketingSesIdentityStartOutputSchema.shape.records,
  configurationSetReady: z.boolean(),
  eventDestinationReady: z.boolean(),
  subscriptionConfirmed: z.boolean(),
  feedbackForwardingDisabled: z.boolean(),
  checklist: z.object({
    credentials: z.boolean(),
    identity: z.boolean(),
    configurationSet: z.boolean(),
    snsSubscription: z.boolean(),
    webhook: z.boolean(),
    footer: z.boolean(),
    productionAccess: z.boolean(),
  }),
});
export const marketingSesProvisionOutputSchema = z.object({
  configurationSet: z.string().min(1),
  topicArn: z.string().min(1),
  subscriptionConfirmed: z.boolean(),
  feedbackForwardingDisabled: z.boolean(),
});
export const marketingSesSimulatorOutputSchema = z.object({
  messageId: z.string().min(1),
  webhookVerifiedAt: z.string().datetime().nullable(),
  waitingForWebhook: z.boolean(),
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
export type MarketingSesIdentityStartInput = z.input<typeof marketingSesIdentityStartInputSchema>;
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
  healthLive: { method: 'GET', path: '/api/health/live' },
  healthReady: { method: 'GET', path: '/api/health/ready' },
  emailDispatch: { method: 'POST', path: '/api/internal/dispatch-email' },
  autoInvoiceDispatch: { method: 'POST', path: '/api/internal/dispatch-auto-invoices' },
  ksefDispatch: { method: 'POST', path: '/api/internal/dispatch-ksef' },
  publicOffer: { method: 'GET', path: '/api/public/offer' },
  publicPaymentConfig: { method: 'GET', path: '/api/public/payment-config' },
  checkoutSession: { method: 'POST', path: '/api/public/checkout/session' },
  couponCheckoutValidation: { method: 'POST', path: '/api/public/checkout/coupon' },
  termsConsent: { method: 'POST', path: '/api/public/terms-consent' },
  authConfig: { method: 'GET', path: '/api/public/auth-config' },
  me: { method: 'GET', path: '/api/me' },
  memberBillingOrders: { method: 'GET', path: '/api/me/billing-orders' },
  memberDataExport: { method: 'GET', path: '/api/me/data-export' },
  memberErasureRequest: { method: 'GET', path: '/api/me/erasure-request' },
  memberErasureRequestCreate: { method: 'POST', path: '/api/me/erasure-request' },
  memberErasureRequestCancel: { method: 'DELETE', path: '/api/me/erasure-request' },
  tenants: { method: 'GET', path: '/api/tenants' },
  tenantsCreate: { method: 'POST', path: '/api/tenants' },
  products: { method: 'GET', path: '/api/products' },
  productsCreate: { method: 'POST', path: '/api/products' },
  productsUpdate: { method: 'POST', path: '/api/products/update' },
  productsPublish: { method: 'POST', path: '/api/products/publish' },
  productsUnpublish: { method: 'POST', path: '/api/products/unpublish' },
  productsAccessItems: { method: 'POST', path: '/api/products/access-items' },
  productsAccessIssues: { method: 'GET', path: '/api/products/access-issues' },
  productPricesCreate: { method: 'POST', path: '/api/products/prices' },
  productPriceDeactivate: { method: 'POST', path: '/api/products/prices/deactivate' },
  productPrices: { method: 'GET', path: '/api/products/:productId/prices' },
  orders: { method: 'GET', path: '/api/orders' },
  ordersReconciliation: { method: 'GET', path: '/api/orders/reconciliation' },
  order: { method: 'GET', path: '/api/orders/:orderId' },
  invoiceIssue: { method: 'POST', path: '/api/orders/:orderId/invoice' },
  invoiceRefresh: { method: 'POST', path: '/api/invoices/:invoiceId/refresh' },
  invoiceDownload: { method: 'GET', path: '/api/invoices/:invoiceId/download' },
  invoiceUpoDownload: { method: 'GET', path: '/api/invoices/:invoiceId/upo' },
  memberInvoiceDownload: { method: 'GET', path: '/api/me/invoices/:invoiceId/download' },
  ordersExport: { method: 'GET', path: '/api/orders/export' },
  salesSummary: { method: 'GET', path: '/api/sales/summary' },
  couponStats: { method: 'GET', path: '/api/coupons' },
  couponOptions: { method: 'GET', path: '/api/coupons/options' },
  couponStatsDetail: { method: 'GET', path: '/api/coupons/:couponId' },
  couponsCreate: { method: 'POST', path: '/api/coupons' },
  couponArchive: { method: 'POST', path: '/api/coupons/archive' },
  couponStatsExport: { method: 'GET', path: '/api/coupons/export' },
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
  lessonAttachments: { method: 'GET', path: '/api/lessons/:lessonId/attachments' },
  lessonAttachmentUpload: { method: 'POST', path: '/api/lessons/:lessonId/attachments/upload' },
  lessonAttachmentComplete: { method: 'POST', path: '/api/lessons/:lessonId/attachments/:attachmentId/complete' },
  lessonAttachmentDelete: { method: 'DELETE', path: '/api/lessons/:lessonId/attachments/:attachmentId' },
  productDownloadAssets: { method: 'GET', path: '/api/products/:productId/downloads' },
  productDownloadUpload: { method: 'POST', path: '/api/products/:productId/downloads/upload' },
  productDownloadComplete: { method: 'POST', path: '/api/products/:productId/downloads/:assetId/complete' },
  productDownloadDelete: { method: 'DELETE', path: '/api/products/:productId/downloads/:assetId' },
  studentCourses: { method: 'GET', path: '/api/student/courses' },
  studentCourseStructure: { method: 'GET', path: '/api/student/courses/:courseId/structure' },
  studentLesson: { method: 'GET', path: '/api/student/lessons/:lessonId' },
  studentLessonAttachments: { method: 'GET', path: '/api/student/lessons/:lessonId/attachments' },
  studentLessonAttachmentDownload: { method: 'GET', path: '/api/student/lessons/:lessonId/attachments/:attachmentId/download' },
  studentLessonPlayback: { method: 'GET', path: '/api/student/lessons/:lessonId/playback' },
  studentLessonComplete: { method: 'POST', path: '/api/student/lessons/complete' },
  studentLessonUncomplete: { method: 'POST', path: '/api/student/lessons/uncomplete' },
  studentLessonNext: { method: 'GET', path: '/api/student/lessons/next' },
  studentLastViewed: { method: 'POST', path: '/api/student/progress/last-viewed' },
  studentProgress: { method: 'GET', path: '/api/student/progress' },
  postsCreate: { method: 'POST', path: '/api/posts' },
  postsPin: { method: 'POST', path: '/api/posts/pin' },
  postsReport: { method: 'POST', path: '/api/posts/report' },
  postsUpdate: { method: 'POST', path: '/api/posts/update' },
  postsDelete: { method: 'DELETE', path: '/api/posts/:postId' },
  discussion: { method: 'GET', path: '/api/discussion' },
  threadSubscribe: { method: 'POST', path: '/api/discussion/subscribe' },
  threadMute: { method: 'POST', path: '/api/discussion/mute' },
  postsSearch: { method: 'GET', path: '/api/posts/search' },
  postsReact: { method: 'POST', path: '/api/posts/react' },
  postsUnreact: { method: 'POST', path: '/api/posts/unreact' },
  reports: { method: 'GET', path: '/api/reports' },
  reportResolve: { method: 'POST', path: '/api/reports/resolve' },
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
  memberNavigation: { method: 'GET', path: '/api/member/navigation' },
  myProducts: { method: 'GET', path: '/api/my/products' },
  memberProductDownload: { method: 'GET', path: '/api/my/products/:productId/downloads/:assetId' },
  members: { method: 'GET', path: '/api/members' },
  memberErasureRequests: { method: 'GET', path: '/api/members/erasure-requests' },
  memberErasureReject: {
    method: 'POST',
    path: '/api/members/erasure-requests/:requestId/reject',
  },
  membersExport: { method: 'GET', path: '/api/members/export' },
  memberGrants: { method: 'GET', path: '/api/members/:memberId/grants' },
  memberCommerce: { method: 'GET', path: '/api/members/:memberId/commerce' },
  memberTimeline: { method: 'GET', path: '/api/members/:memberId/timeline' },
  memberLearningSummary: { method: 'GET', path: '/api/members/:memberId/learning-summary' },
  memberProgressReset: { method: 'POST', path: '/api/members/:memberId/progress-reset' },
  memberRemove: { method: 'DELETE', path: '/api/members/:memberId' },
  memberBan: { method: 'POST', path: '/api/members/ban' },
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
  apiKeyImportAudit: { method: 'GET', path: '/api/api-keys/:id/import-audit' },
  tenantSecrets: { method: 'GET', path: '/api/tenant-secrets' },
  tenantSecretSet: { method: 'POST', path: '/api/tenant-secrets' },
  tenantSecretDelete: { method: 'DELETE', path: '/api/tenant-secrets/:key' },
  integrationTest: { method: 'POST', path: '/api/integrations/test' },
  storageProbe: { method: 'POST', path: '/api/integrations/storage/probe' },
  storageConfigure: { method: 'POST', path: '/api/integrations/storage/configure' },
  stripeConfigure: { method: 'POST', path: '/api/integrations/stripe/configure' },
  ifirmaTestConnection: { method: 'POST', path: '/api/integrations/ifirma/test' },
  ksefTestConnection: { method: 'POST', path: '/api/integrations/ksef/test' },
  bunnyVideos: { method: 'GET', path: '/api/integrations/bunny/videos' },
  bunnyTestConnection: { method: 'POST', path: '/api/integrations/bunny/test' },
  stripeWebhook: { method: 'POST', path: '/api/webhooks/stripe/:tenantId' },
  m2mEnroll: { method: 'POST', path: '/api/m2m/enroll' },
  m2mTransactionalMessagesCreate: { method: 'POST', path: '/api/m2m/transactional/messages' },
  m2mTransactionalMessage: { method: 'GET', path: '/api/m2m/transactional/messages/:id' },
  m2mImportValidate: { method: 'POST', path: '/api/m2m/import/validate' },
  m2mImportCourses: { method: 'POST', path: '/api/m2m/import/courses' },
  m2mImportModules: { method: 'POST', path: '/api/m2m/import/modules' },
  m2mImportLessons: { method: 'POST', path: '/api/m2m/import/lessons' },
  m2mImportProducts: { method: 'POST', path: '/api/m2m/import/products' },
  m2mImportMembers: { method: 'POST', path: '/api/m2m/import/members' },
  m2mImportGrants: { method: 'POST', path: '/api/m2m/import/grants' },
  m2mImportProgress: { method: 'POST', path: '/api/m2m/import/progress' },
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
  marketingSesOnboarding: { method: 'POST', path: '/api/marketing/ses-onboarding/poll' },
  marketingSesIdentityStart: { method: 'POST', path: '/api/marketing/ses-onboarding/identity' },
  marketingSesProvision: { method: 'POST', path: '/api/marketing/ses-onboarding/infrastructure' },
  marketingSesSimulator: { method: 'POST', path: '/api/marketing/ses-onboarding/simulator' },
  marketingReputation: { method: 'GET', path: '/api/marketing/reputation' },
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
  supportMessage: { method: 'POST', path: '/api/support/message' },
  onboarding: { method: 'GET', path: '/api/onboarding' },
  onboardingDismiss: { method: 'POST', path: '/api/onboarding/dismiss' },
} as const;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  healthLive: API_ROUTES.healthLive.path,
  healthReady: API_ROUTES.healthReady.path,
  emailDispatch: API_ROUTES.emailDispatch.path,
  autoInvoiceDispatch: API_ROUTES.autoInvoiceDispatch.path,
  ksefDispatch: API_ROUTES.ksefDispatch.path,
  publicOffer: API_ROUTES.publicOffer.path,
  publicPaymentConfig: API_ROUTES.publicPaymentConfig.path,
  checkoutSession: API_ROUTES.checkoutSession.path,
  couponCheckoutValidation: API_ROUTES.couponCheckoutValidation.path,
  termsConsent: API_ROUTES.termsConsent.path,
  authConfig: API_ROUTES.authConfig.path,
  me: API_ROUTES.me.path,
  memberBillingOrders: API_ROUTES.memberBillingOrders.path,
  memberDataExport: API_ROUTES.memberDataExport.path,
  memberErasureRequest: API_ROUTES.memberErasureRequest.path,
  tenants: API_ROUTES.tenants.path,
  products: API_ROUTES.products.path,
  productsUpdate: API_ROUTES.productsUpdate.path,
  productsPublish: API_ROUTES.productsPublish.path,
  productsUnpublish: API_ROUTES.productsUnpublish.path,
  productsAccessItems: API_ROUTES.productsAccessItems.path,
  productsAccessIssues: API_ROUTES.productsAccessIssues.path,
  productPricesCreate: API_ROUTES.productPricesCreate.path,
  productPriceDeactivate: API_ROUTES.productPriceDeactivate.path,
  productPrices: API_ROUTES.productPrices.path,
  orders: API_ROUTES.orders.path,
  ordersReconciliation: API_ROUTES.ordersReconciliation.path,
  order: API_ROUTES.order.path,
  invoiceIssue: API_ROUTES.invoiceIssue.path,
  invoiceRefresh: API_ROUTES.invoiceRefresh.path,
  invoiceDownload: API_ROUTES.invoiceDownload.path,
  invoiceUpoDownload: API_ROUTES.invoiceUpoDownload.path,
  memberInvoiceDownload: API_ROUTES.memberInvoiceDownload.path,
  ordersExport: API_ROUTES.ordersExport.path,
  salesSummary: API_ROUTES.salesSummary.path,
  couponStats: API_ROUTES.couponStats.path,
  couponOptions: API_ROUTES.couponOptions.path,
  couponStatsDetail: API_ROUTES.couponStatsDetail.path,
  couponsCreate: API_ROUTES.couponsCreate.path,
  couponArchive: API_ROUTES.couponArchive.path,
  couponStatsExport: API_ROUTES.couponStatsExport.path,
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
  lessonAttachments: API_ROUTES.lessonAttachments.path,
  lessonAttachmentUpload: API_ROUTES.lessonAttachmentUpload.path,
  lessonAttachmentComplete: API_ROUTES.lessonAttachmentComplete.path,
  lessonAttachmentDelete: API_ROUTES.lessonAttachmentDelete.path,
  productDownloadAssets: API_ROUTES.productDownloadAssets.path,
  productDownloadUpload: API_ROUTES.productDownloadUpload.path,
  productDownloadComplete: API_ROUTES.productDownloadComplete.path,
  productDownloadDelete: API_ROUTES.productDownloadDelete.path,
  studentCourses: API_ROUTES.studentCourses.path,
  studentCourseStructure: API_ROUTES.studentCourseStructure.path,
  studentLesson: API_ROUTES.studentLesson.path,
  studentLessonAttachments: API_ROUTES.studentLessonAttachments.path,
  studentLessonAttachmentDownload: API_ROUTES.studentLessonAttachmentDownload.path,
  studentLessonPlayback: API_ROUTES.studentLessonPlayback.path,
  studentLessonComplete: API_ROUTES.studentLessonComplete.path,
  studentLessonUncomplete: API_ROUTES.studentLessonUncomplete.path,
  studentLessonNext: API_ROUTES.studentLessonNext.path,
  studentLastViewed: API_ROUTES.studentLastViewed.path,
  studentProgress: API_ROUTES.studentProgress.path,
  postsCreate: API_ROUTES.postsCreate.path,
  postsPin: API_ROUTES.postsPin.path,
  postsReport: API_ROUTES.postsReport.path,
  postsUpdate: API_ROUTES.postsUpdate.path,
  postsDelete: API_ROUTES.postsDelete.path,
  discussion: API_ROUTES.discussion.path,
  threadSubscribe: API_ROUTES.threadSubscribe.path,
  threadMute: API_ROUTES.threadMute.path,
  postsSearch: API_ROUTES.postsSearch.path,
  postsReact: API_ROUTES.postsReact.path,
  postsUnreact: API_ROUTES.postsUnreact.path,
  reports: API_ROUTES.reports.path,
  reportResolve: API_ROUTES.reportResolve.path,
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
  memberNavigation: API_ROUTES.memberNavigation.path,
  myProducts: API_ROUTES.myProducts.path,
  memberProductDownload: API_ROUTES.memberProductDownload.path,
  members: API_ROUTES.members.path,
  memberErasureRequests: API_ROUTES.memberErasureRequests.path,
  memberErasureReject: API_ROUTES.memberErasureReject.path,
  membersExport: API_ROUTES.membersExport.path,
  memberGrants: API_ROUTES.memberGrants.path,
  memberCommerce: API_ROUTES.memberCommerce.path,
  memberTimeline: API_ROUTES.memberTimeline.path,
  memberLearningSummary: API_ROUTES.memberLearningSummary.path,
  memberProgressReset: API_ROUTES.memberProgressReset.path,
  memberRemove: API_ROUTES.memberRemove.path,
  memberBan: API_ROUTES.memberBan.path,
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
  apiKeyImportAudit: API_ROUTES.apiKeyImportAudit.path,
  tenantSecrets: API_ROUTES.tenantSecrets.path,
  tenantSecretDelete: API_ROUTES.tenantSecretDelete.path,
  integrationTest: API_ROUTES.integrationTest.path,
  storageProbe: API_ROUTES.storageProbe.path,
  storageConfigure: API_ROUTES.storageConfigure.path,
  stripeConfigure: API_ROUTES.stripeConfigure.path,
  ifirmaTestConnection: API_ROUTES.ifirmaTestConnection.path,
  ksefTestConnection: API_ROUTES.ksefTestConnection.path,
  bunnyVideos: API_ROUTES.bunnyVideos.path,
  bunnyTestConnection: API_ROUTES.bunnyTestConnection.path,
  stripeWebhook: API_ROUTES.stripeWebhook.path,
  m2mEnroll: API_ROUTES.m2mEnroll.path,
  m2mTransactionalMessagesCreate: API_ROUTES.m2mTransactionalMessagesCreate.path,
  m2mTransactionalMessage: API_ROUTES.m2mTransactionalMessage.path,
  m2mImportValidate: API_ROUTES.m2mImportValidate.path,
  m2mImportCourses: API_ROUTES.m2mImportCourses.path,
  m2mImportModules: API_ROUTES.m2mImportModules.path,
  m2mImportLessons: API_ROUTES.m2mImportLessons.path,
  m2mImportProducts: API_ROUTES.m2mImportProducts.path,
  m2mImportMembers: API_ROUTES.m2mImportMembers.path,
  m2mImportGrants: API_ROUTES.m2mImportGrants.path,
  m2mImportProgress: API_ROUTES.m2mImportProgress.path,
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
  marketingSesOnboarding: API_ROUTES.marketingSesOnboarding.path,
  marketingSesIdentityStart: API_ROUTES.marketingSesIdentityStart.path,
  marketingSesProvision: API_ROUTES.marketingSesProvision.path,
  marketingSesSimulator: API_ROUTES.marketingSesSimulator.path,
  marketingReputation: API_ROUTES.marketingReputation.path,
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
  supportMessage: API_ROUTES.supportMessage.path,
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
