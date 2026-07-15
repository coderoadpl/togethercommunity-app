import { Hono } from 'hono';
import { z } from 'zod';

import {
  API_KEY_HEADER,
  API_PATHS,
  HTTP_STATUS_BY_ERROR_CODE,
  TENANT_HEADER,
  apiKeyCreateInputSchema,
  apiKeyRevokeInputSchema,
  courseCreateInputSchema,
  checkoutSessionRequestSchema,
  courseUpdateInputSchema,
  grantCreateInputSchema,
  grantRevokeInputSchema,
  lessonCompleteInputSchema,
  lessonCreateInputSchema,
  lessonUpdateInputSchema,
  lastViewedInputSchema,
  memberRemoveInputSchema,
  m2mEnrollRequestSchema,
  moduleAttachInputSchema,
  moduleDetachInputSchema,
  moduleCreateInputSchema,
  moduleUpdateInputSchema,
  notificationReadInputSchema,
  notificationsListInputSchema,
  discussionGetInputSchema,
  postCreateInputSchema,
  postDeleteInputSchema,
  postUpdateInputSchema,
  postsSearchInputSchema,
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
  toEnvelope,
} from '@core/contract/index.js';
import {
  devGrantInputSchema,
  err,
  internal,
  languageSchema,
  MAGIC_LINK_LANGUAGE_HEADER,
  memberExportFormatSchema,
  ok,
  tenantNotFound,
  unauthorized,
  validation,
  type AppError,
  type Identity,
  type MemberCourseProgress,
  type ProgressView,
  type Result,
} from '@core/domain/index.js';
import {
  attachModuleToCourse,
  detachModuleFromCourse,
  authenticateApiKey,
  createCourse,
  createCheckoutSession,
  createLesson,
  createModule,
  createProduct,
  createTenant,
  createTenantApiKey,
  deleteLesson,
  deleteTenantSecret,
  listLessonReferences,
  getContentHistory,
  getContentVersion,
  devGrantProduct,
  exportMembers,
  listTenantApiKeys,
  m2mEnroll,
  revokeTenantApiKey,
  getAccessibleLesson,
  getCourseStructureWithAccess,
  getNextLesson,
  getProgress,
  getPublicOffer,
  getPaymentConfig,
  getTenantSecretsMasked,
  getTenantSettings,
  updateTenantSettings,
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
  listCourses,
  listLessons,
  listMemberGrants,
  listMembers,
  listModules,
  listMyCourses,
  listMyProducts,
  listProductAccessIssues,
  listMyTenants,
  listProducts,
  markLessonCompleted,
  publishProduct,
  removeMember,
  resolveIdentity,
  revokeGrant,
  resolveTenant,
  setTenantSecret,
  simulatePurchase,
  testStripeConnection,
  fulfillStripeWebhook,
  updateCourse,
  updateLastViewed,
  updateLesson,
  updateModule,
  updateProductAccessItems,
  type AuthenticatedUser,
  type TenantSource,
} from '@core/server/index.js';
import {
  BETTER_AUTH_API_PATH_PATTERN,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
} from '@adapters/auth/create-auth.js';

import type { AppDeps } from './composition.js';
import { recordAppError, recordException, telemetryMiddleware } from './telemetry.js';

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

const issueMagicLink = async (
  deps: AppDeps,
  input: { email: string; tenantName: string; language: string; baseUrl: string },
) => {
  await deps.authPort.requestMagicLink({
    email: input.email,
    callbackURL: input.baseUrl,
    tenantName: input.tenantName,
    language: input.language,
    baseUrl: input.baseUrl,
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

    const result = await getPublicOffer(tenant.value.tenant, deps);
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

  app.post(API_PATHS.checkoutSession, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = checkoutSessionRequestSchema.safeParse(body);
    if (!parsed.success) return respondPublic(err(validation('Invalid checkout payload', parsed.error.flatten())));
    const baseUrl = magicLinkBaseUrl(
      c.req.header('host') ?? '',
      c.req.header('x-forwarded-proto') ?? null,
      tenant.value.source,
      deps.appBaseUrl,
    );
    return respondPublic(await createCheckoutSession(tenant.value.tenant, baseUrl, parsed.data, deps));
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
      deps.auth.setMagicLinkDeliveryContext(parsedBody.data.email, {
        ...(resolved ? { tenantName: resolved.tenant.name } : {}),
        language: headerLanguage.success ? headerLanguage.data : 'pl',
        mode: 'email',
        baseUrl: magicLinkBaseUrl(host, forwardedProto, source, deps.appBaseUrl),
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

      const result = await simulatePurchase(tenant.value.tenant.id, parsed.data.email, parsed.data.productId, deps);
      if (!result.ok) return respond(result);

      const baseUrl = magicLinkBaseUrl(
        c.req.header('host') ?? '',
        c.req.header('x-forwarded-proto') ?? null,
        tenant.value.source,
        deps.appBaseUrl,
      );
      const issuedMagicLink = await issueMagicLink(deps, {
        email: parsed.data.email,
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

  app.get(API_PATHS.me, (c) => {
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

  app.post(API_PATHS.stripeTestConnection, async (c) => {
    const result = await testStripeConnection(
      { identity: c.get('identity') },
      { appBaseUrl: deps.appBaseUrl },
      deps.payment,
    );
    return respond(result);
  });

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
      entityKind: c.req.query('entityKind'),
      entityId: c.req.query('entityId'),
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
    const result = await getAccessibleLesson({ identity: c.get('identity') }, c.req.param('lessonId'), deps);
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

  return app;
};
