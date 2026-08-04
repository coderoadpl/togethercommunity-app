import type { Hono } from 'hono';

import {
  API_PATHS,
  m2mImportValidateRequestSchema,
  m2mImportWriteRequestSchema,
} from '#core/contract/index.js';
import {
  apiKeyHasCapability,
  err,
  forbidden,
  validation,
  type AppError,
  type Identity,
  type Result,
} from '#core/domain/index.js';
import {
  claimM2mImportRateLimit,
  importM2mContent,
  importM2mUsers,
  validateM2mImport,
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { authenticateMarketingApiKey } from './marketing-routes.js';
import { respond } from './respond.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string } };

const readJson = async (request: Request): Promise<unknown> => request.json().catch(() => null);

const retryHeaders = <T>(result: Result<T, AppError>): HeadersInit | undefined => {
  if (result.ok || result.error.code !== 'rate_limited') return undefined;
  if (typeof result.error.details !== 'object' || result.error.details === null) return undefined;
  const seconds = Reflect.get(result.error.details, 'retryAfterSeconds');
  return typeof seconds === 'number' ? { 'retry-after': String(seconds) } : undefined;
};

export const registerM2mImportRoutes = (app: Hono<Vars>, deps: AppDeps): void => {
  app.post(API_PATHS.m2mImportValidate, async (c) => {
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return respond(authenticated);
    if (
      !apiKeyHasCapability(authenticated.value.apiKey, 'import:content-write')
      && !apiKeyHasCapability(authenticated.value.apiKey, 'import:users-write')
    ) {
      return respond(err(forbidden('An import scope is required')));
    }
    const parsed = m2mImportValidateRequestSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      return respond(err(validation('Invalid import validation request', parsed.error.flatten())));
    }
    const limited = await claimM2mImportRateLimit(
      authenticated.value.tenant.id,
      authenticated.value.apiKey,
      { mode: 'validate' },
      { rateLimits: deps.apiKeyRateLimits, clock: deps.clock },
    );
    if (!limited.ok) {
      const headers = retryHeaders(limited);
      return respond(limited, headers === undefined ? {} : { headers });
    }
    return respond(await validateM2mImport(authenticated.value.ctx, parsed.data, {
      courses: deps.courses,
      modules: deps.modules,
      lessons: deps.lessons,
      products: deps.products,
      importAuditEvents: deps.importAuditEvents,
      importUsers: deps.importUsersReader,
      hash: deps.contentHash,
      clock: deps.clock,
    }));
  });

  const writeRoute = (
    path: string,
    kind: 'course' | 'module' | 'lesson' | 'product',
  ): void => {
    app.post(path, async (c) => {
      const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
      if (!authenticated.ok) return respond(authenticated);
      if (!apiKeyHasCapability(authenticated.value.apiKey, 'import:content-write')) {
        return respond(err(forbidden('import:content-write is not permitted')));
      }
      const parsed = m2mImportWriteRequestSchema.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid import batch', parsed.error.flatten())));
      const limited = await claimM2mImportRateLimit(
        authenticated.value.tenant.id,
        authenticated.value.apiKey,
        { mode: 'content', recordCount: parsed.data.records.length },
        { rateLimits: deps.apiKeyRateLimits, clock: deps.clock },
      );
      if (!limited.ok) {
        const responseHeaders = retryHeaders(limited);
        return respond(limited, responseHeaders === undefined ? {} : { headers: responseHeaders });
      }
      return respond(await importM2mContent(
        authenticated.value.ctx,
        authenticated.value.apiKey,
        kind,
        parsed.data,
        {
          courses: deps.courses,
          modules: deps.modules,
          lessons: deps.lessons,
          products: deps.products,
          importAuditEvents: deps.importAuditEvents,
          importContent: deps.importContent,
          ids: deps.ids,
          clock: deps.clock,
          hash: deps.contentHash,
        },
      ));
    });
  };

  writeRoute(API_PATHS.m2mImportCourses, 'course');
  writeRoute(API_PATHS.m2mImportModules, 'module');
  writeRoute(API_PATHS.m2mImportLessons, 'lesson');
  writeRoute(API_PATHS.m2mImportProducts, 'product');

  const writeUsersRoute = (
    path: string,
    kind: 'member' | 'grant' | 'progress',
  ): void => {
    app.post(path, async (c) => {
      const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
      if (!authenticated.ok) return respond(authenticated);
      if (!apiKeyHasCapability(authenticated.value.apiKey, 'import:users-write')) {
        return respond(err(forbidden('import:users-write is not permitted')));
      }
      const parsed = m2mImportWriteRequestSchema.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return respond(err(validation('Invalid import batch', parsed.error.flatten())));
      const limited = await claimM2mImportRateLimit(
        authenticated.value.tenant.id,
        authenticated.value.apiKey,
        { mode: 'users', kind, recordCount: parsed.data.records.length },
        { rateLimits: deps.apiKeyRateLimits, clock: deps.clock },
      );
      if (!limited.ok) {
        const responseHeaders = retryHeaders(limited);
        return respond(limited, responseHeaders === undefined ? {} : { headers: responseHeaders });
      }
      return respond(await importM2mUsers(
        authenticated.value.ctx,
        authenticated.value.apiKey,
        kind,
        parsed.data,
        {
          courses: deps.courses,
          modules: deps.modules,
          lessons: deps.lessons,
          products: deps.products,
          importAuditEvents: deps.importAuditEvents,
          importUsers: deps.importUsers,
          ids: deps.ids,
          clock: deps.clock,
          hash: deps.contentHash,
        },
      ));
    });
  };

  writeUsersRoute(API_PATHS.m2mImportMembers, 'member');
  writeUsersRoute(API_PATHS.m2mImportGrants, 'grant');
  writeUsersRoute(API_PATHS.m2mImportProgress, 'progress');
};
