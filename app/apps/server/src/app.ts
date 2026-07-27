import { Hono } from 'hono';
import { z } from 'zod';

import {
  API_KEY_HEADER,
  EMAIL_DISPATCH_SECRET_HEADER,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  API_PATHS,
  HTTP_STATUS_BY_ERROR_CODE,
  TENANT_HEADER,
  apiKeyCreateInputSchema,
  apiKeyRevokeInputSchema,
  bunnyVideosInputSchema,
  courseCreateInputSchema,
  checkoutSessionRequestSchema,
  couponCheckoutValidationRequestSchema,
  couponArchiveRequestSchema,
  couponCreateRequestSchema,
  couponStatsExportQuerySchema,
  couponStatsQuerySchema,
  emailSendsExportQuerySchema,
  emailSendsQuerySchema,
  schedulerRunsQuerySchema,
  marketingCampaignCreateInputSchema,
  marketingCampaignActionInputSchema,
  marketingCampaignScheduleInputSchema,
  marketingCampaignUpdateInputSchema,
  marketingAudiencePreviewInputSchema,
  marketingConsentDefinitionCreateInputSchema,
  marketingConsentDefinitionUpdateInputSchema,
  marketingDocumentCreateInputSchema,
  marketingDocumentPublishInputSchema,
  marketingDocumentUpdateInputSchema,
  marketingLayoutSaveInputSchema,
  marketingSesIdentityStartInputSchema,
  marketingSesSettingsUpdateInputSchema,
  courseUpdateInputSchema,
  grantCreateInputSchema,
  grantRevokeInputSchema,
  lessonCompleteInputSchema,
  lessonCreateInputSchema,
  lessonUncompleteInputSchema,
  lessonUpdateInputSchema,
  lastViewedInputSchema,
  memberProgressResetInputSchema,
  memberRemoveInputSchema,
  memberBillingOrdersQuerySchema,
  m2mEnrollRequestSchema,
  marketingSuppressionCreateInputSchema,
  moduleAttachInputSchema,
  moduleDetachInputSchema,
  moduleCreateInputSchema,
  moduleUpdateInputSchema,
  notificationReadInputSchema,
  notificationsListInputSchema,
  productPriceCreateInputSchema,
  productPriceDeactivateInputSchema,
  ordersExportQuerySchema,
  subscriptionSimulateInputSchema,
  discussionGetInputSchema,
  postCreateInputSchema,
  postDeleteInputSchema,
  postReactInputSchema,
  postUpdateInputSchema,
  postsSearchInputSchema,
  spaceArchiveInputSchema,
  spaceCreateInputSchema,
  spaceDeleteInputSchema,
  spaceFeedGetInputSchema,
  spaceFollowInputSchema,
  spaceUpdateInputSchema,
  productsAccessItemsInputSchema,
  publicOfferOutputSchema,
  productsCreateInputSchema,
  productsPublishInputSchema,
  simulatePurchaseInputSchema,
  STRIPE_WEBHOOK_PATH_PATTERN,
  tenantCreateInputSchema,
  tenantSecretDeleteInputSchema,
  tenantSecretSetInputSchema,
  tenantSettingsUpdateInputSchema,
  termsConsentRequestSchema,
  toEnvelope,
} from '@core/contract/index.js';
import {
  devGrantInputSchema,
  err,
  forbidden,
  internal,
  languageSchema,
  MAGIC_LINK_LANGUAGE_HEADER,
  memberExportFormatSchema,
  ok,
  tenantNotFound,
  unauthorized,
  validation,
  type AppError,
  type EmailBranding,
  type Identity,
  type MemberCourseProgress,
  type ProgressView,
  type Result,
} from '@core/domain/index.js';
import {
  addManualSuppression,
  attachModuleToCourse,
  detachModuleFromCourse,
  authenticateApiKey,
  createCourse,
  createCampaign,
  createMarketingConsentDefinition,
  createTenantDocument,
  createLesson,
  createModule,
  createProduct,
  createTenant,
  createTenantApiKey,
  deleteLesson,
  deleteTenantSecret,
  listLessonReferences,
  getCampaignWithEngagement,
  getMarketingConsentDefinition,
  getTenantDocument,
  getTenantSesMarketingSettings,
  pollSesOnboarding,
  provisionSesInfrastructure,
  sendSesSimulatorTest,
  startSesIdentityVerification,
  getEmailReputation,
  getContentHistory,
  getContentVersion,
  devGrantProduct,
  exportMembers,
  exportEmailSends,
  exportOrders,
  exportCouponStats,
  createCoupon,
  archiveCoupon,
  getCouponStats,
  listCouponOptions,
  getOrder,
  requestInvoice,
  refreshInvoiceStatus,
  downloadInvoice,
  downloadInvoiceUpo,
  downloadMemberInvoice,
  getEmailSend,
  listTenantApiKeys,
  listCampaignsWithEngagement,
  listMarketingConsentDefinitions,
  listTenantDocuments,
  listEmailLayouts,
  listEmailSends,
  getGlobalSchedulerRun,
  getSchedulerRunForTenant,
  listGlobalSchedulerRuns,
  listSchedulerRunsForTenant,
  listMemberEmailSends,
  listMemberBillingOrders,
  sendTransactionalSmtpTest,
  m2mEnroll,
  revokeTenantApiKey,
  getCourseStructureWithAccess,
  getMemberLearningSummary,
  getNextLesson,
  getProgress,
  getPlayableLesson,
  getPublicOffer,
  getPaymentConfig,
  startCheckoutSession,
  getTenantSecretsMasked,
  getTenantSettings,
  updateTenantSettings,
  enforceTermsConsent,
  validateTermsConsent,
  getCreatorOnboarding,
  dismissCreatorOnboarding,
  grantProductToMember,
  createPost,
  deletePost,
  editPost,
  listDiscussion,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  muteThread,
  searchPosts,
  subscribeThread,
  unreadNotificationCount,
  createSpace,
  updateSpace,
  deleteSpace,
  setSpaceArchived,
  listSpacesForMember,
  listSpacesForStaff,
  getSpaceFeed,
  followSpace,
  unfollowSpace,
  reactToPost,
  unreactToPost,
  createProductPrice,
  deactivateProductPrice,
  getSalesSummary,
  listCourses,
  listLessons,
  listMemberGrants,
  listMembers,
  listModules,
  listMyCourses,
  listMyProducts,
  listOrders,
  listCouponStats,
  listProductPrices,
  simulateSubscriptionCycle,
  simulateSubscriptionFailure,
  listProductAccessIssues,
  listMyTenants,
  listProducts,
  markLessonCompleted,
  publishProduct,
  removeMember,
  resetMemberCourseProgress,
  resolveIdentity,
  revokeGrant,
  resolveTenant,
  setTenantSecret,
  scheduleCampaign,
  saveEmailLayout,
  saveTenantDocumentDraft,
  publishTenantDocument,
  previewMarketingAudience,
  updateMarketingCampaign,
  updateMarketingConsentDefinition,
  updateTenantSesMarketingSettings,
  pauseCampaign,
  cancelCampaign,
  recordCheckoutMarketingConsents,
  testSendCampaignToSelf,
  simulatePurchase,
  validateCheckoutSelection,
  validateCouponForCheckout,
  listBunnyVideos,
  testBunnyConnection,
  testIfirmaConnection,
  testKsefConnection,
  testStripeConnection,
  fulfillStripeWebhook,
  autoIssueOnPayment,
  unmarkLessonCompleted,
  updateCourse,
  updateLastViewed,
  updateLesson,
  updateModule,
  updateProductAccessItems,
  type AuthenticatedUser,
  type PaymentWebhookEvent,
  type SimulatePurchaseResult,
  type TenantSource,
} from '@core/server/index.js';
import {
  BETTER_AUTH_API_PATH_PATTERN,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
} from '@adapters/auth/create-auth.js';

import type { AppDeps } from './composition.js';
import { createNotificationEventStream, SSE_HEADERS } from './notifications-sse.js';
import { recordAppError, recordException, telemetryMiddleware } from './telemetry.js';
import { registerMarketingRoutes } from './marketing-routes.js';

type Vars = { Variables: { identity: Identity } };

const respond = <T>(result: Result<T, AppError>): Response => {
  const envelope = toEnvelope(result);
  if (!envelope.ok) recordAppError(envelope.error);
  const status = envelope.ok ? 200 : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { 'content-type': 'application/json' },
  });
};

const publicOkHeaders = (etag?: string): Headers => {
  const headers = new Headers({
    'access-control-allow-origin': '*',
    'cache-control': 'public, no-cache',
    vary: `Host, ${TENANT_HEADER}`,
  });
  if (etag) headers.set('etag', etag);
  return headers;
};

const publicErrorHeaders = (): Headers =>
  new Headers({
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    vary: `Host, ${TENANT_HEADER}`,
  });

const respondPublic = <T>(result: Result<T, AppError>, etag?: string): Response => {
  const envelope = toEnvelope(result);
  if (!envelope.ok) recordAppError(envelope.error);
  const status = envelope.ok ? 200 : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
  const headers = envelope.ok ? publicOkHeaders(etag) : publicErrorHeaders();
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(envelope), { status, headers });
};

/**
 * The base URL the magic-link verify page must live on. Sessions are per-domain
 * cookie worlds (ADR-0002), so a link requested from a tenant subdomain or custom
 * domain must verify on that same host; only the X-Tenant header flow (and hostless
 * server-internal calls) fall back to APP_BASE_URL.
 */
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
  return settings === null ? undefined : { logoUrl: settings.logoUrl, accentColor: settings.accentColor };
};

const issueMagicLink = async (
  deps: AppDeps,
  input: { email: string; tenantId: string; tenantName: string; language: string; baseUrl: string },
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

const magicLinkRequestBodySchema = z.object({ email: z.string().email() });

const toProgressView = (progress: MemberCourseProgress): ProgressView => ({
  courseId: progress.courseId,
  completedLessonIds: progress.completedLessonIds,
  lastViewedLessonId: progress.lastViewedLessonId,
  lastViewedModuleId: progress.lastViewedModuleId,
  lastViewedChapterId: progress.lastViewedChapterId,
});

const tenantlessIdentity = (user: AuthenticatedUser): Identity => ({
  userId: user.userId,
  email: user.email,
  name: user.name,
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
});

const checkoutIdentity = (tenant: { id: string; slug: string; name: string }): Identity => ({
  userId: 'checkout',
  email: 'checkout@invalid.test',
  name: 'Checkout',
  tenantId: tenant.id,
  tenantSlug: tenant.slug,
  tenantName: tenant.name,
  staffRole: null,
  memberId: null,
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
    tenant: { id: string; slug: string; name: string };
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

const recordFulfilledCheckoutConsents = async (
  deps: AppDeps,
  tenant: { id: string; slug: string; name: string },
  event: PaymentWebhookEvent,
): Promise<void> => {
  const checkout = event.checkoutSession;
  const captureId = checkout?.metadata.checkoutConsentCaptureId;
  if (checkout === null || captureId === undefined || captureId === null) return;
  const capture = await deps.checkoutConsentCaptures.findById(tenant.id, captureId);
  if (capture === null) {
    deps.logger.error(
      `[checkout-consent] tenant=${tenant.id} capture=${captureId} missing`,
    );
    return;
  }
  const email = checkout.email ?? checkout.metadata.memberEmail;
  const terms = await enforceTermsConsent(
    tenant.id,
    {
      accepted: capture.termsAccepted,
      userId: null,
      email,
      source: 'checkout',
    },
    deps,
  );
  if (!terms.ok) {
    deps.logger.error(`[checkout-consent] tenant=${tenant.id} terms=${terms.error.code}:${terms.error.message}`);
  }
  if (event.objectId === null || checkout.metadata.productId === null) return;
  const order = await deps.paymentRefunds.findOrderByProviderObjectIds(
    tenant.id,
    { checkoutSession: event.objectId },
  );
  if (order === null) {
    deps.logger.error(`[checkout-consent] tenant=${tenant.id} checkout=${event.objectId} order=missing`);
    return;
  }
  await recordCheckoutConsents(deps, {
    tenant,
    email: email ?? undefined,
    selectedDefinitionIds: capture.selectedDefinitionIds,
    attachedDefinitionIds: capture.attachedDefinitionIds,
    productId: checkout.metadata.productId,
    orderId: order.id,
    collectedAt: capture.collectedAt,
    confirmationBaseUrl: capture.confirmationBaseUrl,
    ...(capture.ip === undefined ? {} : { ip: capture.ip }),
    ...(capture.userAgent === undefined ? {} : { userAgent: capture.userAgent }),
  });
};

const autoIssueFulfilledOrder = async (
  deps: AppDeps,
  tenantId: string,
  event: PaymentWebhookEvent,
): Promise<void> => {
  if (event.objectId === null || deps.orderDetails === undefined) return;
  const providerObjectIds = event.type === 'invoice.paid'
    ? { invoice: event.objectId }
    : { checkoutSession: event.objectId };
  const order = await deps.paymentRefunds.findOrderByProviderObjectIds(tenantId, providerObjectIds);
  if (order === null) return;
  try {
    await autoIssueOnPayment(tenantId, order, {
      invoices: deps.invoices,
      invoicing: deps.invoicing,
      orderDetails: deps.orderDetails,
      tenants: deps.tenants,
      tenantSecrets: deps.tenantSecrets,
      secretCrypto: deps.secretCrypto,
      ids: deps.ids,
      clock: deps.clock,
      ...(deps.ksef === undefined ? {} : { ksef: deps.ksef }),
    });
    if (deps.ksef !== undefined) void deps.ksef.dispatch();
  } catch (cause) {
    deps.logger.error(`[invoice-auto] tenant=${tenantId} order=${order.id} unexpected=${String(cause)}`);
  }
};

export const buildApp = (deps: AppDeps) => {
  const app = new Hono<Vars>();

  app.use('*', telemetryMiddleware);

  app.onError((error) => {
    recordException(error);
    return respond(err(internal()));
  });

  app.get(API_PATHS.health, async () =>
    respond(
      ok({
        status: 'ok' as const,
        version: '0.1.0',
        database: (await deps.health.pingDatabase()) ? ('up' as const) : ('down' as const),
      }),
    ),
  );

  app.post(API_PATHS.emailDispatch, async (c) => {
    if (c.req.header(EMAIL_DISPATCH_SECRET_HEADER) !== deps.emailDispatchSecret) {
      return respond(err(unauthorized('Invalid email dispatch secret')));
    }
    return respond(await deps.dispatchEmails('manual'));
  });

  app.post(API_PATHS.ksefDispatch, async (c) => {
    if (deps.ksef === undefined) return respond(err(internal('KSeF is not configured')));
    if (c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER) !== deps.ksef.dispatchSecret) {
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

  app.options(API_PATHS.publicOffer, () =>
    new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': `${TENANT_HEADER}, if-none-match`,
        'access-control-max-age': '60',
      },
    }),
  );

  app.get(API_PATHS.publicOffer, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));

    const etag = `W/"offer-${tenant.value.tenant.id}-${tenant.value.tenant.contentVersion}"`;
    if (c.req.header('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: publicOkHeaders(etag) });
    }

    const result = await getPublicOffer(tenant.value.tenant, {
      products: deps.products,
      prices: deps.prices,
      tenants: deps.tenants,
      definitions: deps.marketing?.definitions,
      documents: deps.marketing?.documents,
    });
    if (!result.ok) return respondPublic(result, etag);
    const parsed = publicOfferOutputSchema.safeParse(result.value);
    if (!parsed.success) return respondPublic(err(internal('Public offer response does not match the contract')), etag);
    return respondPublic(ok(parsed.data), etag);
  });

  app.get(API_PATHS.publicPaymentConfig, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));
    const config = await getPaymentConfig(tenant.value.tenant.id, deps);
    return respondPublic(
      config.ok
        ? ok({ ...config.value, simulatedPaymentsEnabled: deps.devEndpoints.simulatedPayments })
        : config,
    );
  });

  app.post(API_PATHS.couponCheckoutValidation, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = couponCheckoutValidationRequestSchema.safeParse(body);
    if (!parsed.success) {
      return respondPublic(err(validation('Invalid coupon payload', parsed.error.flatten())));
    }
    const selection = await validateCheckoutSelection(tenant.value.tenant.id, parsed.data, deps);
    if (!selection.ok) return respondPublic(selection);
    if (
      deps.coupons === undefined ||
      deps.couponRedemptions === undefined ||
      deps.priceHistory === undefined
    ) {
      return respondPublic(err(internal('Coupon checkout is not configured')));
    }
    const price = selection.value.price;
    const result = await validateCouponForCheckout(
      tenant.value.tenant.id,
      {
        code: parsed.data.couponCode,
        ...(parsed.data.email === undefined ? {} : { email: parsed.data.email }),
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
    return respondPublic(
      result.ok
        ? ok({
            breakdown: result.value.breakdown,
            recurringDuration: result.value.coupon.recurringDuration,
          })
        : result,
    );
  });

  app.post(API_PATHS.checkoutSession, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = checkoutSessionRequestSchema.safeParse(body);
    if (!parsed.success) return respondPublic(err(validation('Invalid checkout payload', parsed.error.flatten())));
    if (parsed.data.couponCode === undefined) {
      const configured = await getPaymentConfig(tenant.value.tenant.id, deps);
      if (!configured.ok) return respondPublic(configured);
      if (!configured.value.stripeConfigured) {
        return respondPublic(err(validation('Stripe is not configured for this tenant')));
      }
    }
    const selection = await validateCheckoutSelection(tenant.value.tenant.id, parsed.data, deps);
    if (!selection.ok) return respondPublic(selection);
    const consent = await validateTermsConsent(
      tenant.value.tenant.id,
      parsed.data.termsAccepted,
      deps.tenants,
    );
    if (!consent.ok) return respondPublic(consent);
    const baseUrl = magicLinkBaseUrl(
      c.req.header('host') ?? '',
      c.req.header('x-forwarded-proto') ?? null,
      tenant.value.source,
      deps.appBaseUrl,
    );
    const checkoutConsent = {
      termsAccepted: parsed.data.termsAccepted === true,
      selectedDefinitionIds: parsed.data.marketingConsentDefinitionIds,
      attachedDefinitionIds: selection.value.product.checkoutConsentDefinitionIds ?? [],
      collectedAt: deps.clock.nowIso(),
      confirmationBaseUrl: `${baseUrl}/marketing/confirm`,
      ...(parsed.data.billing === undefined ? {} : { billing: parsed.data.billing }),
      ...checkoutConsentEvidence(c.req.raw.headers),
    };
    const checkoutConsentCaptureId = deps.ids.nextId();
    await deps.checkoutConsentCaptures.create(tenant.value.tenant.id, {
      id: checkoutConsentCaptureId,
      capture: checkoutConsent,
      createdAt: checkoutConsent.collectedAt,
    });
    const session = await startCheckoutSession(
      tenant.value.tenant,
      baseUrl,
      parsed.data,
      selection.value,
      deps,
      checkoutConsentCaptureId,
    );
    if (
      session.ok &&
      session.value.free &&
      session.value.couponCheckoutSessionId !== undefined
    ) {
      const objectId = `free_${session.value.couponCheckoutSessionId}`;
      const event: PaymentWebhookEvent = {
        id: `event_${objectId}`,
        type: 'checkout.session.completed',
        objectId,
        checkoutSession: {
          email: parsed.data.email ?? null,
          subscriptionId:
            selection.value.price?.kind === 'recurring' ? `subscription_${objectId}` : null,
          paymentIntentId: null,
          invoiceId: null,
          amountTotalCents: session.value.coupon?.finalCents ?? 0,
          discountTotalCents: session.value.coupon?.discountCents ?? 0,
          metadata: {
            tenantId: tenant.value.tenant.id,
            productId: selection.value.product.id,
            priceId: selection.value.price?.id ?? null,
            memberEmail: parsed.data.email ?? null,
            language: parsed.data.language ?? null,
            checkoutConsentCaptureId,
            couponCheckoutSessionId: session.value.couponCheckoutSessionId,
          },
        },
      };
      const fulfilled = await fulfillStripeWebhook(
        tenant.value.tenant,
        event,
        { ...deps, exposeMagicLinks: deps.devEndpoints.exposeMagicLinks },
        'simulated',
      );
      if (!fulfilled.ok) return respondPublic(fulfilled);
      await recordFulfilledCheckoutConsents(deps, tenant.value.tenant, event);
      await autoIssueFulfilledOrder(deps, tenant.value.tenant.id, event);
    }
    return respondPublic(session);
  });

  // Public path (not the authenticated /api/* block): a freshly registered
  // user has no member/staff grant yet, which resolveIdentity rejects.
  app.post(API_PATHS.termsConsent, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));
    const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
    if (!user) return respondPublic(err(unauthorized()));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = termsConsentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return respondPublic(err(validation('Invalid consent payload', parsed.error.flatten())));
    }
    return respondPublic(
      await enforceTermsConsent(
        tenant.value.tenant.id,
        { accepted: parsed.data.accepted, userId: user.userId, email: user.email, source: 'register' },
        deps,
      ),
    );
  });

  app.options(API_PATHS.authConfig, () =>
    new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-max-age': '60',
      },
    }),
  );

  app.get(API_PATHS.authConfig, () =>
    respondPublic(
      ok({
        googleEnabled: deps.authConfig.googleEnabled,
        passkeysEnabled: true,
        totpEnabled: true,
        exposeMagicLinks: deps.devEndpoints.exposeMagicLinks,
      }),
    ),
  );

  // Set the magic-link delivery context (tenant name, language, host) before Better
  // Auth generates the verify URL, so browser sign-ins land back on their own domain.
  app.post(BETTER_AUTH_MAGIC_LINK_PATH, async (c) => {
    const rawBody = await c.req.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
    const parsedBody = magicLinkRequestBodySchema.safeParse(payload);
    if (parsedBody.success) {
      const host = c.req.header('host') ?? '';
      const forwardedProto = c.req.header('x-forwarded-proto') ?? null;
      const tenant = await resolveTenant(host, c.req.header(TENANT_HEADER) ?? null, deps);
      const resolved = tenant.ok ? tenant.value : null;
      const source: TenantSource = resolved?.source ?? 'subdomain';
      const headerLanguage = languageSchema.safeParse(c.req.header(MAGIC_LINK_LANGUAGE_HEADER));
      const branding = resolved ? await emailBranding(deps, resolved.tenant.id) : undefined;
      deps.auth.setMagicLinkDeliveryContext(parsedBody.data.email, {
        ...(resolved ? { tenantName: resolved.tenant.name } : {}),
        language: headerLanguage.success ? headerLanguage.data : 'pl',
        mode: 'email',
        baseUrl: magicLinkBaseUrl(host, forwardedProto, source, deps.appBaseUrl),
        ...(branding === undefined ? {} : { branding }),
      });
    }
    return deps.auth.handler(
      new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: rawBody }),
    );
  });

  // Set the reset-password delivery context (language, host) before Better Auth
  // generates the token, so the emailed reset link lands on the requesting domain.
  app.post(BETTER_AUTH_PASSWORD_RESET_PATH, async (c) => {
    const rawBody = await c.req.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
    const parsedBody = magicLinkRequestBodySchema.safeParse(payload);
    if (parsedBody.success) {
      const host = c.req.header('host') ?? '';
      const forwardedProto = c.req.header('x-forwarded-proto') ?? null;
      const tenant = await resolveTenant(host, c.req.header(TENANT_HEADER) ?? null, deps);
      const source: TenantSource = tenant.ok && tenant.value ? tenant.value.source : 'subdomain';
      const headerLanguage = languageSchema.safeParse(c.req.header(MAGIC_LINK_LANGUAGE_HEADER));
      deps.auth.setResetPasswordDeliveryContext(parsedBody.data.email, {
        language: headerLanguage.success ? headerLanguage.data : 'pl',
        baseUrl: magicLinkBaseUrl(host, forwardedProto, source, deps.appBaseUrl),
      });
    }
    return deps.auth.handler(
      new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: rawBody }),
    );
  });

  app.on(['GET', 'POST'], BETTER_AUTH_API_PATH_PATTERN, (c) => deps.auth.handler(c.req.raw));

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

    const body: unknown = await c.req.json().catch(() => null);
    const parsed = m2mEnrollRequestSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid enrollment payload', parsed.error.flatten())));

    const result = await m2mEnroll(tenant.value.tenant, parsed.data, {
      ...deps,
      exposeMagicLinks: deps.devEndpoints.exposeMagicLinks,
    });
    return respond(result);
  });

  registerMarketingRoutes(app, deps);

  app.post(STRIPE_WEBHOOK_PATH_PATTERN, async (c) => {
    const tenantId = c.req.param('tenantId');
    const tenant = await deps.tenants.findById(tenantId);
    if (!tenant) return respond(err(tenantNotFound()));
    const webhookSecret = await deps.secretResolver.resolve(tenantId, 'stripe.webhookSecret');
    if (!webhookSecret.ok) return respond(webhookSecret);
    const payloadRaw = await c.req.text();
    const event = await deps.payment.verifyWebhookEvent({
      payloadRaw,
      signatureHeader: c.req.header('stripe-signature') ?? '',
      webhookSecret: webhookSecret.value,
    });
    if (!event.ok) return respond(event);
    const fulfilled = await fulfillStripeWebhook(tenant, event.value, {
      ...deps,
      exposeMagicLinks: deps.devEndpoints.exposeMagicLinks,
    });
    if (fulfilled.ok && fulfilled.value.processed) {
      await recordFulfilledCheckoutConsents(deps, tenant, event.value);
      queueMicrotask(() => {
        void autoIssueFulfilledOrder(deps, tenant.id, event.value);
      });
    }
    return respond(fulfilled.ok ? ok({ received: true as const, processed: fulfilled.value.processed }) : fulfilled);
  });

  // Everything below is tenant-aware: authenticate, resolve tenant, inject identity.
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

  app.post(API_PATHS.marketingSmtpTest, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    return respond(await sendTransactionalSmtpTest(
      { identity: c.get('identity') },
      { smtp: deps.marketing.smtpTest },
    ));
  });

  app.get(API_PATHS.marketingStaffSuppressions, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const identity = c.get('identity');
    const tenantId = identity.tenantId;
    if (tenantId === null || identity.staffRole === null) return respond(err(forbidden('Tenant staff access is required')));
    return respond(ok(await deps.marketing.suppressions.list(tenantId, { limit: 100 })));
  });

  app.get(API_PATHS.emailSendsExport, async (c) => {
    if (deps.marketing === undefined) return respond(err(internal('Marketing e-mail is not configured')));
    const parsed = emailSendsExportQuerySchema.safeParse({
      format: c.req.query('format'),
      ...(c.req.query('kind') === undefined ? {} : { kind: c.req.query('kind') }),
      ...(c.req.query('status') === undefined ? {} : { status: c.req.query('status') }),
      ...(c.req.query('deliveryStatus') === undefined ? {} : { deliveryStatus: c.req.query('deliveryStatus') }),
      ...(c.req.query('campaignId') === undefined ? {} : { campaignId: c.req.query('campaignId') }),
      ...(c.req.query('runId') === undefined ? {} : { runId: c.req.query('runId') }),
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
      ...(c.req.query('campaignId') === undefined ? {} : { campaignId: c.req.query('campaignId') }),
      ...(c.req.query('runId') === undefined ? {} : { runId: c.req.query('runId') }),
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

  app.get(API_PATHS.tenants, async (c) => {
    const result = await listMyTenants({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ tenants: result.value }) : result);
  });

  app.get(API_PATHS.products, async (c) => {
    const result = await listProducts({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ products: result.value }) : result);
  });

  app.get(API_PATHS.myProducts, async (c) => {
    const result = await listMyProducts({ identity: c.get('identity') }, deps);
    return respond(
      result.ok
        ? ok({
            products: result.value.map((product) => ({
              id: product.id,
              title: product.title,
              description: product.description,
              priceCents: product.priceCents,
              currency: product.currency,
              grantStatus: product.grantStatus,
              grantStartsAt: product.grantStartsAt,
              grantExpiresAt: product.grantExpiresAt,
              subscription: product.subscription,
            })),
          })
        : result,
    );
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

  app.get(API_PATHS.memberGrants, async (c) => {
    const result = await listMemberGrants({ identity: c.get('identity') }, c.req.param('memberId'), deps);
    return respond(result.ok ? ok({ grants: result.value }) : result);
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

  app.get(API_PATHS.tenantSecrets, async (c) => {
    const result = await getTenantSecretsMasked({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ secrets: result.value }) : result);
  });

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

  app.post(API_PATHS.stripeTestConnection, async (c) => {
    const result = await testStripeConnection(
      { identity: c.get('identity') },
      { appBaseUrl: deps.appBaseUrl },
      deps.payment,
    );
    return respond(result);
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

  app.post(API_PATHS.productsPublish, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = productsPublishInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid publish payload', parsed.error.flatten())));
    }
    const result = await publishProduct({ identity: c.get('identity') }, parsed.data, deps);
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
      void deps.ksef.dispatch();
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

  app.get(API_PATHS.studentLesson, async (c) => {
    const result = await getPlayableLesson({ identity: c.get('identity') }, c.req.param('lessonId'), deps);
    return respond(result.ok ? ok({ lesson: result.value }) : result);
  });

  app.post(API_PATHS.postsCreate, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = postCreateInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid post payload', parsed.error.flatten())));
    const result = await createPost({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ post: result.value }) : result);
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
    const tenantId = identity.tenantId;
    if (tenantId === null) return respond(err(tenantNotFound('Select a tenant')));
    const stream = createNotificationEventStream({
      tenantId,
      recipientUserId: identity.userId,
      bus: deps.realtimeBus,
      unreadCount: () => deps.notifications.unreadCount(tenantId, identity.userId),
    });
    return new Response(stream, { headers: SSE_HEADERS });
  });

  return app;
};
