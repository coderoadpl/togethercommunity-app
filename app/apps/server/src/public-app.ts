import { type Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';

import {
  BETTER_AUTH_API_PATH_PATTERN,
  BETTER_AUTH_EMAIL_VERIFICATION_PATH,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
  BETTER_AUTH_SIGN_UP_PATH,
} from '#adapters/auth/create-auth.js';
import {
  API_PATHS,
  checkoutSessionRequestSchema,
  couponCheckoutValidationRequestSchema,
  courseStructureOutputSchema,
  discussionOutputSchema,
  publicNavigationOutputSchema,
  publicOfferOutputSchema,
  spaceFeedOutputSchema,
  studentLessonOutputSchema,
  STRIPE_WEBHOOK_PATH_PATTERN,
  TENANT_HEADER
} from '#core/contract/index.js';
import {
  capabilitiesForPrincipal,
  err,
  internal,
  languageSchema,
  MAGIC_LINK_LANGUAGE_HEADER,
  ok,
  tenantNotFound,
  unauthorized,
  unavailable,
  validation,
  type EmailBranding,
  type Identity,
  type Result,
  type AppError
} from '#core/domain/index.js';
import {
  enforceTermsConsent,
  fulfillStripeWebhook,
  getPaymentConfig,
  getPlayableLesson,
  getPublicCourseStructure,
  getPublicImageAssetUrl,
  getPublicNavigation,
  getPublicOffer,
  getPublicSpaceFeed,
  getPublicSpaceThread,
  recordCheckoutMarketingConsents,
  resolveIdentity,
  resolveTenant,
  startCheckoutSession,
  validateCheckoutSelection,
  validateCouponForCheckout,
  validateTermsConsent,
  type PaymentWebhookEvent,
  type TenantSource
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { trustedAuthRequest } from './auth-network.js';
import { registerManifestRoute } from './manifest.js';
import { registerPublicMarketingRoutes } from './marketing-routes.js';
import {
  PUBLIC_REVALIDATED_CACHE_CONTROL,
  respond,
  respondNotModified,
} from './respond.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string; }; };

const registerOpenCors = (
  app: Hono<Vars>,
  path: string,
  method: 'GET' | 'POST',
  excludedPath?: string,
): void => {
  app.options(path, async (c, next) => {
    if (c.req.path === excludedPath) {
      await next();
      return c.res;
    }
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': `${method}, OPTIONS`,
        'access-control-allow-headers': `${TENANT_HEADER}, content-type, if-none-match`,
        'access-control-max-age': '60',
      },
    });
  });
  const middleware = cors({
    origin: '*',
    allowMethods: [method],
    allowHeaders: [TENANT_HEADER, 'content-type', 'if-none-match'],
    maxAge: 60,
  });
  app.use(path, async (c, next) => {
    if (c.req.path === excludedPath) {
      await next();
      return;
    }
    return middleware(c, next);
  });
};

const publicHeaders = (etag?: string): Headers => {
  const headers = new Headers({
    vary: `Host, ${TENANT_HEADER}`,
  });
  if (etag) headers.set('etag', etag);
  return headers;
};

const respondPublic = <T>(result: Result<T, AppError>, etag?: string): Response => {
  return respond(result, {
    cacheControl: etag === undefined ? 'no-store' : PUBLIC_REVALIDATED_CACHE_CONTROL,
    headers: publicHeaders(etag),
  });
};

/**
 * Sessions live in per-domain cookie worlds, so tenant-host requests must
 * verify on the same host. Only X-Tenant and hostless internal flows use the
 * configured base URL.
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
  return settings === null ? undefined : {
    logoUrl: settings.logoUrl,
    accentColor: settings.accentColor,
    socialLinks: settings.socialLinks,
  };
};

const magicLinkRequestBodySchema = z.object({ email: z.string().email() });

const anonymousIdentity = (
  actor: 'Checkout' | 'Preview',
  tenant: { id: string; slug: string; name: string; },
): Identity => ({
  userId: actor.toLowerCase(),
  email: `${actor.toLowerCase()}@invalid.test`,
  name: actor,
  emailVerified: true,
  tenantId: tenant.id,
  tenantSlug: tenant.slug,
  tenantName: tenant.name,
  staffRole: null,
  memberId: null,
  memberDisplayName: null,
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
      { identity: anonymousIdentity('Checkout', input.tenant) },
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
  tenant: { id: string; slug: string; name: string; },
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

export const registerPublicRoutes = (app: Hono<Vars>, deps: AppDeps): void => {
  const attestation = { version: deps.appVersion, sha: deps.commitSha };

  registerManifestRoute(app, deps);

  app.get(API_PATHS.healthLive, () =>
    respond(ok({ status: 'ok' as const, ...attestation })),
  );

  app.get(API_PATHS.healthReady, async () =>
    respond(
      (await deps.health.pingDatabase())
        ? ok({ status: 'ok' as const, database: 'up' as const, ...attestation })
        : err(unavailable('Database is not reachable')),
    ),
  );

  app.get(API_PATHS.health, async () =>
    respond(
      ok({
        status: 'ok' as const,
        ...attestation,
        database: (await deps.health.pingDatabase()) ? ('up' as const) : ('down' as const),
        ...deps.deploymentIdentity,
        ...(await deps.health.schemaStatus()),
      }),
    ),
  );

  registerOpenCors(app, API_PATHS.publicOffer, 'GET');
  registerOpenCors(app, API_PATHS.publicNavigation, 'GET');
  registerOpenCors(app, API_PATHS.publicCourseStructure, 'GET');
  registerOpenCors(app, API_PATHS.publicSpaceFeed, 'GET');
  registerOpenCors(app, API_PATHS.publicSpaceThread, 'GET');
  registerOpenCors(app, API_PATHS.studentLesson, 'GET', API_PATHS.studentLessonNext);
  registerOpenCors(app, API_PATHS.publicPaymentConfig, 'GET');
  registerOpenCors(app, API_PATHS.couponCheckoutValidation, 'POST');
  registerOpenCors(app, API_PATHS.checkoutSession, 'POST');
  registerOpenCors(app, API_PATHS.authConfig, 'GET');

  app.get(API_PATHS.publicImageAsset, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));
    const result = await getPublicImageAssetUrl(
      tenant.value.tenant.id,
      { kind: c.req.param('kind'), file: c.req.param('file') },
      deps,
    );
    if (!result.ok) return respondPublic(result);
    return new Response(null, {
      status: 302,
      headers: {
        location: result.value,
        'cache-control': 'public, max-age=300',
      },
    });
  });

  app.get(API_PATHS.publicOffer, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));

    const etag = `W/"offer-${tenant.value.tenant.id}-${tenant.value.tenant.contentVersion}"`;
    if (c.req.header('if-none-match') === etag) {
      return respondNotModified(publicHeaders(etag));
    }

    const result = await getPublicOffer(tenant.value.tenant, {
      courses: deps.courses,
      products: deps.products,
      lessons: deps.lessons,
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

  app.get(API_PATHS.publicNavigation, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));

    const etag = `W/"pubnav-${tenant.value.tenant.id}-${tenant.value.tenant.contentVersion}"`;
    if (c.req.header('if-none-match') === etag) {
      return respondNotModified(publicHeaders(etag));
    }

    const result = await getPublicNavigation(tenant.value.tenant, deps);
    if (!result.ok) return respondPublic(result, etag);
    const parsed = publicNavigationOutputSchema.safeParse({ navigation: result.value });
    if (!parsed.success) {
      return respondPublic(err(internal('Public navigation response does not match the contract')), etag);
    }
    return respondPublic(ok(parsed.data), etag);
  });

  app.get(API_PATHS.publicCourseStructure, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));

    const courseId = c.req.param('courseId');
    const etag = `W/"pubcourse-${tenant.value.tenant.id}-${courseId}-${tenant.value.tenant.contentVersion}"`;
    if (c.req.header('if-none-match') === etag) {
      return respondNotModified(publicHeaders(etag));
    }

    const result = await getPublicCourseStructure(tenant.value.tenant, courseId, deps);
    if (!result.ok) return respondPublic(result, etag);
    const parsed = courseStructureOutputSchema.safeParse({ structure: result.value });
    if (!parsed.success) {
      return respondPublic(err(internal('Public course structure response does not match the contract')), etag);
    }
    return respondPublic(ok(parsed.data), etag);
  });

  app.get(API_PATHS.publicSpaceFeed, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));

    const limit = c.req.query('limit');
    const result = await getPublicSpaceFeed(
      tenant.value.tenant,
      {
        spaceId: c.req.param('spaceId'),
        cursor: c.req.query('cursor'),
        ...(limit === undefined ? {} : { limit: Number(limit) }),
      },
      deps,
    );
    if (!result.ok) return respondPublic(result);
    const parsed = spaceFeedOutputSchema.safeParse({ feed: result.value });
    return parsed.success
      ? respondPublic(ok(parsed.data))
      : respondPublic(err(internal('Public space feed response does not match the contract')));
  });

  app.get(API_PATHS.publicSpaceThread, async (c) => {
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));

    const result = await getPublicSpaceThread(
      tenant.value.tenant,
      { spaceId: c.req.param('spaceId'), postId: c.req.param('postId') },
      deps,
    );
    if (!result.ok) return respondPublic(result);
    const parsed = discussionOutputSchema.safeParse({ discussion: result.value });
    return parsed.success
      ? respondPublic(ok(parsed.data))
      : respondPublic(err(internal('Public space thread response does not match the contract')));
  });

  app.get(API_PATHS.studentLesson, async (c, next) => {
    if (c.req.path === API_PATHS.studentLessonNext) {
      await next();
      return;
    }
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respondPublic(tenant);
    if (!tenant.value) return respondPublic(err(tenantNotFound()));

    const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
    const identity = await resolveIdentity(
      user,
      { host: c.req.header('host') ?? '', tenantHeader: c.req.header(TENANT_HEADER) ?? null },
      deps,
    );
    let authenticated = false;
    let ctx: Parameters<typeof getPlayableLesson>[0] = {
      identity: anonymousIdentity('Preview', tenant.value.tenant),
      capabilities: capabilitiesForPrincipal('public'),
    };
    if (user !== null) {
      if (!identity.ok) {
        if (identity.error.code === 'internal' || identity.error.code === 'unavailable') {
          return respondPublic(identity);
        }
      } else {
        authenticated = true;
        ctx = { identity: identity.value };
      }
    }
    const result = await getPlayableLesson(ctx, c.req.param('lessonId'), deps);
    if (!result.ok) {
      return respondPublic(user === null && result.error.code === 'forbidden'
        ? err(unauthorized())
        : result);
    }
    const parsed = studentLessonOutputSchema.safeParse({ lesson: result.value, authenticated });
    return parsed.success
      ? respondPublic(ok(parsed.data))
      : respondPublic(err(internal('Preview lesson response does not match the contract')));
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
    }
    return respondPublic(session);
  });

  app.get(API_PATHS.authConfig, async () =>
    respondPublic(
      ok({
        googleEnabled: deps.authConfig.googleEnabled,
        passkeysEnabled: true,
        totpEnabled: true,
        exposeMagicLinks: deps.devEndpoints.exposeMagicLinks,
      }),
    ),
  );

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
    return deps.auth.handler(trustedAuthRequest(
      c,
      new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: rawBody }),
      deps.authTrustedProxyHeader,
    ));
  });

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
    return deps.auth.handler(trustedAuthRequest(
      c,
      new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: rawBody }),
      deps.authTrustedProxyHeader,
    ));
  });

  app.on('POST', [BETTER_AUTH_SIGN_UP_PATH, BETTER_AUTH_EMAIL_VERIFICATION_PATH], async (c) => {
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
      deps.auth.setEmailVerificationDeliveryContext(parsedBody.data.email, {
        language: headerLanguage.success ? headerLanguage.data : 'pl',
        baseUrl: magicLinkBaseUrl(host, forwardedProto, source, deps.appBaseUrl),
      });
    }
    return deps.auth.handler(trustedAuthRequest(
      c,
      new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: rawBody }),
      deps.authTrustedProxyHeader,
    ));
  });

  app.on(['GET', 'POST'], BETTER_AUTH_API_PATH_PATTERN, (c) =>
    deps.auth.handler(trustedAuthRequest(c, c.req.raw, deps.authTrustedProxyHeader)),
  );

  registerPublicMarketingRoutes(app, deps);

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
    }
    return respond(fulfilled.ok ? ok({ received: true as const, processed: fulfilled.value.processed }) : fulfilled);
  });

};
