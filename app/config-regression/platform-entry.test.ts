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
  rewrites: Array<{ source: string; destination: string }>;
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
} = JSON.parse(readFileSync(join(appRoot, 'vercel.json'), 'utf8'));
const platformResetEntry = readFileSync(join(appRoot, 'api', 'platform-reset.ts'), 'utf8');

describe('Vercel platform entry boundary', () => {
  it('has a dedicated ESLint boundary element', () => {
    expect(eslintSource).toContain("type: 'platform-entry'");
    expect(eslintSource).toContain("pattern: 'apps/server/src/entry.vercel.ts'");
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
    expect(vercel.functions['api/index.ts']?.maxDuration).toBe(30);
  });

  it('sends legacy course links to the function ahead of the static fallbacks', () => {
    const rewrites = vercel.rewrites.map(({ source }) => source);

    expect(vercel.rewrites).toContainEqual({ source: '/courses/(.*)', destination: '/api/index' });
    expect(rewrites.indexOf('/courses/(.*)')).toBeLessThan(rewrites.indexOf('/(.*)'));
    expect(vercel.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' });
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
    const spaCsp = cspFor('/((?!api/|u/|marketing/|legal/).*)');
    expect(spaCsp).toContain("default-src 'self'");
    expect(spaCsp).toContain("connect-src 'self' https:;");
  });
});
