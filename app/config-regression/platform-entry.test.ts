import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { API_PATHS } from '#core/contract/index.js';

const appRoot = join(import.meta.dirname, '..');
const eslintSource = readFileSync(join(appRoot, 'eslint.config.js'), 'utf8');
const require = createRequire(import.meta.url);
const depcruise: {
  forbidden: Array<{ name: string; from: { pathNot?: string } }>;
} = require(join(appRoot, '.dependency-cruiser.cjs'));
const routeConditionSchema = z.object({
  type: z.enum(['query', 'header']),
  key: z.string(),
  value: z.string(),
});
const routeMatcherSchema = z.object({
  source: z.string(),
  has: z.array(routeConditionSchema).optional(),
  missing: z.array(routeConditionSchema).optional(),
});
const vercel = z.object({
  regions: z.array(z.string()),
  functions: z.record(z.object({ maxDuration: z.number(), includeFiles: z.string().optional() })),
  rewrites: z.array(routeMatcherSchema.extend({ destination: z.string() })),
  headers: z.array(routeMatcherSchema.extend({
    headers: z.array(z.object({ key: z.string(), value: z.string() })),
  })),
}).parse(JSON.parse(readFileSync(join(appRoot, 'vercel.json'), 'utf8')));

const matchesRequest = (rule: z.infer<typeof routeMatcherSchema>, url: URL, userAgent: string): boolean => {
  const matchesCondition = (condition: z.infer<typeof routeConditionSchema>) => {
    const value = condition.type === 'query'
      ? url.searchParams.get(condition.key)
      : condition.key === 'user-agent' ? userAgent : null;
    return value !== null && new RegExp(`^(?:${condition.value})$`, 'u').test(value);
  };
  return new RegExp(`^${rule.source}$`, 'u').test(url.pathname)
    && (rule.has ?? []).every(matchesCondition)
    && (rule.missing ?? []).every((condition) => !matchesCondition(condition));
};

const hostedCspFor = (url: URL, userAgent = 'Mozilla/5.0') => vercel.headers
  .filter((rule) => matchesRequest(rule, url, userAgent))
  .flatMap(({ headers }) => headers)
  .filter(({ key }) => key === 'Content-Security-Policy')
  .map(({ value }) => value);

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
    const spaCsp = cspFor('/((?!api/|u/|marketing/|legal/|offer/|checkout/).*)');
    expect(spaCsp).toContain("default-src 'self'");
    expect(spaCsp).toContain("connect-src 'self' https:;");
  });

  it.each([
    '/checkout/order?status=success',
    '/checkout/order?status=cancelled',
    '/offer/workbook?status=success',
    '/offer/workbook?status=cancelled',
    '/offer/workbook?checkout=together',
    '/offer/workbook?checkout=together&status=success',
  ])('requires server domain verification for hosted checkout CSP at %s', (path) => {
    for (const origin of ['https://example.org', 'https://acme.example.org', 'https://nested.acme.example.org', 'https://learn.acme.example']) {
      const url = new URL(path, origin);
      expect(vercel.rewrites.find((rule) => matchesRequest(rule, url, 'Mozilla/5.0'))?.destination)
        .toBe('/api/index');
      expect(hostedCspFor(url)).toEqual([]);
    }
    expect(vercel.functions['api/index.ts']?.includeFiles).toBe('dist/web/index.html');
  });

  it.each(['/start', '/home/settings', '/my/products', '/index.html'])(
    'keeps the hosted script policy same-origin at %s',
    (path) => {
      const policies = hostedCspFor(new URL(path, 'https://acme.example'));
      expect(policies).toHaveLength(1);
      expect(policies[0]).toContain("script-src 'self';");
      expect(policies[0]).not.toContain('google');
    },
  );

  it.each([
    ['/offer/workbook', 'Mozilla/5.0'],
    ['/offer/workbook?status=pending', 'Mozilla/5.0'],
    ['/offer/workbook?status=success', 'Twitterbot/1.0'],
    ['/offer/workbook?checkout=together', 'Googlebot'],
    ['/checkout/order?status=success', 'Twitterbot/1.0'],
  ])('leaves the server CSP in charge at %s for %s', (path, userAgent) => {
    const url = new URL(path, 'https://acme.example');
    expect(vercel.rewrites.find((rule) => matchesRequest(rule, url, userAgent))?.destination)
      .toBe('/api/index');
    expect(hostedCspFor(url, userAgent)).toEqual([]);
  });
});
