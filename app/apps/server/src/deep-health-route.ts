import type { Hono } from 'hono';

import { API_PATHS } from '#core/contract/index.js';
import { ok, toPublicDeepHealthReport, type DeepHealthReport } from '#core/domain/index.js';
import { checkDeepHealth } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { respond } from './respond.js';

export const DEEP_HEALTH_CACHE_TTL_MS = 60_000;

const runDeepHealth = (deps: AppDeps): Promise<DeepHealthReport> =>
  checkDeepHealth({
    tenantDirectory: deps.tenantDirectory,
    tenants: deps.tenants,
    courses: deps.courses,
    modules: deps.modules,
    lessons: deps.lessons,
    products: deps.products,
    prices: deps.prices,
    tenantSecrets: deps.tenantSecrets,
    secretCrypto: deps.secretCrypto,
    secretResolver: deps.secretResolver,
    storage: deps.storage,
    emailTransports: deps.emailTransports,
    clock: deps.clock,
    schedulerRuns: deps.marketing?.runs,
    definitions: deps.marketing?.definitions,
    documents: deps.marketing?.documents,
  });

export const registerDeepHealthRoute = (app: Hono<AppVars>, deps: AppDeps): void => {
  let cached: { at: number; report: Promise<DeepHealthReport> } | null = null;

  app.get(API_PATHS.healthDeep, async () => {
    const now = Date.now();
    if (cached === null || now - cached.at >= DEEP_HEALTH_CACHE_TTL_MS) {
      cached = { at: now, report: runDeepHealth(deps) };
    }
    const entry = cached;
    const report = await entry.report.catch((cause: unknown) => {
      if (cached === entry) cached = null;
      throw cause;
    });
    return respond(ok(toPublicDeepHealthReport(report)), {
      successStatus: report.ok ? 200 : 500,
    });
  });
};
