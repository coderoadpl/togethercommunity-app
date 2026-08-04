import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Identity, Tenant } from '#core/domain/index.js';

import { registerManifestRoute } from './manifest.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string } };
type ManifestDeps = Parameters<typeof registerManifestRoute>[1];

const manifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  short_name: z.string(),
  start_url: z.string(),
  scope: z.string(),
  display: z.string(),
  background_color: z.string(),
  theme_color: z.string(),
  icons: z.array(z.object({
    src: z.string(),
    sizes: z.string(),
    type: z.string(),
    purpose: z.string().optional(),
  })),
});

const tenant = (name = 'Acme'): Tenant => ({
  id: 'tenant-acme',
  slug: 'acme',
  name,
  status: 'active',
  plan: 'hosted',
  contentVersion: 1,
});

const deps = (tenants: Tenant[], accentColor: string | null = null): ManifestDeps => ({
  baseDomain: 'localhost',
  singleTenantMode: false,
  tenantDomains: {
    findByDomain: async () => null,
    listVerifiedDomains: async () => [],
  },
  tenants: {
    findById: async (id) => tenants.find((candidate) => candidate.id === id) ?? null,
    findBySlug: async (slug) => tenants.find((candidate) => candidate.slug === slug) ?? null,
    findSole: async () => tenants.length === 1 ? tenants[0] ?? null : null,
    hasAny: async () => tenants.length > 0,
    findSettings: async (id) => {
      const found = tenants.find((candidate) => candidate.id === id);
      return found === undefined ? null : {
        name: found.name,
        socialLinks: [],
        billingPortalUrl: null,
        bunnyStreamLibraryId: null,
        bunnyStreamCdnHostname: null,
        logoUrl: null,
        accentColor,
        faviconUrl: null,
        ogTitle: null,
        ogDescription: null,
        ogImageUrl: null,
        supportEmail: null,
        supportUrl: null,
        termsUrl: null,
        privacyUrl: null,
      };
    },
    updateSettings: async (_id, settings) => settings,
    createTenantWithOwnerGrant: async (input) => ({
      id: input.tenant.id,
      slug: input.tenant.slug,
      name: input.tenant.name,
      status: 'active',
      plan: 'self_hosted',
      contentVersion: 1,
    }),
  },
});

const requestManifest = async (
  configuredDeps: ManifestDeps,
  host: string,
): Promise<{ response: Response; manifest: z.infer<typeof manifestSchema> }> => {
  const app = new Hono<Vars>();
  registerManifestRoute(app, configuredDeps);
  const response = await app.request('/manifest.webmanifest', { headers: { host } });
  const body: unknown = JSON.parse(await response.text());
  return { response, manifest: manifestSchema.parse(body) };
};

describe('PWA manifest', () => {
  it('serves the tenant manifest with installability fields and icons', async () => {
    const { response, manifest } = await requestManifest(deps([tenant()]), 'acme.localhost:48730');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8');
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Acme',
      short_name: 'Acme',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#fafafa',
      theme_color: '#fafafa',
      icons: [
        { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: '/icons/pwa-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    });
  });

  it('truncates a long tenant name to twelve characters with an ellipsis', async () => {
    const longName = 'A very long tenant name';
    const { manifest } = await requestManifest(deps([tenant(longName)]), 'acme.localhost');

    expect(manifest.name).toBe(longName);
    expect(manifest.short_name).toBe('A very long…');
    expect(manifest.short_name).toHaveLength(12);
  });

  it('uses the tenant accent color when configured', async () => {
    const { manifest } = await requestManifest(deps([tenant()], '#0E7490'), 'acme.localhost');

    expect(manifest.theme_color).toBe('#0E7490');
  });

  it('serves the platform manifest on the apex domain', async () => {
    const { manifest } = await requestManifest(deps([tenant()]), 'localhost:48730');

    expect(manifest.name).toBe('Together');
    expect(manifest.short_name).toBe('Together');
  });

  it('serves the platform manifest for an unknown subdomain', async () => {
    const { response, manifest } = await requestManifest(deps([tenant()]), 'missing.localhost:48730');

    expect(response.status).toBe(200);
    expect(manifest.name).toBe('Together');
  });
});
