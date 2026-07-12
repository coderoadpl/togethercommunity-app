import { Hono } from 'hono';

import {
  API_PATHS,
  HTTP_STATUS_BY_ERROR_CODE,
  TENANT_HEADER,
  memberRemoveInputSchema,
  publicOfferOutputSchema,
  productsCreateInputSchema,
  productsPublishInputSchema,
  simulatePurchaseInputSchema,
  tenantCreateInputSchema,
  toEnvelope,
} from '@core/contract/index.js';
import {
  err,
  internal,
  memberExportFormatSchema,
  ok,
  tenantNotFound,
  unauthorized,
  validation,
  type AppError,
  type Identity,
  type Result,
} from '@core/domain/index.js';
import {
  createProduct,
  createTenant,
  exportMembers,
  getPublicOffer,
  listMembers,
  listMyProducts,
  listMyTenants,
  listProducts,
  publishProduct,
  removeMember,
  resolveIdentity,
  resolveTenant,
  simulatePurchase,
  type AuthenticatedUser,
} from '@core/server/index.js';
import { BETTER_AUTH_API_PATH_PATTERN } from '@adapters/auth/create-auth.js';

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

const issueMagicLink = async (deps: AppDeps, email: string) => {
  await deps.authPort.requestMagicLink({ email, callbackURL: deps.appBaseUrl });
  return deps.devMagicLinks.findByEmail(email);
};

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

      const magicLink = deps.devEndpoints.exposeMagicLinks
        ? await issueMagicLink(deps, parsed.data.email)
        : null;
      return respond(ok({ ...result.value, magicLink }));
    });

    app.get(API_PATHS.devMagicLink, async (c) => {
      const email = c.req.query('email');
      if (!email) return respond(err(validation('Missing "email" query parameter')));
      return respond(ok({ magicLink: await deps.devMagicLinks.findByEmail(email) }));
    });
  }

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

  app.delete(API_PATHS.memberRemove, async (c) => {
    const parsed = memberRemoveInputSchema.safeParse({ memberId: c.req.param('memberId') });
    if (!parsed.success) return respond(err(validation('Invalid member id', parsed.error.flatten())));
    return respond(await removeMember({ identity: c.get('identity') }, parsed.data, deps));
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

  return app;
};
