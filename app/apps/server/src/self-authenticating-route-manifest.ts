import type { RouterRoute } from 'hono/types';

import { API_PATHS } from '#core/contract/index.js';

type SelfAuthenticatingRouteManifestEntry = {
  path: string;
  methods: readonly string[];
  mechanism: string;
};

export const SELF_AUTHENTICATING_ROUTE_MANIFEST: readonly SelfAuthenticatingRouteManifestEntry[] = [
  { path: API_PATHS.emailDispatch, methods: ['GET', 'POST'], mechanism: 'E-mail dispatch secret' },
  { path: API_PATHS.ksefDispatch, methods: ['GET', 'POST'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.globalSchedulerRuns, methods: ['GET'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.globalSchedulerRun, methods: ['GET'], mechanism: 'Scheduler operator secret' },
  { path: API_PATHS.termsConsent, methods: ['POST'], mechanism: 'Authenticated user session before tenant grant' },
  { path: API_PATHS.tenants, methods: ['POST'], mechanism: 'Authenticated user session before tenant grant' },
  { path: API_PATHS.devSimulatePurchase, methods: ['POST'], mechanism: 'Development-only composition flag' },
  { path: API_PATHS.devMagicLink, methods: ['GET'], mechanism: 'Development-only composition flag' },
  { path: API_PATHS.devEmail, methods: ['GET'], mechanism: 'Development-only composition flag' },
  { path: API_PATHS.devGrant, methods: ['POST'], mechanism: 'Development-only composition flag' },
  { path: API_PATHS.devSubscriptionSimulateCycle, methods: ['POST'], mechanism: 'Development-only composition flag' },
  { path: API_PATHS.devSubscriptionSimulateFailure, methods: ['POST'], mechanism: 'Development-only composition flag' },
  { path: API_PATHS.m2mEnroll, methods: ['POST'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/messages', methods: ['GET', 'POST'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/messages/:id', methods: ['GET'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/eligibility', methods: ['GET'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/consents', methods: ['POST'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/suppressions', methods: ['GET', 'POST'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/consent-definitions', methods: ['GET'], mechanism: 'Tenant API key' },
  { path: '/api/m2m/marketing/templates', methods: ['GET'], mechanism: 'Tenant API key' },
  { path: '/api/internal/marketing/tick', methods: ['GET', 'POST'], mechanism: 'Scheduler operator secret' },
] as const;

export const selfAuthenticatingRouteManifestEntry = (
  route: Pick<RouterRoute, 'method' | 'path'>,
  manifest: readonly SelfAuthenticatingRouteManifestEntry[] = SELF_AUTHENTICATING_ROUTE_MANIFEST,
): SelfAuthenticatingRouteManifestEntry | undefined =>
  manifest.find((entry) => entry.path === route.path && entry.methods.includes(route.method));

export const assertSelfAuthenticatingRouteManifest = (
  routes: readonly RouterRoute[],
  manifest: readonly SelfAuthenticatingRouteManifestEntry[],
): void => {
  const missing = routes
    .filter((route) => route.method !== 'ALL')
    .filter((route) => selfAuthenticatingRouteManifestEntry(route, manifest) === undefined);
  if (missing.length === 0) return;
  throw new Error(
    `Pre-identity routes missing from self-authenticating manifest: ${missing.map((route) => `${route.method} ${route.path}`).join(', ')}`,
  );
};
