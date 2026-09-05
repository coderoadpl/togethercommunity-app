import type { RouterRoute } from 'hono/types';

import {
  BETTER_AUTH_API_PATH_PATTERN,
  BETTER_AUTH_EMAIL_VERIFICATION_PATH,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_RESET_PATH,
  BETTER_AUTH_SIGN_UP_PATH,
} from '#adapters/auth/create-auth.js';
import { API_PATHS } from '#core/contract/index.js';

import { LEGACY_COURSE_ROUTE } from './legacy-url-redirects.js';

export type PublicRouteManifestEntry = {
  path: string;
  methods: readonly string[];
  mutating: boolean;
  why: string;
};

export const PUBLIC_ROUTE_MANIFEST: readonly PublicRouteManifestEntry[] = [
  { path: '*', methods: ['GET'], mutating: false, why: 'Tenant social preview for link crawlers' },
  { path: '/manifest.webmanifest', methods: ['GET'], mutating: false, why: 'PWA web app manifest with tenant name' },
  { path: '/api/health', methods: ['GET'], mutating: false, why: 'Runtime health check' },
  { path: '/api/health/live', methods: ['GET'], mutating: false, why: 'Process liveness check' },
  { path: '/api/health/ready', methods: ['GET'], mutating: false, why: 'Database readiness check' },
  { path: '/api/public/offer', methods: ['GET', 'OPTIONS'], mutating: false, why: 'Public offer discovery' },
  { path: API_PATHS.publicNavigation, methods: ['GET', 'OPTIONS'], mutating: false, why: 'Anonymous tenant-home navigation' },
  { path: API_PATHS.publicCourseStructure, methods: ['GET', 'OPTIONS'], mutating: false, why: 'Public course program without lesson content' },
  { path: API_PATHS.publicSpaceFeed, methods: ['GET', 'OPTIONS'], mutating: false, why: 'Read-only feed of a publicly readable space' },
  { path: API_PATHS.publicSpaceThread, methods: ['GET', 'OPTIONS'], mutating: false, why: 'Read-only thread of a publicly readable space' },
  { path: API_PATHS.publicSpaceEvents, methods: ['GET', 'OPTIONS'], mutating: false, why: 'Read-only events of a publicly readable space' },
  { path: API_PATHS.publicSpaceEvent, methods: ['GET', 'OPTIONS'], mutating: false, why: 'Read-only event of a publicly readable space' },
  { path: API_PATHS.publicImageAsset, methods: ['GET'], mutating: false, why: 'Tenant image assets (covers, branding) redirected from private BYO storage' },
  { path: API_PATHS.studentLesson, methods: ['GET', 'OPTIONS'], mutating: false, why: 'Free lesson preview' },
  { path: '/api/public/payment-config', methods: ['GET', 'OPTIONS'], mutating: false, why: 'Checkout capability discovery' },
  { path: '/api/public/checkout/coupon', methods: ['POST', 'OPTIONS'], mutating: false, why: 'Read-only coupon validation' },
  { path: '/api/public/checkout/session', methods: ['OPTIONS'], mutating: false, why: 'Checkout session start preflight' },
  { path: '/api/public/checkout/session', methods: ['POST'], mutating: true, why: 'Checkout session start' },
  { path: '/api/public/auth-config', methods: ['GET', 'OPTIONS'], mutating: false, why: 'Login capability discovery' },
  { path: '/api/public/auth-resolve', methods: ['POST', 'OPTIONS'], mutating: false, why: 'Sign-in method discovery for a typed identifier' },
  { path: BETTER_AUTH_MAGIC_LINK_PATH, methods: ['POST'], mutating: true, why: 'Login, recovery, and magic-link authentication surface' },
  { path: BETTER_AUTH_PASSWORD_RESET_PATH, methods: ['POST'], mutating: true, why: 'Login, recovery, and magic-link authentication surface' },
  { path: BETTER_AUTH_SIGN_UP_PATH, methods: ['POST'], mutating: true, why: 'Login, recovery, and magic-link authentication surface' },
  { path: BETTER_AUTH_EMAIL_VERIFICATION_PATH, methods: ['POST'], mutating: true, why: 'Login, recovery, and magic-link authentication surface' },
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
  { path: LEGACY_COURSE_ROUTE, methods: ['GET'], mutating: false, why: 'Legacy course, module, chapter and lesson links redirected to their member pages' },
] as const;

export const publicRouteManifestEntry = (
  route: Pick<RouterRoute, 'method' | 'path'>,
  manifest: readonly PublicRouteManifestEntry[] = PUBLIC_ROUTE_MANIFEST,
): PublicRouteManifestEntry | undefined =>
  manifest.find((entry) =>
    entry.methods.includes(route.method)
    && entry.path === (route.path === '/*' ? '*' : route.path),
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
