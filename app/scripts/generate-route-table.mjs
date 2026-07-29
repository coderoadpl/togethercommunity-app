import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { API_ROUTES } from '#core/contract/index.js';

import { buildApp } from '../apps/server/src/app.js';
import { publicRouteManifestEntry } from '../apps/server/src/public-route-manifest.js';
import { selfAuthenticatingRouteManifestEntry } from '../apps/server/src/self-authenticating-route-manifest.js';

const dependency = new Proxy(
  () => undefined,
  {
    get: () => dependency,
    apply: () => dependency,
  },
);

const routeNames = new Map(
  Object.entries(API_ROUTES).map(([name, route]) => [
    `${route.method} ${route.path}`,
    name.replaceAll(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
  ]),
);

const purposeFor = (route) => {
  const publicEntry = publicRouteManifestEntry(route);
  if (publicEntry !== undefined) return publicEntry.why;
  return routeNames.get(`${route.method} ${route.path}`)
    ?? route.path
      .replaceAll(/[:*]/g, '')
      .split('/')
      .filter(Boolean)
      .join(' ');
};

export const collectRuntimeRoutes = () => buildApp(dependency).routes
  .filter((route) => route.method !== 'ALL');

const rows = () => collectRuntimeRoutes()
  .map((route) => {
    const publicEntry = publicRouteManifestEntry(route);
    const selfAuthenticatingEntry = selfAuthenticatingRouteManifestEntry(route);
    const access = publicEntry !== undefined
      ? 'public'
      : route.path.startsWith('/api/dev/')
        ? 'development-only'
        : selfAuthenticatingEntry !== undefined
          ? 'self-authenticating'
          : 'authenticated';
    const mutating = publicEntry?.mutating
      ?? !['GET', 'HEAD', 'OPTIONS'].includes(route.method);
    return `| \`${route.method} ${route.path}\` | ${access} | ${mutating ? 'mutating' : 'read'} | ${purposeFor(route)} |`;
  });

const document = () => [
  '# Server route table',
  '',
  'Generated from the Hono route table by `pnpm exec tsx scripts/generate-route-table.mjs`.',
  'Self-authenticating routes enforce a session, API key, or operator secret before the shared tenant identity middleware.',
  '',
  '| Route | Access | Operation | Purpose |',
  '|---|---|---|---|',
  ...rows(),
  '',
].join('\n');

const output = new URL('../docs/route-table.md', import.meta.url);
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rendered = document();
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== rendered) {
      throw new Error(
        'docs/route-table.md is stale; run pnpm exec tsx scripts/generate-route-table.mjs',
      );
    }
  } else {
    writeFileSync(output, rendered);
  }
}
