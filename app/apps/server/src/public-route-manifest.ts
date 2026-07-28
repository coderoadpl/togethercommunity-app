import type { RouterRoute } from 'hono/types';

import {
  BETTER_AUTH_API_PATH_PATTERN,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
} from '#adapters/auth/create-auth.js';

export type PublicRouteManifestEntry = {
  path: string;
  methods: readonly string[];
  mutating: boolean;
  why: string;
};

export const PUBLIC_ROUTE_MANIFEST: readonly PublicRouteManifestEntry[] = [
  { path: '/api/health', methods: ['GET'], mutating: false, why: 'Runtime health check' },
  { path: '/api/health/live', methods: ['GET'], mutating: false, why: 'Process liveness check' },
  { path: '/api/health/ready', methods: ['GET'], mutating: false, why: 'Database readiness check' },
  { path: '/api/public/offer', methods: ['GET', 'OPTIONS'], mutating: false, why: 'Public offer discovery' },
  { path: '/api/public/payment-config', methods: ['GET'], mutating: false, why: 'Checkout capability discovery' },
  { path: '/api/public/checkout/coupon', methods: ['POST'], mutating: false, why: 'Read-only coupon validation' },
  { path: '/api/public/checkout/session', methods: ['POST'], mutating: true, why: 'Checkout session start' },
  { path: '/api/public/auth-config', methods: ['GET'], mutating: false, why: 'Login capability discovery' },
  { path: BETTER_AUTH_MAGIC_LINK_PATH, methods: ['POST'], mutating: true, why: 'Login, recovery, and magic-link authentication surface' },
  { path: BETTER_AUTH_PASSWORD_RESET_PATH, methods: ['POST'], mutating: true, why: 'Login, recovery, and magic-link authentication surface' },
  { path: BETTER_AUTH_API_PATH_PATTERN, methods: ['GET'], mutating: false, why: 'Authentication callbacks and session reads' },
  { path: BETTER_AUTH_API_PATH_PATTERN, methods: ['POST'], mutating: true, why: 'Login, recovery, and magic-link authentication surface' },
  { path: '/api/webhooks/stripe/:tenantId', methods: ['POST'], mutating: true, why: 'Stripe payment webhook' },
  { path: '/api/webhooks/ses/:webhookToken', methods: ['POST'], mutating: true, why: 'Amazon SNS delivery webhook' },
  { path: '/u/:token', methods: ['GET'], mutating: false, why: 'Unsubscribe preference page' },
  { path: '/u/:token', methods: ['POST'], mutating: true, why: 'Unsubscribe preference changes' },
  { path: '/u/:token/confirm', methods: ['POST'], mutating: true, why: 'Unsubscribe preference changes' },
  { path: '/u/:token/all', methods: ['POST'], mutating: true, why: 'Unsubscribe preference changes' },
  { path: '/u/:token/preferences', methods: ['POST'], mutating: true, why: 'Unsubscribe preference changes' },
  { path: '/marketing/confirm/:token', methods: ['GET'], mutating: false, why: 'Double opt-in confirmation page' },
  { path: '/marketing/confirm/:token', methods: ['POST'], mutating: true, why: 'Double opt-in confirmation' },
  { path: '/legal/:slug', methods: ['GET'], mutating: false, why: 'Latest public legal document' },
  { path: '/legal/:slug/v/:version', methods: ['GET'], mutating: false, why: 'Versioned public legal document' },
] as const;

export const publicRouteManifestEntry = (
  route: Pick<RouterRoute, 'method' | 'path'>,
  manifest: readonly PublicRouteManifestEntry[] = PUBLIC_ROUTE_MANIFEST,
): PublicRouteManifestEntry | undefined =>
  manifest.find((entry) =>
    entry.methods.includes(route.method) && entry.path === route.path,
  );

export const assertPublicRouteManifest = (
  routes: readonly RouterRoute[],
  manifest: readonly PublicRouteManifestEntry[],
): void => {
  const missing = routes
    .filter((route) => route.method !== 'ALL')
    .filter((route) =>
      publicRouteManifestEntry(route, manifest) === undefined,
    );
  if (missing.length === 0) return;
  throw new Error(
    `Public routes missing from manifest: ${missing.map((route) => `${route.method} ${route.path}`).join(', ')}`,
  );
};
