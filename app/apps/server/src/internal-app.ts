import { type Hono } from 'hono';
import { z } from 'zod';

import {
  API_KEY_HEADER,
  API_PATHS,
  apiKeyCreateInputSchema,
  apiKeyRevokeInputSchema,
  apiKeyImportAuditQuerySchema,
  bunnyVideosInputSchema,
  couponArchiveRequestSchema,
  couponCreateRequestSchema,
  couponStatsExportQuerySchema,
  couponStatsQuerySchema,
  courseCreateInputSchema,
  courseUpdateInputSchema,
  discussionGetInputSchema,
  EMAIL_DISPATCH_SECRET_HEADER,
  emailSendsExportQuerySchema,
  emailSendsQuerySchema,
  grantCreateInputSchema,
  grantRevokeInputSchema,
  integrationTestInputSchema,
  storageConfigureInputSchema,
  storageProbeInputSchema,
  lastViewedInputSchema,
  lessonCompleteInputSchema,
  lessonAttachmentUploadRequestSchema,
  lessonCreateInputSchema,
  lessonUncompleteInputSchema,
  lessonUpdateInputSchema,
  m2mEnrollRequestSchema,
  marketingAudiencePreviewInputSchema,
  marketingCampaignActionInputSchema,
  marketingCampaignCreateInputSchema,
  marketingCampaignScheduleInputSchema,
  marketingCampaignUpdateInputSchema,
  marketingConsentDefinitionCreateInputSchema,
  marketingConsentDefinitionUpdateInputSchema,
  marketingDocumentCreateInputSchema,
  marketingDocumentPublishInputSchema,
  marketingDocumentUpdateInputSchema,
  marketingLayoutSaveInputSchema,
  marketingSesIdentityStartInputSchema,
  marketingSesSettingsUpdateInputSchema,
  marketingSuppressionCreateInputSchema,
  memberBillingOrdersQuerySchema,
  memberBanInputSchema,
  memberProgressResetInputSchema,
  memberErasureRequestCreateInputSchema,
  memberErasureRejectInputSchema,
  memberErasureRequestsQuerySchema,
  memberRemoveInputSchema,
  moduleAttachInputSchema,
  moduleCreateInputSchema,
  moduleDetachInputSchema,
  moduleUpdateInputSchema,
  notificationReadInputSchema,
  notificationsListInputSchema,
  ordersExportQuerySchema,
  ordersReconciliationQuerySchema,
  postCreateInputSchema,
  postDeleteInputSchema,
  postPinInputSchema,
  postReportInputSchema,
  postReactInputSchema,
  postsSearchInputSchema,
  reportResolveInputSchema,
  reportsListInputSchema,
  postUpdateInputSchema,
  productPriceCreateInputSchema,
  productPriceDeactivateInputSchema,
  productsAccessItemsInputSchema,
  productsCreateInputSchema,
  productsPublishInputSchema,
  productsUnpublishInputSchema,
  productsUpdateInputSchema,
  productDownloadUploadRequestSchema,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  schedulerRunsQuerySchema,
  simulatePurchaseInputSchema,
  spaceArchiveInputSchema,
  spaceCreateInputSchema,
  spaceDeleteInputSchema,
  spaceFeedGetInputSchema,
  spaceFollowInputSchema,
  spaceUpdateInputSchema,
  stripeConfigureInputSchema,
  subscriptionSimulateInputSchema,
  supportMessageInputSchema,
  studentLessonPlaybackOutputSchema,
  TENANT_HEADER,
  tenantCreateInputSchema,
  tenantSecretDeleteInputSchema,
  tenantSecretSetInputSchema,
  tenantSettingsUpdateInputSchema,
  termsConsentRequestSchema
} from '#core/contract/index.js';
import {
  devGrantInputSchema,
  apiKeyHasCapability,
  err,
  forbidden,
  internal,
  memberExportFormatSchema,
  ok,
  tenantNotFound,
  toPublicPost,
  unauthorized,
  validation,
  type EmailBranding,
  type Identity,
  type LessonAttachment,
  type LessonAttachmentMetadata,
  type LessonAttachmentView,
  type ProductDownloadAsset,
  type ProductDownloadAssetMetadata,
  type ProductDownloadAssetView,
  type MemberCourseProgress,
  type ProgressView,
  type Result,
  type AppError
} from '#core/domain/index.js';
import {
  addManualSuppression,
  archiveCoupon,
  attachModuleToCourse,
  beginLessonAttachmentUpload,
  beginProductDownloadUpload,
  authenticateApiKey,
  autoIssueOnPayment,
  authorizeRequiredTenant,
  authorizeTenant,
  cancelCampaign,
  configureStripe,
  createCampaign,
  createCoupon,
  createCourse,
  createLesson,
  createMarketingConsentDefinition,
  createModule,
  createPost,
  createProduct,
  createProductPrice,
  createSpace,
  createTenant,
  createTenantApiKey,
  createTenantDocument,
  configureStorageConnection,
  completeLessonAttachmentUpload,
  completeProductDownloadUpload,
  deactivateProductPrice,
  deleteLesson,
  deleteLessonAttachment,
  deleteProductDownloadAsset,
  deletePost,
  deleteSpace,
  deleteTenantSecret,
  detachModuleFromCourse,
  devGrantProduct,
  dismissCreatorOnboarding,
  downloadInvoice,
  downloadInvoiceUpo,
  downloadMemberInvoice,
  editPost,
  enforceTermsConsent,
  exportCouponStats,
  exportEmailSends,
  exportMembers,
  exportMyData,
  requestMyErasure,
  getMyErasureRequest,
  cancelMyErasureRequest,
  listErasureRequests,
  rejectErasureRequest,
  exportOrders,
  followSpace,
  fulfillStripeWebhook,
  getCampaignWithEngagement,
  getContentHistory,
  getContentVersion,
  getCouponStats,
  getCourseStructureWithAccess,
  getCreatorOnboarding,
  getEmailReputation,
  getEmailSend,
  getGlobalSchedulerRun,
  getMarketingConsentDefinition,
  getMemberCommerceOverview,
  getMemberLearningSummary,
  getMemberNavigation,
  getNextLesson,
  getOrder,
  getLessonAttachmentDownload,
  getLessonPlayback,
  getProductDownload,
  getProgress,
  getSalesSummary,
  getSchedulerRunForTenant,
  getSpaceFeed,
  getTenantDocument,
  getTenantSecretsMasked,
  getTenantSesMarketingSettings,
  getTenantSettings,
  grantProductToMember,
  listBunnyVideos,
  listCampaignsWithEngagement,
  listCouponOptions,
  listCouponStats,
  listCourses,
  listDiscussion,
  listEmailLayouts,
  listEmailSends,
  listGlobalSchedulerRuns,
  listLessonReferences,
  listLessonAttachments,
  listLessons,
  listMarketingConsentDefinitions,
  listMemberBillingOrders,
  listMemberEmailSends,
  listMemberGrants,
  listMemberLessonAttachments,
  listMemberTimeline,
  listMembers,
  listModules,
  listMyCourses,
  listMyProducts,
  listMyTenants,
  listNotifications,
  listOrders,
  listPaidOrdersWithoutGrant,
  listProductAccessIssues,
  listProductDownloadAssets,
  listProductPrices,
  listReports,
  listProducts,
  listSchedulerRunsForTenant,
  listSpacesForMember,
  listSpacesForStaff,
  listTenantApiKeys,
  listImportAuditForApiKey,
  listTenantDocuments,
  m2mEnroll,
  markAllNotificationsRead,
  markLessonCompleted,
  markNotificationRead,
  muteThread,
  pauseCampaign,
  pollSesOnboarding,
  previewMarketingAudience,
  probeStorageConnection,
  provisionSesInfrastructure,
  publishProduct,
  publishTenantDocument,
  reactToPost,
  recordCheckoutMarketingConsents,
  refreshInvoiceStatus,
  removeMember,
  reportPost,
  requestInvoice,
  resetMemberCourseProgress,
  resolveIdentity,
  resolveReport,
  resolveTenant,
  revokeGrant,
  revokeTenantApiKey,
  saveEmailLayout,
  saveTenantDocumentDraft,
  scheduleCampaign,
  searchPosts,
  sendSesSimulatorTest,
  setMemberBanned,
  setSpaceArchived,
  setPostPinned,
  sendSupportMessage,
  setTenantSecret,
  simulatePurchase,
  simulateSubscriptionCycle,
  simulateSubscriptionFailure,
  startSesIdentityVerification,
  subscribeThread,
  testBunnyConnection,
  testIfirmaConnection,
  testIntegration,
  testKsefConnection,
  testSendCampaignToSelf,
  unfollowSpace,
  unmarkLessonCompleted,
  unreactToPost,
  unreadNotificationCount,
  updateCourse,
  updateLastViewed,
  updateLesson,
  updateMarketingCampaign,
  updateMarketingConsentDefinition,
  updateModule,
  updateProductAccessItems,
  unpublishProduct,
  updateProduct,
  updateSpace,
  updateTenantSesMarketingSettings,
  updateTenantSettings,
  validateCheckoutSelection,
  validateCouponForCheckout,
  validateTermsConsent,
  type AuthenticatedUser,
  type PaymentWebhookEvent,
  type SimulatePurchaseResult,
  type TenantSource
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { dispatchKsefInBackground } from './ksef-dispatch.js';
import { registerAuthenticatedMarketingRoutes } from './marketing-routes.js';
import { registerM2mImportRoutes } from './import-routes.js';
import { createNotificationEventStream, SSE_HEADERS } from './notifications-sse.js';
import { respond } from './respond.js';
import {
  assertSelfAuthenticatingRouteManifest,
  SELF_AUTHENTICATING_ROUTE_MANIFEST,
} from './self-authenticating-route-manifest.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string; }; };

const magicLinkBaseUrl = (
  hostHeader: string,
  forwardedProto: string | null,
  source: TenantSource,
  appBaseUrl: string,
): string => {
  if (source === 'tenant-header' || hostHeader === '') return appBaseUrl;
  const proto = forwardedProto ?? new URL(appBaseUrl).protocol.replace(':', '');
  return `${proto}://${hostHeader}`;
};

const emailBranding = async (deps: AppDeps, tenantId: string): Promise<EmailBranding | undefined> => {
  const settings = await deps.tenants.findSettings(tenantId);
  return settings === null ? undefined : {
    logoUrl: settings.logoUrl,
    accentColor: settings.accentColor,
    socialLinks: settings.socialLinks,
  };
};

const issueMagicLink = async (
  deps: AppDeps,
  input: { email: string; tenantId: string; tenantName: string; language: string; baseUrl: string; },
) => {
  const branding = await emailBranding(deps, input.tenantId);
  await deps.authPort.requestMagicLink({
    email: input.email,
    callbackURL: input.baseUrl,
    tenantName: input.tenantName,
    language: input.language,
    baseUrl: input.baseUrl,
    ...(branding === undefined ? {} : { branding }),
  });
  return deps.devMagicLinks.findByEmail(input.email);
};

const toProgressView = (progress: MemberCourseProgress): ProgressView => ({
  courseId: progress.courseId,
  completedLessonIds: progress.completedLessonIds,
  lastViewedLessonId: progress.lastViewedLessonId,
  lastViewedModuleId: progress.lastViewedModuleId,
  lastViewedChapterId: progress.lastViewedChapterId,
});

const lessonAttachmentMetadata = (attachment: LessonAttachment): LessonAttachmentMetadata => ({
  id: attachment.id,
  lessonId: attachment.lessonId,
  fileName: attachment.fileName,
  contentType: attachment.contentType,
  sizeBytes: attachment.sizeBytes,
  status: attachment.status,
  createdAt: attachment.createdAt,
});

const lessonAttachmentView = (attachment: LessonAttachment): LessonAttachmentView => ({
  ...lessonAttachmentMetadata(attachment),
  downloadPath: API_PATHS.studentLessonAttachmentDownload
    .replace(':lessonId', encodeURIComponent(attachment.lessonId))
    .replace(':attachmentId', encodeURIComponent(attachment.id)),
});

const productDownloadMetadata = (asset: ProductDownloadAsset): ProductDownloadAssetMetadata => ({
  id: asset.id,
  productId: asset.productId,
  fileName: asset.fileName,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  status: asset.status,
  createdAt: asset.createdAt,
});

const productDownloadView = (asset: ProductDownloadAsset): ProductDownloadAssetView => ({
  ...productDownloadMetadata(asset),
  downloadPath: API_PATHS.memberProductDownload
    .replace(':productId', encodeURIComponent(asset.productId))
    .replace(':assetId', encodeURIComponent(asset.id)),
});

const tenantlessIdentity = (user: AuthenticatedUser): Identity => ({
  userId: user.userId,
  email: user.email,
  name: user.name,
  emailVerified: user.emailVerified,
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
  memberBannedAt: null,
});

const checkoutIdentity = (tenant: { id: string; slug: string; name: string; }): Identity => ({
  userId: 'checkout',
  email: 'checkout@invalid.test',
  name: 'Checkout',
  emailVerified: false,
  tenantId: tenant.id,
  tenantSlug: tenant.slug,
  tenantName: tenant.name,
  staffRole: null,
  memberId: null,
  memberBannedAt: null,
});

const checkoutConsentEvidence = (headers: Headers) => {
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const userAgent = headers.get('user-agent') ?? undefined;
  return {
    ...(ip === undefined || ip === '' ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
};

const recordCheckoutConsents = async (
  deps: AppDeps,
  input: {
    tenant: { id: string; slug: string; name: string; };
    email: string | undefined;
    selectedDefinitionIds: string[];
    attachedDefinitionIds: string[];
    productId: string;
    orderId: string;
    collectedAt: string;
    confirmationBaseUrl: string;
    ip?: string;
    userAgent?: string;
  },
): Promise<void> => {
  if (deps.marketing === undefined || input.email === undefined || input.selectedDefinitionIds.length === 0) return;
  const proofRef = `product:${input.productId};order:${input.orderId}`;
  try {
    const recorded = await recordCheckoutMarketingConsents(
      { identity: checkoutIdentity(input.tenant) },
      {
        email: input.email,
        selectedDefinitionIds: input.selectedDefinitionIds,
        attachedDefinitionIds: input.attachedDefinitionIds,
        evidence: {
          collectedAt: input.collectedAt,
          proofRef,
          ...(input.ip === undefined ? {} : { ip: input.ip }),
          ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
        },
        confirmationBaseUrl: input.confirmationBaseUrl,
      },
      {
        definitions: deps.marketing.definitions,
        consents: deps.marketing.marketingConsents,
        confirmations: deps.marketing.confirmations,
        outbox: deps.emailOutbox,
        ids: deps.ids,
        tokens: { nextToken: () => crypto.randomUUID().replaceAll('-', '') },
        clock: deps.clock,
      },
    );
    if (!recorded.ok) {
      deps.logger.error(`[checkout-consent] tenant=${input.tenant.id} proof=${proofRef} error=${recorded.error.code}:${recorded.error.message}`);
    }
  } catch (cause) {
    deps.logger.error(`[checkout-consent] tenant=${input.tenant.id} proof=${proofRef} unexpected=${String(cause)}`);
  }
};

export const registerInternalRoutes = (app: Hono<Vars>, deps: AppDeps): void => {
  const selfAuthenticatingRouteStart = app.routes.length;
  app.post(API_PATHS.emailDispatch, async (c) => {
    if (c.req.header(EMAIL_DISPATCH_SECRET_HEADER) !== deps.emailDispatchSecret) {
      return respond(err(unauthorized('Invalid email dispatch secret')));
    }
    return respond(await deps.dispatchEmails('manual'));
  });

  app.get(API_PATHS.emailDispatch, async (c) => {
    if (c.req.header('authorization') !== `Bearer ${deps.emailDispatchCronSecret}`) {
      return respond(err(unauthorized('Invalid email dispatch secret')));
    }
    return respond(await deps.dispatchEmails('cron'));
  });

  app.post(API_PATHS.autoInvoiceDispatch, async (c) => {
    if (c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER) !== deps.autoInvoiceDispatchSecret) {
      return respond(err(unauthorized('Invalid automatic invoice dispatch secret')));
    }
    return respond(await deps.dispatchAutoInvoices());
  });

  app.get(API_PATHS.autoInvoiceDispatch, async (c) => {
    if (c.req.header('authorization') !== `Bearer ${deps.autoInvoiceDispatchSecret}`) {
      return respond(err(unauthorized('Invalid automatic invoice dispatch secret')));
    }
    return respond(await deps.dispatchAutoInvoices());
  });

  app.post(API_PATHS.ksefDispatch, async (c) => {
    if (deps.ksef === undefined) return respond(err(internal('KSeF is not configured')));
    if (c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER) !== deps.ksef.dispatchSecret) {
      return respond(err(unauthorized('Invalid KSeF dispatch secret')));
    }
    return respond(await deps.ksef.dispatch());
  });

  app.get(API_PATHS.ksefDispatch, async (c) => {
    if (deps.ksef === undefined) return respond(err(internal('KSeF is not configured')));
    if (c.req.header('authorization') !== `Bearer ${deps.ksef.dispatchSecret}`) {
      return respond(err(unauthorized('Invalid KSeF dispatch secret')));
    }
    return respond(await deps.ksef.dispatch());
  });

  app.get(API_PATHS.globalSchedulerRuns, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    if (c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER) !== deps.marketing.cronSecret) {
      return respond(err(unauthorized('Invalid scheduler operator secret')));
    }
    const parsed = schedulerRunsQuerySchema.safeParse({
      ...(c.req.query('kind') === undefined ? {} : { kind: c.req.query('kind') }),
      ...(c.req.query('status') === undefined ? {} : { status: c.req.query('status') }),
      ...(c.req.query('since') === undefined ? {} : { since: c.req.query('since') }),
      ...(c.req.query('cursor') === undefined ? {} : { cursor: c.req.query('cursor') }),
      ...(c.req.query('limit') === undefined ? {} : { limit: c.req.query('limit') }),
    });
    return parsed.success
      ? respond(await listGlobalSchedulerRuns(parsed.data, { runs: deps.marketing.runs }))
      : respond(err(validation('Invalid scheduler runs query', parsed.error.flatten())));
  });

  app.get(API_PATHS.globalSchedulerRun, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    if (c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER) !== deps.marketing.cronSecret) {
      return respond(err(unauthorized('Invalid scheduler operator secret')));
    }
    return respond(await getGlobalSchedulerRun({ runId: c.req.param('id') }, { runs: deps.marketing.runs }));
  });

  // A freshly registered user has no member or staff grant, so tenant identity resolution would reject this session-authenticated route.
  app.post(API_PATHS.termsConsent, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respond(tenant);
    if (!tenant.value) return respond(err(tenantNotFound()));
    const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
    if (!user) return respond(err(unauthorized()));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = termsConsentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid consent payload', parsed.error.flatten())));
    }
    return respond(
      await enforceTermsConsent(
        tenant.value.tenant.id,
        { accepted: parsed.data.accepted, userId: user.userId, email: user.email, source: 'register' },
        deps,
      ),
    );
  });

  app.post(API_PATHS.tenants, async (c) => {
    const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
    if (!user) return respond(err(unauthorized()));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = tenantCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid tenant payload', parsed.error.flatten())));
    }
    const result = await createTenant({ identity: tenantlessIdentity(user) }, parsed.data, deps);
    return respond(result.ok ? ok({ tenant: result.value }) : result);
  });

  if (deps.devEndpoints.simulatedPayments) {
    app.post(API_PATHS.devSimulatePurchase, async (c) => {
      const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
      if (!tenant.ok) return respond(tenant);
      if (!tenant.value) return respond(err(tenantNotFound()));

      const body: unknown = await c.req.json().catch(() => null);
      const parsed = simulatePurchaseInputSchema.safeParse(body);
      if (!parsed.success) return respond(err(validation('Invalid purchase payload', parsed.error.flatten())));

      const selection = await validateCheckoutSelection(tenant.value.tenant.id, parsed.data, deps);
      if (!selection.ok) return respond(selection);

      const consent = await validateTermsConsent(
        tenant.value.tenant.id,
        parsed.data.termsAccepted,
        deps.tenants,
      );
      if (!consent.ok) return respond(consent);

      let result: Result<SimulatePurchaseResult, AppError>;
      if (parsed.data.couponCode === undefined) {
        result = await simulatePurchase(
          tenant.value.tenant.id,
          {
            email: parsed.data.email,
            productId: parsed.data.productId,
            ...(parsed.data.priceId === undefined ? {} : { priceId: parsed.data.priceId }),
            ...(parsed.data.billing === undefined ? {} : { billing: parsed.data.billing }),
          },
          deps,
        );
      } else if (
        deps.coupons === undefined ||
        deps.couponRedemptions === undefined ||
        deps.couponCheckoutSessions === undefined ||
        deps.priceHistory === undefined
      ) {
        result = err(internal('Coupon checkout is not configured'));
      } else {
        const price = selection.value.price;
        const validated = await validateCouponForCheckout(
          tenant.value.tenant.id,
          {
            code: parsed.data.couponCode,
            email: parsed.data.email,
            productId: selection.value.product.id,
            priceId: price?.id ?? null,
            priceKind: price?.kind ?? 'one_time',
            amountCents: price?.amountCents ?? selection.value.product.priceCents,
            currency: price?.currency ?? selection.value.product.currency,
          },
          {
            coupons: deps.coupons,
            redemptions: deps.couponRedemptions,
            priceHistory: deps.priceHistory,
            clock: deps.clock,
          },
        );
        if (!validated.ok) {
          result = validated;
        } else {
          const couponSessionId = deps.ids.nextId();
          const objectId = `simulated_${couponSessionId}`;
          const captureId = deps.ids.nextId();
          await deps.checkoutConsentCaptures.create(tenant.value.tenant.id, {
            id: captureId,
            capture: {
              termsAccepted: parsed.data.termsAccepted === true,
              selectedDefinitionIds: parsed.data.marketingConsentDefinitionIds,
              attachedDefinitionIds: selection.value.product.checkoutConsentDefinitionIds ?? [],
              collectedAt: deps.clock.nowIso(),
              confirmationBaseUrl: `${deps.appBaseUrl}/marketing/confirm`,
              ...(parsed.data.billing === undefined ? {} : { billing: parsed.data.billing }),
            },
            createdAt: deps.clock.nowIso(),
          });
          await deps.couponCheckoutSessions.create(tenant.value.tenant.id, {
            id: couponSessionId,
            tenantId: tenant.value.tenant.id,
            couponId: validated.value.coupon.id,
            providerSessionId: objectId,
            memberEmail: parsed.data.email,
            productId: selection.value.product.id,
            priceId: price?.id ?? null,
            originalCents: validated.value.breakdown.originalCents,
            discountCents: validated.value.breakdown.discountCents,
            finalCents: validated.value.breakdown.finalCents,
            currency: validated.value.breakdown.currency,
            startedAt: deps.clock.nowIso(),
          });
          const event: PaymentWebhookEvent = {
            id: `event_${objectId}`,
            type: 'checkout.session.completed',
            objectId,
            checkoutSession: {
              email: parsed.data.email,
              subscriptionId: price?.kind === 'recurring' ? `subscription_${couponSessionId}` : null,
              paymentIntentId: null,
              invoiceId: null,
              amountTotalCents: validated.value.breakdown.finalCents,
              discountTotalCents: validated.value.breakdown.discountCents,
              metadata: {
                tenantId: tenant.value.tenant.id,
                productId: selection.value.product.id,
                priceId: price?.id ?? null,
                memberEmail: parsed.data.email,
                language: parsed.data.language,
                couponCheckoutSessionId: couponSessionId,
                checkoutConsentCaptureId: captureId,
              },
            },
          };
          const fulfilled = await fulfillStripeWebhook(
            tenant.value.tenant,
            event,
            { ...deps, exposeMagicLinks: deps.devEndpoints.exposeMagicLinks },
            'simulated',
          );
          if (!fulfilled.ok) {
            result = fulfilled;
          } else {
            const order = await deps.paymentRefunds.findOrderByProviderObjectIds(
              tenant.value.tenant.id,
              { checkoutSession: objectId },
            );
            const subscription = order === null
              ? undefined
              : (await deps.subscriptions.listForMember(
                tenant.value.tenant.id,
                order.memberId,
              )).find((candidate) => candidate.productId === selection.value.product.id);
            result = order === null
              ? err(internal('Coupon fulfillment did not create an order'))
              : ok({
                memberId: order.memberId,
                productId: selection.value.product.id,
                alreadyOwned: false,
                subscriptionId: subscription?.id ?? null,
                orderId: order.id,
              });
          }
        }
      }
      if (!result.ok) return respond(result);

      const terms = await enforceTermsConsent(
        tenant.value.tenant.id,
        {
          accepted: parsed.data.termsAccepted,
          userId: null,
          email: parsed.data.email,
          source: 'checkout',
        },
        deps,
      );
      if (!terms.ok) return respond(terms);

      if (result.value.orderId !== null) {
        await recordCheckoutConsents(deps, {
          tenant: tenant.value.tenant,
          email: parsed.data.email,
          selectedDefinitionIds: parsed.data.marketingConsentDefinitionIds,
          attachedDefinitionIds: selection.value.product.checkoutConsentDefinitionIds ?? [],
          productId: selection.value.product.id,
          orderId: result.value.orderId,
          collectedAt: deps.clock.nowIso(),
          confirmationBaseUrl: `${magicLinkBaseUrl(
            c.req.header('host') ?? '',
            c.req.header('x-forwarded-proto') ?? null,
            tenant.value.source,
            deps.appBaseUrl,
          )}/marketing/confirm`,
          ...checkoutConsentEvidence(c.req.raw.headers),
        });
        const orderDetails = deps.orderDetails;
        const paidOrder = orderDetails === undefined
          ? null
          : await orderDetails.findById(tenant.value.tenant.id, result.value.orderId);
        if (paidOrder !== null && orderDetails !== undefined) {
          await autoIssueOnPayment(tenant.value.tenant.id, paidOrder, {
            invoices: deps.invoices,
            invoicing: deps.invoicing,
            orderDetails,
            tenants: deps.tenants,
            tenantSecrets: deps.tenantSecrets,
            secretCrypto: deps.secretCrypto,
            ids: deps.ids,
            clock: deps.clock,
          });
        }
      }

      const baseUrl = magicLinkBaseUrl(
        c.req.header('host') ?? '',
        c.req.header('x-forwarded-proto') ?? null,
        tenant.value.source,
        deps.appBaseUrl,
      );
      const issuedMagicLink = await issueMagicLink(deps, {
        email: parsed.data.email,
        tenantId: tenant.value.tenant.id,
        tenantName: tenant.value.tenant.name,
        language: parsed.data.language,
        baseUrl,
      });
      const magicLink = deps.devEndpoints.exposeMagicLinks ? issuedMagicLink : null;
      return respond(ok({ ...result.value, magicLink }));
    });

    app.get(API_PATHS.devMagicLink, async (c) => {
      const email = c.req.query('email');
      if (!email) return respond(err(validation('Missing "email" query parameter')));
      return respond(ok({ magicLink: await deps.devMagicLinks.findByEmail(email) }));
    });

    app.get(API_PATHS.devEmail, async (c) => {
      const to = c.req.query('to');
      if (!to) return respond(err(validation('Missing "to" query parameter')));
      return respond(ok({ email: await deps.devEmails.findByRecipient(to) }));
    });

    app.post(API_PATHS.devGrant, async (c) => {
      const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
      if (!tenant.ok) return respond(tenant);
      if (!tenant.value) return respond(err(tenantNotFound()));

      const body: unknown = await c.req.json().catch(() => null);
      const parsed = devGrantInputSchema.safeParse(body);
      if (!parsed.success) return respond(err(validation('Invalid grant payload', parsed.error.flatten())));

      return respond(await devGrantProduct(tenant.value.tenant.id, parsed.data, deps));
    });

    const simulateSubscriptionRoute = (
      path: string,
      run: typeof simulateSubscriptionCycle,
    ): void => {
      app.post(path, async (c) => {
        const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
        if (!tenant.ok) return respond(tenant);
        if (!tenant.value) return respond(err(tenantNotFound()));

        const body: unknown = await c.req.json().catch(() => null);
        const parsed = subscriptionSimulateInputSchema.safeParse(body);
        if (!parsed.success) return respond(err(validation('Invalid subscription payload', parsed.error.flatten())));

        const result = await run(tenant.value.tenant, parsed.data.subscriptionId, {
          ...deps,
          exposeMagicLinks: deps.devEndpoints.exposeMagicLinks,
        });
        return respond(result);
      });
    };

    simulateSubscriptionRoute(API_PATHS.devSubscriptionSimulateCycle, simulateSubscriptionCycle);
    simulateSubscriptionRoute(API_PATHS.devSubscriptionSimulateFailure, simulateSubscriptionFailure);
  }

  app.post(API_PATHS.m2mEnroll, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respond(tenant);
    if (!tenant.value) return respond(err(tenantNotFound()));

    const presentedKey = c.req.header(API_KEY_HEADER);
    if (presentedKey === undefined) return respond(err(unauthorized('Missing API key')));
    const authed = await authenticateApiKey(tenant.value.tenant.id, presentedKey, deps);
    if (!authed.ok) return respond(authed);
    if (!apiKeyHasCapability(authed.value, 'enrollment:create')) {
      return respond(err(forbidden('enrollment:create is not permitted')));
    }

    const body: unknown = await c.req.json().catch(() => null);
    const parsed = m2mEnrollRequestSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid enrollment payload', parsed.error.flatten())));

    const result = await m2mEnroll(tenant.value.tenant, parsed.data, {
      ...deps,
      exposeMagicLinks: deps.devEndpoints.exposeMagicLinks,
    });
    return respond(result);
  });

  registerAuthenticatedMarketingRoutes(app, deps);
  registerM2mImportRoutes(app, deps);

  assertSelfAuthenticatingRouteManifest(
    app.routes.slice(selfAuthenticatingRouteStart),
    SELF_AUTHENTICATING_ROUTE_MANIFEST,
  );

  app.use('/api/*', async (c, next) => {
    const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
    const identity = await resolveIdentity(
      user,
      {
        host: c.req.header('host') ?? '',
        tenantHeader: c.req.header(TENANT_HEADER) ?? null,
      },
      deps,
    );
    if (!identity.ok) return respond(identity);
    c.set('identity', identity.value);
    await next();
  });

  app.get(API_PATHS.marketingConsentDefinitions, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await listMarketingConsentDefinitions({ identity: c.get('identity') }, { definitions: deps.marketing.definitions }));
  });

  app.get(API_PATHS.tenantSchedulerRuns, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const parsed = schedulerRunsQuerySchema.safeParse({
      ...(c.req.query('kind') === undefined ? {} : { kind: c.req.query('kind') }),
      ...(c.req.query('couponId') === undefined ? {} : { couponId: c.req.query('couponId') }),
      ...(c.req.query('status') === undefined ? {} : { status: c.req.query('status') }),
      ...(c.req.query('since') === undefined ? {} : { since: c.req.query('since') }),
      ...(c.req.query('cursor') === undefined ? {} : { cursor: c.req.query('cursor') }),
      ...(c.req.query('limit') === undefined ? {} : { limit: c.req.query('limit') }),
    });
    return parsed.success
      ? respond(await listSchedulerRunsForTenant(
        { identity: c.get('identity') },
        parsed.data,
        { runs: deps.marketing.runs, clock: deps.clock },
      ))
      : respond(err(validation('Invalid scheduler runs query', parsed.error.flatten())));
  });

  app.get(API_PATHS.tenantSchedulerRun, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await getSchedulerRunForTenant(
      { identity: c.get('identity') },
      { runId: c.req.param('id') },
      { runs: deps.marketing.runs },
    ));
  });

  app.post(API_PATHS.marketingConsentDefinitions, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingConsentDefinitionCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid consent definition payload', parsed.error.flatten())));
    return respond(await createMarketingConsentDefinition({ identity: c.get('identity') }, parsed.data, {
      definitions: deps.marketing.definitions, documents: deps.marketing.documents, ids: deps.ids, clock: deps.clock,
    }));
  });

  app.get(API_PATHS.marketingConsentDefinition, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await getMarketingConsentDefinition(
      { identity: c.get('identity') },
      { definitionId: c.req.param('id') },
      { definitions: deps.marketing.definitions },
    ));
  });

  app.post(API_PATHS.marketingConsentDefinitionUpdate, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingConsentDefinitionUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid consent definition payload', parsed.error.flatten())));
    return respond(await updateMarketingConsentDefinition({ identity: c.get('identity') }, parsed.data, {
      definitions: deps.marketing.definitions, documents: deps.marketing.documents, ids: deps.ids, clock: deps.clock,
    }));
  });

  app.get(API_PATHS.marketingCampaigns, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const result = await listCampaignsWithEngagement({ identity: c.get('identity') }, {
      campaigns: deps.marketing.campaigns,
      sends: deps.marketing.campaignSends,
    });
    return respond(result.ok ? ok({ campaigns: result.value }) : result);
  });

  app.post(API_PATHS.marketingCampaigns, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingCampaignCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid campaign payload', parsed.error.flatten())));
    const result = await createCampaign({ identity: c.get('identity') }, parsed.data, {
      campaigns: deps.marketing.campaigns, audience: deps.marketing.audience,
      definitions: deps.marketing.definitions, layouts: deps.marketing.layouts,
      ids: deps.ids, clock: deps.clock, scheduler: deps.marketing.scheduler,
    });
    return respond(result.ok ? ok({ campaign: result.value }) : result);
  });

  app.post(API_PATHS.marketingCampaignSchedule, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingCampaignScheduleInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid campaign schedule payload', parsed.error.flatten())));
    const result = await scheduleCampaign({ identity: c.get('identity') }, parsed.data, {
      campaigns: deps.marketing.campaigns, audience: deps.marketing.audience,
      definitions: deps.marketing.definitions, ids: deps.ids, clock: deps.clock, scheduler: deps.marketing.scheduler,
    });
    return respond(result.ok ? ok({ campaign: result.value }) : result);
  });

  app.get(API_PATHS.marketingCampaign, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const result = await getCampaignWithEngagement(
      { identity: c.get('identity') },
      { campaignId: c.req.param('id') },
      { campaigns: deps.marketing.campaigns, sends: deps.marketing.campaignSends },
    );
    return respond(result.ok ? ok({ campaign: result.value }) : result);
  });

  app.post(API_PATHS.marketingCampaignUpdate, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingCampaignUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid campaign payload', parsed.error.flatten())));
    return respond(await updateMarketingCampaign({ identity: c.get('identity') }, parsed.data, {
      campaigns: deps.marketing.campaigns, definitions: deps.marketing.definitions, layouts: deps.marketing.layouts,
    }));
  });

  app.post(API_PATHS.marketingCampaignAction, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingCampaignActionInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid campaign action payload', parsed.error.flatten())));
    const campaignDeps = {
      campaigns: deps.marketing.campaigns, audience: deps.marketing.audience, definitions: deps.marketing.definitions,
      ids: deps.ids, clock: deps.clock, scheduler: deps.marketing.scheduler,
    };
    const result = parsed.data.action === 'cancel'
      ? await cancelCampaign({ identity: c.get('identity') }, parsed.data, campaignDeps)
      : await pauseCampaign({ identity: c.get('identity') }, {
        campaignId: parsed.data.campaignId, resume: parsed.data.action === 'resume',
      }, campaignDeps);
    return respond(result.ok ? ok({ campaign: result.value }) : result);
  });

  app.post(API_PATHS.marketingCampaignTest, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingCampaignActionInputSchema.pick({ campaignId: true }).safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid campaign test payload', parsed.error.flatten())));
    const result = await testSendCampaignToSelf({ identity: c.get('identity') }, parsed.data, {
      definitions: deps.marketing.definitions, consents: deps.marketing.marketingConsents,
      campaigns: deps.marketing.campaigns, layouts: deps.marketing.layouts, sends: deps.marketing.campaignSends,
      events: deps.marketing.events,
      audience: deps.marketing.audience, suppressions: deps.marketing.suppressions,
      unsubscribes: deps.marketing.unsubscribes, sesSettings: deps.marketing.sesSettings,
      ses: deps.marketing.marketingSes, credentials: deps.marketing.marketingCredentials,
      quotaReader: deps.marketing.quotaReader, throttle: deps.marketing.throttle,
      hmac: deps.marketing.hmac, ids: deps.ids, tokens: { nextToken: () => crypto.randomUUID().replaceAll('-', '') },
      clock: deps.clock, unsubscribeBaseUrl: `${deps.appBaseUrl}/u`,
      scheduler: deps.marketing.scheduler,
      runs: deps.marketing.runs,
      outbox: { enqueue: async () => ok({ id: '' }), claimBatch: async () => ok([]), markSent: async () => ok(undefined), markFailed: async () => ok(undefined) },
    });
    return respond(result.ok ? ok({ sent: true as const }) : result);
  });

  app.post(API_PATHS.marketingAudiencePreview, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingAudiencePreviewInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid audience preview payload', parsed.error.flatten())));
    return respond(await previewMarketingAudience({ identity: c.get('identity') }, parsed.data, {
      definitions: deps.marketing.definitions, audience: deps.marketing.audience,
    }));
  });

  app.get(API_PATHS.marketingDocuments, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await listTenantDocuments({ identity: c.get('identity') }, { documents: deps.marketing.documents }));
  });

  app.post(API_PATHS.marketingDocuments, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingDocumentCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid hosted document payload', parsed.error.flatten())));
    return respond(await createTenantDocument({ identity: c.get('identity') }, parsed.data, {
      documents: deps.marketing.documents, ids: deps.ids, clock: deps.clock,
    }));
  });

  app.get(API_PATHS.marketingDocument, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await getTenantDocument({ identity: c.get('identity') }, { documentId: c.req.param('id') }, {
      documents: deps.marketing.documents,
    }));
  });

  app.post(API_PATHS.marketingDocumentUpdate, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingDocumentUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid hosted document payload', parsed.error.flatten())));
    return respond(await saveTenantDocumentDraft({ identity: c.get('identity') }, parsed.data, {
      documents: deps.marketing.documents, ids: deps.ids, clock: deps.clock,
    }));
  });

  app.post(API_PATHS.marketingDocumentPublish, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingDocumentPublishInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid hosted document publish payload', parsed.error.flatten())));
    return respond(await publishTenantDocument({ identity: c.get('identity') }, parsed.data, {
      documents: deps.marketing.documents, clock: deps.clock,
    }));
  });

  app.get(API_PATHS.marketingLayouts, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await listEmailLayouts({ identity: c.get('identity') }, { layouts: deps.marketing.layouts }));
  });

  app.post(API_PATHS.marketingLayouts, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingLayoutSaveInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid e-mail layout payload', parsed.error.flatten())));
    return respond(await saveEmailLayout({ identity: c.get('identity') }, parsed.data, {
      layouts: deps.marketing.layouts, ids: deps.ids, clock: deps.clock,
    }));
  });

  app.get(API_PATHS.marketingSesSettings, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await getTenantSesMarketingSettings({ identity: c.get('identity') }, {
      webhookBaseUrl: `${deps.appBaseUrl}/api/webhooks/ses`,
    }, {
      settings: deps.marketing.sesSettings,
      secrets: deps.tenantSecrets,
      pool: deps.marketing.platformTransactionalPool,
    }));
  });

  app.get(API_PATHS.marketingReputation, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await getEmailReputation(
      { identity: c.get('identity') },
      { events: deps.marketing.events, clock: deps.clock },
    ));
  });

  app.post(API_PATHS.marketingSesSettings, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingSesSettingsUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid SES settings payload', parsed.error.flatten())));
    return respond(await updateTenantSesMarketingSettings({ identity: c.get('identity') }, parsed.data, {
      settings: deps.marketing.sesSettings, secrets: deps.tenantSecrets,
      tokens: { nextToken: () => crypto.randomUUID().replaceAll('-', '') }, clock: deps.clock,
      webhookBaseUrl: `${deps.appBaseUrl}/api/webhooks/ses`,
      pool: deps.marketing.platformTransactionalPool,
    }));
  });

  app.post(API_PATHS.marketingSesOnboarding, async (c) => {
    if (deps.marketing?.sesOnboarding === undefined) {
      return respond(err(internal('SES onboarding is not configured')));
    }
    return respond(await pollSesOnboarding({ identity: c.get('identity') }, {
      settings: deps.marketing.sesSettings,
      credentials: deps.marketing.sesOnboarding.credentials,
      controlPlane: deps.marketing.sesOnboarding.controlPlane,
      clock: deps.clock,
      webhookBaseUrl: `${deps.appBaseUrl}/api/webhooks/ses`,
    }));
  });

  app.post(API_PATHS.marketingSesIdentityStart, async (c) => {
    if (deps.marketing?.sesOnboarding === undefined) {
      return respond(err(internal('SES onboarding is not configured')));
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingSesIdentityStartInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid SES identity payload', parsed.error.flatten())));
    return respond(await startSesIdentityVerification({ identity: c.get('identity') }, parsed.data, {
      settings: deps.marketing.sesSettings,
      credentials: deps.marketing.sesOnboarding.credentials,
      controlPlane: deps.marketing.sesOnboarding.controlPlane,
      clock: deps.clock,
      webhookBaseUrl: `${deps.appBaseUrl}/api/webhooks/ses`,
    }));
  });

  app.post(API_PATHS.marketingSesProvision, async (c) => {
    if (deps.marketing?.sesOnboarding === undefined) {
      return respond(err(internal('SES onboarding is not configured')));
    }
    return respond(await provisionSesInfrastructure({ identity: c.get('identity') }, {
      settings: deps.marketing.sesSettings,
      credentials: deps.marketing.sesOnboarding.credentials,
      controlPlane: deps.marketing.sesOnboarding.controlPlane,
      clock: deps.clock,
      webhookBaseUrl: `${deps.appBaseUrl}/api/webhooks/ses`,
    }));
  });

  app.post(API_PATHS.marketingSesSimulator, async (c) => {
    if (deps.marketing?.sesOnboarding === undefined) {
      return respond(err(internal('SES onboarding is not configured')));
    }
    return respond(await sendSesSimulatorTest({ identity: c.get('identity') }, {
      settings: deps.marketing.sesSettings,
      credentials: deps.marketing.sesOnboarding.credentials,
      controlPlane: deps.marketing.sesOnboarding.controlPlane,
      clock: deps.clock,
      webhookBaseUrl: `${deps.appBaseUrl}/api/webhooks/ses`,
    }));
  });

  app.get(API_PATHS.marketingStaffSuppressions, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const identity = c.get('identity');
    const tenant = authorizeRequiredTenant({ identity }, 'marketing:suppression:read');
    if (!tenant.ok) return respond(tenant);
    return respond(ok(await deps.marketing.suppressions.list(tenant.value, { limit: 100 })));
  });

  app.get(API_PATHS.emailSendsExport, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const parsed = emailSendsExportQuerySchema.safeParse({
      format: c.req.query('format'),
      ...(c.req.query('kind') === undefined ? {} : { kind: c.req.query('kind') }),
      ...(c.req.query('status') === undefined ? {} : { status: c.req.query('status') }),
      ...(c.req.query('deliveryStatus') === undefined ? {} : { deliveryStatus: c.req.query('deliveryStatus') }),
      ...(c.req.query('transport') === undefined ? {} : { transport: c.req.query('transport') }),
      ...(c.req.query('campaignId') === undefined ? {} : { campaignId: c.req.query('campaignId') }),
      ...(c.req.query('runId') === undefined ? {} : { runId: c.req.query('runId') }),
      ...(c.req.query('sourceApp') === undefined ? {} : { sourceApp: c.req.query('sourceApp') }),
      ...(c.req.query('search') === undefined ? {} : { search: c.req.query('search') }),
    });
    if (!parsed.success) return respond(err(validation('Invalid e-mail sends export query', parsed.error.flatten())));
    return respond(await exportEmailSends(
      { identity: c.get('identity') },
      parsed.data,
      { sends: deps.marketing.emailSends },
    ));
  });

  app.get(API_PATHS.emailSends, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const parsed = emailSendsQuerySchema.safeParse({
      ...(c.req.query('kind') === undefined ? {} : { kind: c.req.query('kind') }),
      ...(c.req.query('status') === undefined ? {} : { status: c.req.query('status') }),
      ...(c.req.query('deliveryStatus') === undefined ? {} : { deliveryStatus: c.req.query('deliveryStatus') }),
      ...(c.req.query('transport') === undefined ? {} : { transport: c.req.query('transport') }),
      ...(c.req.query('campaignId') === undefined ? {} : { campaignId: c.req.query('campaignId') }),
      ...(c.req.query('runId') === undefined ? {} : { runId: c.req.query('runId') }),
      ...(c.req.query('sourceApp') === undefined ? {} : { sourceApp: c.req.query('sourceApp') }),
      ...(c.req.query('search') === undefined ? {} : { search: c.req.query('search') }),
      ...(c.req.query('cursor') === undefined ? {} : { cursor: c.req.query('cursor') }),
      ...(c.req.query('limit') === undefined ? {} : { limit: c.req.query('limit') }),
    });
    if (!parsed.success) return respond(err(validation('Invalid e-mail sends query', parsed.error.flatten())));
    return respond(await listEmailSends(
      { identity: c.get('identity') },
      parsed.data,
      { sends: deps.marketing.emailSends },
    ));
  });

  app.get(API_PATHS.emailSend, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const kind = z.enum(['transactional', 'marketing']).safeParse(c.req.param('kind'));
    if (!kind.success) return respond(err(validation('Invalid e-mail kind', kind.error.flatten())));
    return respond(await getEmailSend(
      { identity: c.get('identity') },
      { kind: kind.data, id: c.req.param('id') },
      { sends: deps.marketing.emailSends, events: deps.marketing.events },
    ));
  });

  app.get(API_PATHS.memberEmailSends, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await listMemberEmailSends(
      { identity: c.get('identity') },
      { memberId: c.req.param('id') },
      { sends: deps.marketing.emailSends, members: deps.members },
    ));
  });

  app.post(API_PATHS.marketingStaffSuppressions, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = marketingSuppressionCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid suppression payload', parsed.error.flatten())));
    const result = await addManualSuppression({ identity: c.get('identity') }, parsed.data, {
      suppressions: deps.marketing.suppressions, hmac: deps.marketing.hmac, ids: deps.ids, clock: deps.clock,
    });
    return respond(result.ok ? ok({ suppression: result.value }) : result);
  });

  app.get(API_PATHS.me, async (c) => {
    const identity = c.get('identity');
    return respond(
      ok({
        userId: identity.userId,
        email: identity.email,
        name: identity.name,
        emailVerified: identity.emailVerified,
        tenant:
          identity.tenantId &&
            identity.tenantSlug &&
            identity.tenantName &&
            (identity.staffRole || identity.memberId)
            ? {
              id: identity.tenantId,
              slug: identity.tenantSlug,
              name: identity.tenantName,
              staffRole: identity.staffRole,
              memberId: identity.memberId,
              banned: identity.memberBannedAt !== null,
            }
            : null,
      }),
    );
  });

  app.get(API_PATHS.memberBillingOrders, async (c) => {
    const parsed = memberBillingOrdersQuerySchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
    });
    if (!parsed.success) return respond(err(validation('Invalid billing-order query', parsed.error.flatten())));
    return respond(await listMemberBillingOrders(
      { identity: c.get('identity') },
      parsed.data,
      { orders: deps.orders },
    ));
  });

  app.get(API_PATHS.memberDataExport, async (c) => {
    if (deps.marketing === undefined) {
      return respond(err(internal('Marketing repositories are not configured')));
    }
    return respond(
      await exportMyData(
        { identity: c.get('identity') },
        {
          members: deps.members,
          grants: deps.grants,
          subscriptions: deps.subscriptions,
          orders: deps.orders,
          invoices: deps.invoices,
          progress: deps.progress,
          posts: deps.posts,
          consents: deps.consents,
          marketingConsents: deps.marketing.marketingConsents,
          clock: deps.clock,
        },
      ),
    );
  });

  app.get(API_PATHS.memberErasureRequest, async (c) => {
    const result = await getMyErasureRequest(
      { identity: c.get('identity') },
      {
        members: deps.members,
        erasureRequests: deps.erasureRequests,
        ids: deps.ids,
        clock: deps.clock,
      },
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.post(API_PATHS.memberErasureRequest, async (c) => {
    const parsed = memberErasureRequestCreateInputSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return respond(err(validation('Invalid erasure request', parsed.error.flatten())));
    }
    const result = await requestMyErasure(
      { identity: c.get('identity') },
      {
        confirmEmail: parsed.data.confirmEmail,
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
      },
      {
        members: deps.members,
        erasureRequests: deps.erasureRequests,
        ids: deps.ids,
        clock: deps.clock,
        notifications: {
          tenants: deps.tenants,
          tenantAccess: deps.tenantAccess,
          emailOutbox: deps.emailOutbox,
          appBaseUrl: deps.appBaseUrl,
          baseDomain: deps.baseDomain,
          singleTenantMode: deps.singleTenantMode,
          dispatchEmail: deps.dispatchEmail,
        },
      },
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.delete(API_PATHS.memberErasureRequest, async (c) => {
    const result = await cancelMyErasureRequest(
      { identity: c.get('identity') },
      {
        members: deps.members,
        erasureRequests: deps.erasureRequests,
        ids: deps.ids,
        clock: deps.clock,
      },
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.get(API_PATHS.memberErasureRequests, async (c) => {
    const parsed = memberErasureRequestsQuerySchema.safeParse({
      status: c.req.query('status'),
    });
    if (!parsed.success) {
      return respond(err(validation('Invalid erasure request query', parsed.error.flatten())));
    }
    const result = await listErasureRequests(
      { identity: c.get('identity') },
      parsed.data.status === undefined ? {} : { status: parsed.data.status },
      { erasureRequests: deps.erasureRequests },
    );
    return respond(result.ok ? ok({ requests: result.value }) : result);
  });

  app.post(API_PATHS.memberErasureReject, async (c) => {
    const parsed = memberErasureRejectInputSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return respond(err(validation('Invalid erasure rejection', parsed.error.flatten())));
    }
    const result = await rejectErasureRequest(
      { identity: c.get('identity') },
      { requestId: c.req.param('requestId'), note: parsed.data.note },
      { erasureRequests: deps.erasureRequests, ids: deps.ids, clock: deps.clock },
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.get(API_PATHS.tenants, async (c) => {
    const result = await listMyTenants({ identity: c.get('identity') }, deps);
    return respond(result);
  });

  app.get(API_PATHS.products, async (c) => {
    const result = await listProducts({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ products: result.value }) : result);
  });

  app.get(API_PATHS.productDownloadAssets, async (c) => {
    const result = await listProductDownloadAssets(
      { identity: c.get('identity') },
      c.req.param('productId'),
      deps,
    );
    return respond(result.ok
      ? ok({ assets: result.value.map(productDownloadMetadata) })
      : result);
  });

  app.post(API_PATHS.productDownloadUpload, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productDownloadUploadRequestSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid download payload', parsed.error.flatten())));
    const result = await beginProductDownloadUpload(
      { identity: c.get('identity') },
      c.req.param('productId'),
      parsed.data,
      deps,
    );
    return respond(result.ok
      ? ok({
          asset: productDownloadMetadata(result.value.asset),
          upload: {
            url: result.value.uploadUrl,
            headers: { 'content-type': result.value.asset.contentType },
            expiresAt: result.value.expiresAt,
          },
        })
      : result);
  });

  app.post(API_PATHS.productDownloadComplete, async (c) => {
    const result = await completeProductDownloadUpload(
      { identity: c.get('identity') },
      c.req.param('productId'),
      c.req.param('assetId'),
      deps,
    );
    return respond(result.ok ? ok({ asset: productDownloadMetadata(result.value) }) : result);
  });

  app.delete(API_PATHS.productDownloadDelete, async (c) => {
    return respond(await deleteProductDownloadAsset(
      { identity: c.get('identity') },
      c.req.param('productId'),
      c.req.param('assetId'),
      deps,
    ));
  });

  app.get(API_PATHS.memberNavigation, async (c) => {
    const result = await getMemberNavigation({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ navigation: result.value }) : result);
  });

  app.get(API_PATHS.myProducts, async (c) => {
    const result = await listMyProducts({ identity: c.get('identity') }, deps);
    return respond(
      result.ok
        ? ok({
          products: result.value.map((product) => ({
            id: product.id,
            type: product.type,
            title: product.title,
            description: product.description,
            accessItems: product.accessItems,
            priceCents: product.priceCents,
            currency: product.currency,
            grantStatus: product.grantStatus,
            grantStartsAt: product.grantStartsAt,
            grantExpiresAt: product.grantExpiresAt,
            subscription: product.subscription,
            downloads: product.downloads.map(productDownloadView),
          })),
        })
        : result,
    );
  });

  app.get(API_PATHS.memberProductDownload, async (c) => {
    const result = await getProductDownload(
      { identity: c.get('identity') },
      c.req.param('productId'),
      c.req.param('assetId'),
      deps,
    );
    if (!result.ok) return respond(result);
    c.header('Cache-Control', 'no-store');
    return c.redirect(result.value, 302);
  });

  app.get(API_PATHS.members, async (c) => {
    const result = await listMembers({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ members: result.value }) : result);
  });

  app.get(API_PATHS.membersExport, async (c) => {
    const format = memberExportFormatSchema.safeParse(c.req.query('format'));
    if (!format.success) {
      return respond(err(validation('Query parameter "format" must be "csv" or "json"')));
    }
    return respond(await exportMembers({ identity: c.get('identity') }, { format: format.data }, deps));
  });

  app.post(API_PATHS.memberBan, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = memberBanInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid member ban payload', parsed.error.flatten())));
    const result = await setMemberBanned({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ member: result.value }) : result);
  });

  app.get(API_PATHS.memberGrants, async (c) => {
    const result = await listMemberGrants({ identity: c.get('identity') }, c.req.param('memberId'), deps);
    return respond(result.ok ? ok({ grants: result.value }) : result);
  });

  app.get(API_PATHS.memberCommerce, async (c) => {
    const result = await getMemberCommerceOverview(
      { identity: c.get('identity') },
      { memberId: c.req.param('memberId') },
      deps,
    );
    return respond(result);
  });

  app.get(API_PATHS.memberTimeline, async (c) => {
    const result = await listMemberTimeline(
      { identity: c.get('identity') },
      { memberId: c.req.param('memberId') },
      deps,
    );
    return respond(result.ok ? ok({ events: result.value }) : result);
  });

  app.get(API_PATHS.memberLearningSummary, async (c) => {
    const result = await getMemberLearningSummary(
      { identity: c.get('identity') },
      c.req.param('memberId'),
      deps,
    );
    return respond(result.ok ? ok({ summary: result.value }) : result);
  });

  app.post(API_PATHS.memberProgressReset, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = memberProgressResetInputSchema.safeParse(
      typeof body === 'object' && body !== null
        ? { ...body, memberId: c.req.param('memberId') }
        : { memberId: c.req.param('memberId') },
    );
    if (!parsed.success) return respond(err(validation('Invalid progress reset payload', parsed.error.flatten())));
    const result = await resetMemberCourseProgress({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ reset: result.value }) : result);
  });

  app.delete(API_PATHS.memberRemove, async (c) => {
    const parsed = memberRemoveInputSchema.safeParse({ memberId: c.req.param('memberId') });
    if (!parsed.success) return respond(err(validation('Invalid member id', parsed.error.flatten())));
    return respond(await removeMember({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.post(API_PATHS.grantsCreate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = grantCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid grant payload', parsed.error.flatten())));
    return respond(await grantProductToMember({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.delete(API_PATHS.grantRevoke, async (c) => {
    const parsed = grantRevokeInputSchema.safeParse({ grantId: c.req.param('grantId') });
    if (!parsed.success) return respond(err(validation('Invalid grant id', parsed.error.flatten())));
    return respond(await revokeGrant({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.get(API_PATHS.apiKeys, async (c) => {
    const result = await listTenantApiKeys({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ apiKeys: result.value }) : result);
  });

  app.post(API_PATHS.apiKeys, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = apiKeyCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid API key payload', parsed.error.flatten())));
    const result = await createTenantApiKey({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ apiKey: result.value.apiKey, secret: result.value.secret }) : result);
  });

  app.delete(API_PATHS.apiKeyRevoke, async (c) => {
    const parsed = apiKeyRevokeInputSchema.safeParse({ id: c.req.param('id') });
    if (!parsed.success) return respond(err(validation('Invalid API key id', parsed.error.flatten())));
    const result = await revokeTenantApiKey({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ apiKey: result.value }) : result);
  });

  app.get(API_PATHS.apiKeyImportAudit, async (c) => {
    const parsed = apiKeyImportAuditQuerySchema.safeParse({
      id: c.req.param('id'),
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) return respond(err(validation('Invalid import audit query', parsed.error.flatten())));
    return respond(await listImportAuditForApiKey(
      { identity: c.get('identity') },
      {
        id: parsed.data.id,
        limit: parsed.data.limit,
        ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
      },
      deps,
    ));
  });

  app.get(API_PATHS.tenantSecrets, async (c) =>
    respond(await getTenantSecretsMasked({ identity: c.get('identity') }, deps)),
  );

  app.post(API_PATHS.tenantSecrets, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = tenantSecretSetInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid secret payload', parsed.error.flatten())));
    const result = await setTenantSecret({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ secret: result.value }) : result);
  });

  app.delete(API_PATHS.tenantSecretDelete, async (c) => {
    const parsed = tenantSecretDeleteInputSchema.safeParse({ key: c.req.param('key') });
    if (!parsed.success) return respond(err(validation('Invalid secret key', parsed.error.flatten())));
    const result = await deleteTenantSecret({ identity: c.get('identity') }, parsed.data.key, deps);
    return respond(result.ok ? ok({ key: result.value.key }) : result);
  });

  app.get(API_PATHS.tenantSettings, async (c) => {
    const result = await getTenantSettings({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ settings: result.value }) : result);
  });

  app.post(API_PATHS.tenantSettingsUpdate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = tenantSettingsUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid tenant settings payload', parsed.error.flatten())));
    const result = await updateTenantSettings({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ settings: result.value }) : result);
  });

  app.get(API_PATHS.onboarding, async (c) => {
    const result = await getCreatorOnboarding({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ onboarding: result.value }) : result);
  });

  app.post(API_PATHS.onboardingDismiss, async (c) => {
    const result = await dismissCreatorOnboarding({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ onboarding: result.value }) : result);
  });

  app.post(API_PATHS.integrationTest, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = integrationTestInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid integration test payload', parsed.error.flatten())));
    return respond(await testIntegration(
      { identity: c.get('identity') },
      parsed.data,
      {
        appBaseUrl: deps.appBaseUrl,
        email: deps.email,
        emailSender: deps.emailSender,
        emailTransports: deps.emailTransports,
        payment: deps.payment,
        storage: deps.storage,
      },
    ));
  });

  app.post(API_PATHS.storageProbe, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = storageProbeInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid storage probe payload', parsed.error.flatten())));
    return respond(await probeStorageConnection(
      { identity: c.get('identity') },
      parsed.data,
      { storage: deps.storage },
    ));
  });

  app.post(API_PATHS.storageConfigure, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = storageConfigureInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid storage configuration payload', parsed.error.flatten())));
    return respond(await configureStorageConnection(
      { identity: c.get('identity') },
      parsed.data,
      deps,
    ));
  });

  app.post(API_PATHS.stripeConfigure, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = stripeConfigureInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid Stripe configuration', parsed.error.flatten())));
    return respond(await configureStripe(
      { identity: c.get('identity') },
      parsed.data,
      {
        appBaseUrl: deps.appBaseUrl,
        payment: deps.payment,
        tenantSecrets: deps.tenantSecrets,
        secretCrypto: deps.secretCrypto,
        ids: deps.ids,
        clock: deps.clock,
      },
    ));
  });

  app.post(API_PATHS.ifirmaTestConnection, async (c) =>
    respond(await testIfirmaConnection({ identity: c.get('identity') }, deps)),
  );

  app.post(API_PATHS.ksefTestConnection, async (c) =>
    respond(await testKsefConnection(
      { identity: c.get('identity') },
      { ...(deps.ksef === undefined ? {} : { ksef: deps.ksef }) },
    )),
  );

  app.get(API_PATHS.bunnyVideos, async (c) => {
    const parsed = bunnyVideosInputSchema.safeParse({
      search: c.req.query('search'),
      page: c.req.query('page') ?? 1,
    });
    if (!parsed.success) return respond(err(validation('Invalid video listing query', parsed.error.flatten())));
    const result = await listBunnyVideos({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ page: result.value }) : result);
  });

  app.post(API_PATHS.bunnyTestConnection, async (c) =>
    respond(await testBunnyConnection({ identity: c.get('identity') }, deps)),
  );

  app.post(API_PATHS.products, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productsCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid product payload', parsed.error.flatten())));
    }
    const result = await createProduct({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  });

  app.post(API_PATHS.productsUpdate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productsUpdateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid product update payload', parsed.error.flatten())));
    }
    const result = await updateProduct({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  });

  app.post(API_PATHS.productsPublish, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productsPublishInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid publish payload', parsed.error.flatten())));
    }
    const result = await publishProduct({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  });

  app.post(API_PATHS.productsUnpublish, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productsUnpublishInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid unpublish payload', parsed.error.flatten())));
    }
    const result = await unpublishProduct({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  });

  app.post(API_PATHS.productsAccessItems, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productsAccessItemsInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid product access items payload', parsed.error.flatten())));
    }
    const result = await updateProductAccessItems({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ product: result.value }) : result);
  });

  app.get(API_PATHS.productsAccessIssues, async (c) => {
    const result = await listProductAccessIssues({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ issues: result.value }) : result);
  });

  app.get(API_PATHS.productPrices, async (c) => {
    const result = await listProductPrices({ identity: c.get('identity') }, c.req.param('productId'), deps);
    return respond(result.ok ? ok({ prices: result.value }) : result);
  });

  app.post(API_PATHS.productPricesCreate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productPriceCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid price payload', parsed.error.flatten())));
    const result = await createProductPrice({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ price: result.value }) : result);
  });

  app.post(API_PATHS.productPriceDeactivate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productPriceDeactivateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid price payload', parsed.error.flatten())));
    const result = await deactivateProductPrice({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ price: result.value }) : result);
  });

  app.get(API_PATHS.orders, async (c) => {
    const query = {
      ...(c.req.query('status') === undefined ? {} : { status: c.req.query('status') }),
      ...(c.req.query('productId') === undefined ? {} : { productId: c.req.query('productId') }),
      ...(c.req.query('kind') === undefined ? {} : { kind: c.req.query('kind') }),
      ...(c.req.query('couponId') === undefined ? {} : { couponId: c.req.query('couponId') }),
      ...(c.req.query('search') === undefined ? {} : { search: c.req.query('search') }),
      ...(c.req.query('page') === undefined ? {} : { page: c.req.query('page') }),
      ...(c.req.query('pageSize') === undefined ? {} : { pageSize: c.req.query('pageSize') }),
    };
    const result = await listOrders({ identity: c.get('identity') }, query, deps);
    return respond(result);
  });

  app.get(API_PATHS.ordersReconciliation, async (c) => {
    const query = {
      ...(c.req.query('minAgeMinutes') === undefined
        ? {}
        : { minAgeMinutes: c.req.query('minAgeMinutes') }),
      ...(c.req.query('limit') === undefined ? {} : { limit: c.req.query('limit') }),
    };
    const parsed = ordersReconciliationQuerySchema.safeParse(query);
    if (!parsed.success) {
      return respond(err(validation('Invalid order reconciliation query', parsed.error.flatten())));
    }
    return respond(
      await listPaidOrdersWithoutGrant({ identity: c.get('identity') }, parsed.data, deps),
    );
  });

  app.get(API_PATHS.ordersExport, async (c) => {
    const query = {
      format: c.req.query('format'),
      ...(c.req.query('status') === undefined ? {} : { status: c.req.query('status') }),
      ...(c.req.query('productId') === undefined ? {} : { productId: c.req.query('productId') }),
      ...(c.req.query('kind') === undefined ? {} : { kind: c.req.query('kind') }),
      ...(c.req.query('couponId') === undefined ? {} : { couponId: c.req.query('couponId') }),
      ...(c.req.query('search') === undefined ? {} : { search: c.req.query('search') }),
    };
    const parsed = ordersExportQuerySchema.safeParse(query);
    if (!parsed.success) return respond(err(validation('Invalid orders export query', parsed.error.flatten())));
    return respond(await exportOrders({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.get(API_PATHS.order, async (c) => {
    if (deps.orderDetails === undefined) return respond(err(internal('Order details are unavailable')));
    return respond(
      await getOrder(
        { identity: c.get('identity') },
        c.req.param('orderId'),
        { orders: deps.orderDetails, invoices: deps.invoices },
      ),
    );
  });

  app.post(API_PATHS.invoiceIssue, async (c) => {
    if (deps.orderDetails === undefined) return respond(err(internal('Order details are unavailable')));
    const result = await requestInvoice(
      { identity: c.get('identity') },
      c.req.param('orderId'),
      {
        invoices: deps.invoices,
        invoicing: deps.invoicing,
        orderDetails: deps.orderDetails,
        tenants: deps.tenants,
        tenantSecrets: deps.tenantSecrets,
        secretCrypto: deps.secretCrypto,
        ids: deps.ids,
        clock: deps.clock,
        ...(deps.ksef === undefined ? {} : { ksef: deps.ksef }),
      },
    );
    if (result.ok && result.value.provider === 'ksef' && deps.ksef !== undefined) {
      dispatchKsefInBackground(deps.ksef, deps.logger, 'invoice issue');
    }
    return respond(result.ok ? ok({ invoice: result.value }) : result);
  });

  app.post(API_PATHS.invoiceRefresh, async (c) => {
    if (deps.orderDetails === undefined) return respond(err(internal('Order details are unavailable')));
    const result = await refreshInvoiceStatus(
      { identity: c.get('identity') },
      c.req.param('invoiceId'),
      {
        invoices: deps.invoices,
        invoicing: deps.invoicing,
        orderDetails: deps.orderDetails,
        tenants: deps.tenants,
        tenantSecrets: deps.tenantSecrets,
        secretCrypto: deps.secretCrypto,
        ids: deps.ids,
        clock: deps.clock,
        ...(deps.ksef === undefined ? {} : { ksef: deps.ksef }),
      },
    );
    return respond(result.ok ? ok({ invoice: result.value }) : result);
  });

  app.get(API_PATHS.invoiceDownload, async (c) => {
    if (deps.orderDetails === undefined) return respond(err(internal('Order details are unavailable')));
    const result = await downloadInvoice(
      { identity: c.get('identity') },
      c.req.param('invoiceId'),
      {
        invoices: deps.invoices,
        invoicing: deps.invoicing,
        orderDetails: deps.orderDetails,
        tenants: deps.tenants,
        tenantSecrets: deps.tenantSecrets,
        secretCrypto: deps.secretCrypto,
        ids: deps.ids,
        clock: deps.clock,
        ...(deps.ksef === undefined ? {} : { ksef: deps.ksef }),
      },
    );
    if (!result.ok) return respond(result);
    const content = Uint8Array.from(result.value.content);
    return new Response(content.buffer, {
      headers: {
        'content-type': result.value.contentType,
        'content-disposition': `attachment; filename="${result.value.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  });

  app.get(API_PATHS.invoiceUpoDownload, async (c) => {
    const result = await downloadInvoiceUpo(
      { identity: c.get('identity') },
      c.req.param('invoiceId'),
      {
        invoices: deps.invoices,
        ...(deps.ksef === undefined ? {} : { ksef: deps.ksef }),
      },
    );
    if (!result.ok) return respond(result);
    const content = Uint8Array.from(result.value.content);
    return new Response(content.buffer, {
      headers: {
        'content-type': result.value.contentType,
        'content-disposition': `attachment; filename="${result.value.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  });

  app.get(API_PATHS.memberInvoiceDownload, async (c) => {
    if (deps.orderDetails === undefined) return respond(err(internal('Order details are unavailable')));
    const result = await downloadMemberInvoice(
      { identity: c.get('identity') },
      c.req.param('invoiceId'),
      {
        invoices: deps.invoices,
        invoicing: deps.invoicing,
        orderDetails: deps.orderDetails,
        tenants: deps.tenants,
        tenantSecrets: deps.tenantSecrets,
        secretCrypto: deps.secretCrypto,
        ids: deps.ids,
        clock: deps.clock,
        ...(deps.ksef === undefined ? {} : { ksef: deps.ksef }),
      },
    );
    if (!result.ok) return respond(result);
    const content = Uint8Array.from(result.value.content);
    return new Response(content.buffer, {
      headers: {
        'content-type': result.value.contentType,
        'content-disposition': `attachment; filename="${result.value.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  });

  app.get(API_PATHS.salesSummary, async (c) => {
    const result = await getSalesSummary({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ summary: result.value }) : result);
  });

  app.get(API_PATHS.couponStatsExport, async (c) => {
    if (deps.couponStats === undefined) return respond(err(internal('Coupon statistics are unavailable')));
    const parsed = couponStatsExportQuerySchema.safeParse({
      format: c.req.query('format'),
      ...(c.req.query('partnerLabel') === undefined
        ? {}
        : { partnerLabel: c.req.query('partnerLabel') }),
      ...(c.req.query('since') === undefined ? {} : { since: c.req.query('since') }),
      ...(c.req.query('through') === undefined ? {} : { through: c.req.query('through') }),
    });
    if (!parsed.success) return respond(err(validation('Invalid coupon export query', parsed.error.flatten())));
    return respond(
      await exportCouponStats(
        { identity: c.get('identity') },
        {
          format: parsed.data.format,
          ...(parsed.data.partnerLabel === undefined
            ? {}
            : { partnerLabel: parsed.data.partnerLabel }),
          ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }),
          ...(parsed.data.through === undefined ? {} : { through: parsed.data.through }),
        },
        { stats: deps.couponStats, clock: deps.clock },
      ),
    );
  });

  app.post(API_PATHS.couponArchive, async (c) => {
    if (deps.coupons === undefined) return respond(err(internal('Coupon management is unavailable')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = couponArchiveRequestSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid coupon archive payload', parsed.error.flatten())));
    return respond(
      await archiveCoupon(
        { identity: c.get('identity') },
        parsed.data,
        { coupons: deps.coupons, ids: deps.ids, clock: deps.clock },
      ),
    );
  });

  app.get(API_PATHS.couponOptions, async (c) => {
    if (deps.couponStats === undefined) return respond(err(internal('Coupon options are unavailable')));
    return respond(
      await listCouponOptions(
        { identity: c.get('identity') },
        { stats: deps.couponStats },
      ),
    );
  });

  app.get(API_PATHS.couponStats, async (c) => {
    if (deps.couponStats === undefined) return respond(err(internal('Coupon statistics are unavailable')));
    const parsed = couponStatsQuerySchema.safeParse({
      ...(c.req.query('partnerLabel') === undefined
        ? {}
        : { partnerLabel: c.req.query('partnerLabel') }),
      ...(c.req.query('cursorCreatedAt') === undefined
        ? {}
        : { cursorCreatedAt: c.req.query('cursorCreatedAt') }),
      ...(c.req.query('cursorId') === undefined ? {} : { cursorId: c.req.query('cursorId') }),
      ...(c.req.query('limit') === undefined ? {} : { limit: c.req.query('limit') }),
      ...(c.req.query('since') === undefined ? {} : { since: c.req.query('since') }),
      ...(c.req.query('through') === undefined ? {} : { through: c.req.query('through') }),
    });
    if (!parsed.success) return respond(err(validation('Invalid coupon statistics query', parsed.error.flatten())));
    return respond(
      await listCouponStats(
        { identity: c.get('identity') },
        {
          ...(parsed.data.partnerLabel === undefined ? {} : { partnerLabel: parsed.data.partnerLabel }),
          ...(parsed.data.cursorCreatedAt === undefined || parsed.data.cursorId === undefined
            ? {}
            : { cursor: { createdAt: parsed.data.cursorCreatedAt, id: parsed.data.cursorId } }),
          ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
          ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }),
          ...(parsed.data.through === undefined ? {} : { through: parsed.data.through }),
        },
        { stats: deps.couponStats, clock: deps.clock },
      ),
    );
  });

  app.post(API_PATHS.couponsCreate, async (c) => {
    if (deps.coupons === undefined) return respond(err(internal('Coupon management is unavailable')));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = couponCreateRequestSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid coupon payload', parsed.error.flatten())));
    return respond(
      await createCoupon(
        { identity: c.get('identity') },
        parsed.data,
        { coupons: deps.coupons, ids: deps.ids, clock: deps.clock },
      ),
    );
  });

  app.get(API_PATHS.couponStatsDetail, async (c) => {
    if (deps.couponStats === undefined) return respond(err(internal('Coupon statistics are unavailable')));
    return respond(
      await getCouponStats(
        { identity: c.get('identity') },
        c.req.param('couponId'),
        { stats: deps.couponStats, clock: deps.clock },
      ),
    );
  });

  app.get(API_PATHS.courses, async (c) => {
    const result = await listCourses({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ courses: result.value }) : result);
  });

  app.post(API_PATHS.courses, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = courseCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid course payload', parsed.error.flatten())));
    const result = await createCourse({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ course: result.value }) : result);
  });

  app.post(API_PATHS.coursesUpdate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = courseUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid course update payload', parsed.error.flatten())));
    const result = await updateCourse({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ course: result.value }) : result);
  });

  app.get(API_PATHS.coursesHistoryVersion, async (c) => {
    const id = c.req.query('id');
    if (id === undefined) return respond(err(validation('Missing "id" query parameter')));
    const result = await getContentVersion({ identity: c.get('identity') }, id, deps);
    return respond(result.ok ? ok({ version: result.value }) : result);
  });

  app.get(API_PATHS.coursesHistory, async (c) => {
    const query = {
      courseId: c.req.query('courseId'),
      ...(c.req.query('limit') === undefined ? {} : { limit: c.req.query('limit') }),
    };
    const result = await getContentHistory({ identity: c.get('identity') }, query, deps);
    return respond(result.ok ? ok({ versions: result.value }) : result);
  });

  app.get(API_PATHS.modules, async (c) => {
    const result = await listModules({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ modules: result.value }) : result);
  });

  app.post(API_PATHS.modulesCreate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = moduleCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid module payload', parsed.error.flatten())));
    const result = await createModule({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ module: result.value }) : result);
  });

  app.post(API_PATHS.modulesUpdate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = moduleUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid module update payload', parsed.error.flatten())));
    const result = await updateModule({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ module: result.value }) : result);
  });

  app.post(API_PATHS.modulesAttach, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = moduleAttachInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid module attach payload', parsed.error.flatten())));
    const result = await attachModuleToCourse({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ module: result.value }) : result);
  });

  app.post(API_PATHS.modulesDetach, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = moduleDetachInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid module detach payload', parsed.error.flatten())));
    const result = await detachModuleFromCourse({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ module: result.value }) : result);
  });

  app.get(API_PATHS.lessons, async (c) => {
    const result = await listLessons({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ lessons: result.value }) : result);
  });

  app.post(API_PATHS.lessonsCreate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = lessonCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid lesson payload', parsed.error.flatten())));
    const result = await createLesson({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ lesson: result.value }) : result);
  });

  app.post(API_PATHS.lessonsUpdate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = lessonUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid lesson update payload', parsed.error.flatten())));
    const result = await updateLesson({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ lesson: result.value }) : result);
  });

  app.get(API_PATHS.lessonReferences, async (c) => {
    const id = c.req.query('id');
    if (id === undefined) return respond(err(validation('Missing "id" query parameter')));
    const result = await listLessonReferences({ identity: c.get('identity') }, { id }, deps);
    return respond(result.ok ? ok({ references: result.value }) : result);
  });

  app.delete(API_PATHS.lessonsDelete, async (c) => {
    const result = await deleteLesson({ identity: c.get('identity') }, { id: c.req.param('lessonId') }, deps);
    return respond(result.ok ? ok({ references: result.value }) : result);
  });

  app.get(API_PATHS.lessonAttachments, async (c) => {
    const result = await listLessonAttachments(
      { identity: c.get('identity') },
      c.req.param('lessonId'),
      deps,
    );
    return respond(result.ok
      ? ok({ attachments: result.value.map(lessonAttachmentView) })
      : result);
  });

  app.post(API_PATHS.lessonAttachmentUpload, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = lessonAttachmentUploadRequestSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid attachment payload', parsed.error.flatten())));
    const result = await beginLessonAttachmentUpload(
      { identity: c.get('identity') },
      c.req.param('lessonId'),
      parsed.data,
      deps,
    );
    return respond(result.ok
      ? ok({
          attachment: lessonAttachmentMetadata(result.value.attachment),
          upload: {
            url: result.value.uploadUrl,
            headers: { 'content-type': result.value.attachment.contentType },
            expiresAt: result.value.expiresAt,
          },
        })
      : result);
  });

  app.post(API_PATHS.lessonAttachmentComplete, async (c) => {
    const result = await completeLessonAttachmentUpload(
      { identity: c.get('identity') },
      c.req.param('lessonId'),
      c.req.param('attachmentId'),
      deps,
    );
    return respond(result.ok ? ok({ attachment: lessonAttachmentView(result.value) }) : result);
  });

  app.delete(API_PATHS.lessonAttachmentDelete, async (c) => {
    return respond(await deleteLessonAttachment(
      { identity: c.get('identity') },
      c.req.param('lessonId'),
      c.req.param('attachmentId'),
      deps,
    ));
  });

  app.get(API_PATHS.studentCourses, async (c) => {
    const result = await listMyCourses({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ courses: result.value }) : result);
  });

  app.get(API_PATHS.studentCourseStructure, async (c) => {
    const result = await getCourseStructureWithAccess(
      { identity: c.get('identity') },
      c.req.param('courseId'),
      deps,
    );
    return respond(result.ok ? ok({ structure: result.value }) : result);
  });

  app.get(API_PATHS.studentLessonAttachments, async (c) => {
    const result = await listMemberLessonAttachments(
      { identity: c.get('identity') },
      c.req.param('lessonId'),
      deps,
    );
    return respond(result.ok
      ? ok({ attachments: result.value.map(lessonAttachmentView) })
      : result);
  });

  app.get(API_PATHS.studentLessonAttachmentDownload, async (c) => {
    const result = await getLessonAttachmentDownload(
      { identity: c.get('identity') },
      c.req.param('lessonId'),
      c.req.param('attachmentId'),
      deps,
    );
    if (!result.ok) return respond(result);
    c.header('Cache-Control', 'no-store');
    return c.redirect(result.value, 302);
  });

  app.get(API_PATHS.studentLessonPlayback, async (c) => {
    const result = await getLessonPlayback(
      { identity: c.get('identity') },
      c.req.param('lessonId'),
      deps,
    );
    if (!result.ok) return respond(result);
    c.header('Cache-Control', 'no-store');
    return respond(ok(studentLessonPlaybackOutputSchema.parse(result.value)));
  });

  app.post(API_PATHS.studentLessonComplete, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = lessonCompleteInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid lesson completion payload', parsed.error.flatten())));
    const result = await markLessonCompleted({ identity: c.get('identity') }, parsed.data.lessonId, deps);
    return respond(result.ok ? ok({ progress: toProgressView(result.value) }) : result);
  });

  app.post(API_PATHS.studentLessonUncomplete, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = lessonUncompleteInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid lesson un-completion payload', parsed.error.flatten())));
    const result = await unmarkLessonCompleted({ identity: c.get('identity') }, parsed.data.lessonId, deps);
    return respond(result.ok ? ok({ progress: toProgressView(result.value) }) : result);
  });

  app.post(API_PATHS.studentLastViewed, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = lastViewedInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid last-viewed payload', parsed.error.flatten())));
    const result = await updateLastViewed({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ progress: toProgressView(result.value) }) : result);
  });

  app.get(API_PATHS.studentLessonNext, async (c) => {
    const lessonId = c.req.query('lessonId');
    if (lessonId === undefined) return respond(err(validation('Missing "lessonId" query parameter')));
    const result = await getNextLesson({ identity: c.get('identity') }, lessonId, deps);
    return respond(result.ok ? ok({ next: result.value }) : result);
  });

  app.get(API_PATHS.studentProgress, async (c) => {
    const courseId = c.req.query('courseId');
    if (courseId === undefined) return respond(err(validation('Missing "courseId" query parameter')));
    const result = await getProgress({ identity: c.get('identity') }, courseId, deps);
    return respond(result.ok ? ok({ progress: result.value }) : result);
  });

  app.post(API_PATHS.postsCreate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = postCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid post payload', parsed.error.flatten())));
    const result = await createPost({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ post: result.value }) : result);
  });

  app.post(API_PATHS.supportMessage, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = supportMessageInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid support message', parsed.error.flatten())));
    }
    return respond(await sendSupportMessage({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.post(API_PATHS.postsPin, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = postPinInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid post pin payload', parsed.error.flatten())));
    }
    const result = await setPostPinned({ identity: c.get('identity') }, parsed.data, deps);
    return respond(
      result.ok
        ? ok({ post: toPublicPost(result.value, c.get('identity').userId) })
        : result,
    );
  });

  app.post(API_PATHS.postsReport, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = postReportInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid report payload', parsed.error.flatten())));
    const result = await reportPost({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ report: result.value }) : result);
  });

  app.get(API_PATHS.reports, async (c) => {
    const parsed = reportsListInputSchema.safeParse({
      status: c.req.query('status'),
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
    });
    if (!parsed.success) return respond(err(validation('Invalid reports query', parsed.error.flatten())));
    const result = await listReports({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok(result.value) : result);
  });

  app.post(API_PATHS.reportResolve, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = reportResolveInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid report resolution', parsed.error.flatten())));
    const result = await resolveReport({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ report: result.value }) : result);
  });

  app.post(API_PATHS.postsUpdate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = postUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid post update payload', parsed.error.flatten())));
    const result = await editPost({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ post: result.value }) : result);
  });

  app.delete(API_PATHS.postsDelete, async (c) => {
    const parsed = postDeleteInputSchema.safeParse({ id: c.req.param('postId') });
    if (!parsed.success) return respond(err(validation('Invalid post id', parsed.error.flatten())));
    const result = await deletePost({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ post: result.value }) : result);
  });

  app.get(API_PATHS.discussion, async (c) => {
    const parsed = discussionGetInputSchema.safeParse({
      contextKind: c.req.query('contextKind'),
      contextId: c.req.query('contextId'),
      cursor: c.req.query('cursor'),
      ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }),
    });
    if (!parsed.success) return respond(err(validation('Invalid discussion query', parsed.error.flatten())));
    const result = await listDiscussion({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ discussion: result.value }) : result);
  });

  app.post(API_PATHS.threadSubscribe, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const result = await subscribeThread({ identity: c.get('identity') }, body, deps);
    return respond(result);
  });

  app.post(API_PATHS.threadMute, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const result = await muteThread({ identity: c.get('identity') }, body, deps);
    return respond(result);
  });

  app.get(API_PATHS.postsSearch, async (c) => {
    const parsed = postsSearchInputSchema.safeParse({
      query: c.req.query('query'),
      lessonIds: c.req.queries('lessonId'),
      ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }),
    });
    if (!parsed.success) return respond(err(validation('Invalid post search query', parsed.error.flatten())));
    const result = await searchPosts({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ hits: result.value }) : result);
  });

  app.post(API_PATHS.postsReact, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = postReactInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid reaction payload', parsed.error.flatten())));
    return respond(await reactToPost({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.post(API_PATHS.postsUnreact, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = postReactInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid reaction payload', parsed.error.flatten())));
    return respond(await unreactToPost({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.get(API_PATHS.spaces, async (c) => {
    const result = await listSpacesForMember({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ spaces: result.value }) : result);
  });

  app.get(API_PATHS.spacesStaff, async (c) => {
    const result = await listSpacesForStaff({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ spaces: result.value }) : result);
  });

  app.post(API_PATHS.spacesArchive, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = spaceArchiveInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid space archive payload', parsed.error.flatten())));
    const result = await setSpaceArchived({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ space: result.value }) : result);
  });

  app.post(API_PATHS.spaces, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = spaceCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid space payload', parsed.error.flatten())));
    const result = await createSpace({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ space: result.value }) : result);
  });

  app.post(API_PATHS.spacesUpdate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = spaceUpdateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid space update payload', parsed.error.flatten())));
    const result = await updateSpace({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ space: result.value }) : result);
  });

  app.delete(API_PATHS.spacesDelete, async (c) => {
    const parsed = spaceDeleteInputSchema.safeParse({ id: c.req.param('spaceId') });
    if (!parsed.success) return respond(err(validation('Invalid space id', parsed.error.flatten())));
    return respond(await deleteSpace({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.get(API_PATHS.spaceFeed, async (c) => {
    const parsed = spaceFeedGetInputSchema.safeParse({
      spaceId: c.req.param('spaceId'),
      cursor: c.req.query('cursor'),
      ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }),
    });
    if (!parsed.success) return respond(err(validation('Invalid space feed query', parsed.error.flatten())));
    const result = await getSpaceFeed({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ feed: result.value }) : result);
  });

  app.post(API_PATHS.spaceFollow, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = spaceFollowInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid space follow payload', parsed.error.flatten())));
    return respond(await followSpace({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.post(API_PATHS.spaceUnfollow, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = spaceFollowInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid space follow payload', parsed.error.flatten())));
    return respond(await unfollowSpace({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.get(API_PATHS.notifications, async (c) => {
    const parsed = notificationsListInputSchema.safeParse({
      cursor: c.req.query('cursor'),
      ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }),
    });
    if (!parsed.success) return respond(err(validation('Invalid notifications query', parsed.error.flatten())));
    return respond(await listNotifications({ identity: c.get('identity') }, parsed.data, deps));
  });

  app.post(API_PATHS.notificationRead, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = notificationReadInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid notification payload', parsed.error.flatten())));
    const result = await markNotificationRead({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ notification: result.value }) : result);
  });

  app.post(API_PATHS.notificationsReadAll, async (c) =>
    respond(await markAllNotificationsRead({ identity: c.get('identity') }, deps)),
  );

  app.get(API_PATHS.notificationsUnread, async (c) =>
    respond(await unreadNotificationCount({ identity: c.get('identity') }, deps)),
  );

  app.get(API_PATHS.notificationsStream, (c) => {
    const identity = c.get('identity');
    const tenant = authorizeTenant({ identity }, 'notification:read');
    if (!tenant.ok) return respond(tenant);
    const stream = createNotificationEventStream({
      tenantId: tenant.value,
      recipientUserId: identity.userId,
      bus: deps.realtimeBus,
      unreadCount: () => deps.notifications.unreadCount(tenant.value, identity.userId),
    });
    return new Response(stream, { headers: SSE_HEADERS });
  });

};
