import type { Hono } from 'hono';
import { API_PATHS, activitySummaryQuerySchema, memberActivityQuerySchema } from '#core/contract/index.js';
import { err, validation } from '#core/domain/index.js';
import { authorizeTenant, claimApiKeyRateLimit, getActivitySummary, getMemberActivity } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { authenticateMarketingApiKey } from './marketing-routes.js';
import { respond } from './respond.js';

export const registerReportRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  for (const path of [API_PATHS.activitySummary, API_PATHS.memberActivity]) {
    app.get(path, async (c) => {
      const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
      if (!authenticated.ok) return respond(authenticated);
      const { ctx, apiKey } = authenticated.value;
      const tenant = authorizeTenant(ctx, 'report:read');
      if (!tenant.ok) return respond(tenant);
      const limited = await claimApiKeyRateLimit(apiKey.id, tenant.value, deps.clock.nowIso(), {
        rateLimits: deps.apiKeyRateLimits,
        limits: deps.m2mTransactionalRateLimits,
      });
      if (!limited.ok) {
        const seconds = Reflect.get(limited.error.details ?? {}, 'retryAfterSeconds');
        return respond(limited, { headers: typeof seconds === 'number' ? { 'retry-after': String(seconds) } : {} });
      }
      const query = Object.fromEntries(new URL(c.req.url).searchParams);
      if (path === API_PATHS.activitySummary) {
        const parsed = activitySummaryQuerySchema.safeParse(query);
        if (!parsed.success) return respond(err(validation('Invalid report range')));
        return respond(await getActivitySummary(ctx, parsed.data, deps));
      }
      const parsed = memberActivityQuerySchema.safeParse(query);
      if (!parsed.success) return respond(err(validation('Invalid member activity query')));
      return respond(await getMemberActivity(ctx, parsed.data, deps));
    });
  }
};
