import type { Hono } from 'hono';

import { TENANT_HEADER } from '#core/contract/index.js';
import type { Identity } from '#core/domain/index.js';
import { resolveTenant } from '#core/server/index.js';

import type { AppDeps } from './composition.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string } };
type ManifestDeps = Pick<
  AppDeps,
  'baseDomain' | 'singleTenantMode' | 'tenantDomains' | 'tenants'
>;

const PLATFORM_NAME = 'Together';
const SHORT_NAME_MAX = 12;
const BACKGROUND = '#FAF8F5';
const EMBER = '#E8682A';

const shortName = (name: string): string =>
  name.length <= SHORT_NAME_MAX ? name : `${name.slice(0, SHORT_NAME_MAX - 1).trimEnd()}…`;

const ICONS = [
  { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] as const;

export const registerManifestRoute = (app: Hono<Vars>, deps: ManifestDeps): void => {
  app.get('/manifest.webmanifest', async (c) => {
    const resolved = await resolveTenant(
      c.req.header('host') ?? '',
      c.req.header(TENANT_HEADER) ?? null,
      deps,
    );
    const tenant = resolved.ok ? resolved.value?.tenant ?? null : null;
    const settings = tenant === null ? null : await deps.tenants.findSettings(tenant.id);
    const name = tenant?.name ?? PLATFORM_NAME;
    const manifest = {
      id: '/',
      name,
      short_name: shortName(name),
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: BACKGROUND,
      theme_color: settings?.accentColor ?? EMBER,
      icons: ICONS,
    };
    return c.body(JSON.stringify(manifest), 200, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
  });
};
