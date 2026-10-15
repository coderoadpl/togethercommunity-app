import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PATHS } from '#core/contract/index.js';

const appRoot = join(import.meta.dirname, '..');
const eslintSource = readFileSync(join(appRoot, 'eslint.config.js'), 'utf8');
const require = createRequire(import.meta.url);
const depcruise: {
  forbidden: Array<{ name: string; from: { pathNot?: string } }>;
} = require(join(appRoot, '.dependency-cruiser.cjs'));
const vercel: {
  regions: string[];
  functions: Record<string, { maxDuration: number }>;
  rewrites: Array<{ source: string; destination: string; has?: Array<{ type: string; key: string; value: string }> }>;
  routes?: unknown;
  headers: Array<{ source: string; has?: Array<{ type: string; key: string; value: string }>; headers: Array<{ key: string; value: string }> }>;
} = JSON.parse(readFileSync(join(appRoot, 'vercel.json'), 'utf8'));
const platformResetEntry = readFileSync(join(appRoot, 'api', 'platform-reset.ts'), 'utf8');

describe('Vercel platform entry boundary', () => {
  it('has a dedicated ESLint boundary element', () => {
    expect(eslintSource).toContain("type: 'platform-entry'");
    expect(eslintSource).toContain("pattern: 'apps/server/src/entry.vercel.ts'");
  });

  it('keeps the platform entry itself out of every import allowlist', () => {
    expect(eslintSource).not.toMatch(/^\s+'platform-entry',$/mu);
  });

  it('does not expose a separate platform runtime helper element', () => {
    expect(eslintSource).not.toContain("type: 'platform-runtime'");
    expect(eslintSource).not.toContain("pattern: 'apps/server/src/background-work.ts'");
  });

  it('is the only app path exempted by the vendor containment rule', () => {
    const rule = depcruise.forbidden.find(
      ({ name }) => name === 'vercel-and-neon-only-in-adapters',
    );

    expect(rule?.from.pathNot).toBe('^(adapters|apps/server/src/entry\\.vercel\\.ts$)');
  });

  it('routes the data reset to its own long-running function', () => {
    const rewrites = vercel.rewrites.map(({ source }) => source);

    expect(vercel.rewrites).toContainEqual({
      source: API_PATHS.platformDataReset,
      destination: '/api/platform-reset',
    });
    expect(rewrites.indexOf(API_PATHS.platformDataReset)).toBeLessThan(rewrites.indexOf('/api/(.*)'));
    expect(platformResetEntry).toContain('export const maxDuration = 300;');
    expect(vercel.functions['api/index.ts']?.maxDuration).toBe(60);
  });

  it('sends legacy course links to the function ahead of the static fallbacks', () => {
    const rewrites = vercel.rewrites.map(({ source }) => source);

    expect(vercel.rewrites).toContainEqual({ source: '/courses/(.*)', destination: '/api/index' });
    expect(rewrites.indexOf('/courses/(.*)')).toBeLessThan(rewrites.indexOf('/(.*)'));
    expect(vercel.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' });
  });

  it('sends /link/ paths to the function before the bot and web fallbacks', () => {
    const rewrites = vercel.rewrites.map(({ source }) => source);

    expect(vercel.rewrites).toContainEqual({ source: '/link/(.*)', destination: '/api/index' });
    expect(rewrites.indexOf('/link/(.*)')).toBeLessThan(rewrites.indexOf('/(.*)'));
    expect(vercel.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' });
  });

  it('sends crawler metadata files to the function for every user agent', () => {
    const rewrites = vercel.rewrites.map(({ source }) => source);

    expect(vercel.rewrites).toContainEqual({
      source: '/robots.txt',
      destination: '/api/index',
    });
    expect(vercel.rewrites).toContainEqual({
      source: '/sitemap.xml',
      destination: '/api/index',
    });
    expect(rewrites.indexOf('/robots.txt')).toBeLessThan(rewrites.indexOf('/(.*)'));
    expect(rewrites.indexOf('/sitemap.xml')).toBeLessThan(rewrites.indexOf('/(.*)'));
  });

  it('preserves the complete rewrite order and has no route overrides', () => {
    expect(vercel.routes).toBeUndefined();
    expect(vercel.rewrites).toEqual([
      { source: '/api/platform/data-reset', destination: '/api/platform-reset' },
      { source: '/api/(.*)', destination: '/api/index' },
      { source: '/u/(.*)', destination: '/api/index' },
      { source: '/marketing/(.*)', destination: '/api/index' },
      { source: '/legal/(.*)', destination: '/api/index' },
      { source: '/manifest.webmanifest', destination: '/api/index' },
      { source: '/robots.txt', destination: '/api/index' },
      { source: '/sitemap.xml', destination: '/api/index' },
      { source: '/courses/(.*)', destination: '/api/index' },
      { source: '/link/(.*)', destination: '/api/index' },
      { source: '/(.*)', has: [{ type: 'header', key: 'user-agent', value: '.*(facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Googlebot|redditbot|Applebot).*' }], destination: '/api/index' },
      { source: '/offer/(.*)', has: [{ type: 'query', key: 'checkout', value: 'together' }], destination: '/index.html' },
      { source: '/offer/(.*)', has: [{ type: 'query', key: 'status', value: 'success|cancelled' }], destination: '/index.html' },
      { source: '/offer/(.*)', destination: '/api/index' },
      { source: '/(.*)', destination: '/index.html' },
    ]);
  });

  it('allows the analytics script sources only on static checkout success documents', () => {
    const baseline = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; font-src 'self' data:; img-src 'self' data: https:; frame-src https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
    const extended = baseline.replace("script-src 'self'", "script-src 'self' https://www.googletagmanager.com/gtag/ https://connect.facebook.net");
    const securityHeaders = (policy: string) => [
      { key: 'Content-Security-Policy', value: policy },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];
    expect(vercel.headers).toEqual([
      { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/((?!api/|u/|marketing/|legal/|offer/).*)', headers: securityHeaders(baseline) },
      { source: '/offer/(.*)', has: [{ type: 'query', key: 'checkout', value: 'together' }], headers: securityHeaders(baseline) },
      { source: '/offer/(.*)', has: [{ type: 'query', key: 'status', value: 'success|cancelled' }], headers: securityHeaders(baseline) },
      { source: '/offer/(.*)', has: [{ type: 'query', key: 'status', value: 'success' }], headers: securityHeaders(extended) },
      { source: '/checkout/(.*)', has: [{ type: 'query', key: 'status', value: 'success' }], headers: securityHeaders(extended) },
    ]);
    const effectivePolicy = (path: string) => {
      const url = new URL(path, 'https://acme.example');
      return vercel.headers
        .filter(({ source, has }) => new RegExp(`^${source}$`, 'u').test(url.pathname)
          && (has ?? []).every(({ type, key, value }) => type === 'query'
            && new RegExp(`^(?:${value})$`, 'u').test(url.searchParams.get(key) ?? '')))
        .flatMap(({ headers }) => headers.filter(({ key }) => key === 'Content-Security-Policy').map(({ value }) => value))
        .at(-1);
    };
    for (const path of [
      '/offer/workbook?status=success',
      '/offer/workbook?checkout=together&status=success',
      '/checkout/reference?status=success',
    ]) {
      expect(effectivePolicy(path), path).toBe(extended);
    }
    for (const path of [
      '/offer/workbook?checkout=together',
      '/offer/workbook?status=cancelled',
      '/offer/workbook?checkout=together&status=cancelled',
      '/checkout/reference',
      '/checkout/reference?status=cancelled',
      '/checkout/reference?status=successful',
      '/my?status=success',
      '/studio?status=success',
    ]) {
      expect(effectivePolicy(path), path).toBe(baseline);
    }
    expect(effectivePolicy('/offer/workbook')).toBeUndefined();
  });

  it('keeps API, public pages, static security headers, and Frankfurt routing explicit', () => {
    expect(vercel.regions).toEqual(['fra1']);
    expect(vercel.rewrites).toEqual(
      expect.arrayContaining([
        { source: '/api/(.*)', destination: '/api/index' },
        { source: '/u/(.*)', destination: '/api/index' },
        { source: '/marketing/(.*)', destination: '/api/index' },
        { source: '/legal/(.*)', destination: '/api/index' },
      ]),
    );
    const cspFor = (source: string) => vercel.headers
      .find((entry) => entry.source === source)
      ?.headers.find(({ key }) => key === 'Content-Security-Policy')?.value;
    const spaCsp = cspFor('/((?!api/|u/|marketing/|legal/|offer/).*)');
    expect(spaCsp).toContain("default-src 'self'");
    expect(spaCsp).toContain("connect-src 'self' https:;");
  });
});
