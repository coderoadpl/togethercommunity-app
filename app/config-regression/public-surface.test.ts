import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  assertPublicRouteManifest,
  PUBLIC_ROUTE_MANIFEST,
} from '../apps/server/src/public-route-manifest.js';
import {
  assertSelfAuthenticatingRouteManifest,
  SELF_AUTHENTICATING_ROUTE_MANIFEST,
} from '../apps/server/src/self-authenticating-route-manifest.js';

const appRoot = join(import.meta.dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(appRoot, ...parts), 'utf8');
const publicApp = read('apps', 'server', 'src', 'public-app.ts');
const publicServerImports = publicApp
  .match(/import\s*\{([^}]*)\}\s*from '#core\/server\/index\.js';/)?.[1]
  ?.split(',')
  .map((name) => name.trim())
  .filter((name) => name !== '')
  .sort();

const APPROVED_PUBLIC_SERVER_IMPORTS = [
  'enforceTermsConsent',
  'fulfillStripeWebhook',
  'getPaymentConfig',
  'getPlayableLesson',
  'getPublicOffer',
  'recordCheckoutMarketingConsents',
  'resolveIdentity',
  'resolveTenant',
  'startCheckoutSession',
  'type PaymentWebhookEvent',
  'type TenantSource',
  'validateCheckoutSelection',
  'validateCouponForCheckout',
  'validateTermsConsent',
].sort();

const walkTypeScript = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkTypeScript(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
};

describe('public route manifest fail-closed probe', () => {
  it('rejects an actual public mutating route missing from the manifest', () => {
    const app = new Hono();
    app.post('/unreviewed-write', (context) => context.json({ ok: true }));

    expect(() => assertPublicRouteManifest(app.routes, PUBLIC_ROUTE_MANIFEST)).toThrow(
      'POST /unreviewed-write',
    );
  });

  it('rejects a route mounted before identity that lacks a self-authenticating entry', () => {
    const app = new Hono();
    app.post('/api/public/newsletter', (context) => context.json({ ok: true }));

    expect(() =>
      assertSelfAuthenticatingRouteManifest(
        app.routes,
        SELF_AUTHENTICATING_ROUTE_MANIFEST,
      ),
    ).toThrow('POST /api/public/newsletter');
  });

  it('validates the actual app route table and generated review document', () => {
    const tsx = join(appRoot, 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsx, ['scripts/generate-route-table.mjs', '--check'], {
        cwd: appRoot,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  }, 15_000);
});

describe('public route dependencies', () => {
  it('pins the reviewed core server surface available to public handlers', () => {
    expect(publicServerImports).toEqual(APPROVED_PUBLIC_SERVER_IMPORTS);
  });

  it('keeps CORS middleware in the public route module', () => {
    expect(publicApp).toMatch(/hono\/cors/);
    expect(read('apps', 'server', 'src', 'app.ts')).not.toMatch(/hono\/cors/);
    expect(read('apps', 'server', 'src', 'internal-app.ts')).not.toMatch(/hono\/cors/);
  });

  it('keeps the shared-cache policy in one response helper', () => {
    const offenders = walkTypeScript(appRoot)
      .filter((file) => /['"]public, no-cache['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(appRoot, file));

    expect(offenders).toEqual(['apps/server/src/respond.ts']);
  });
});
