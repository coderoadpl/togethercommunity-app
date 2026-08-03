import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = join(import.meta.dirname, '..');
const eslintSource = readFileSync(join(appRoot, 'eslint.config.js'), 'utf8');
const require = createRequire(import.meta.url);
const depcruise: {
  forbidden: Array<{ name: string; from: { pathNot?: string } }>;
} = require(join(appRoot, '.dependency-cruiser.cjs'));
const vercel: {
  regions: string[];
  rewrites: Array<{ source: string; destination: string }>;
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
} = JSON.parse(readFileSync(join(appRoot, 'vercel.json'), 'utf8'));

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
    const panelCsp = cspFor('/panel(.*)');
    const otherPageCsp = cspFor('/((?!api/|u/|marketing/|legal/|panel).*)');
    expect(panelCsp).toContain("default-src 'self'");
    expect(panelCsp).toContain("connect-src 'self' https:;");
    expect(otherPageCsp).toContain("connect-src 'self' https://*.sentry.io;");
    expect(otherPageCsp).not.toContain("connect-src 'self' https:;");
  });
});
