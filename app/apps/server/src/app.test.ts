import { describe, expect, it } from 'vitest';

import { API_PATHS, TENANT_HEADER } from '@core/contract/index.js';
import type { AppDeps } from './composition.js';
import { buildApp } from './app.js';
import type { Member, Membership, Product, Tenant, TenantDomain } from '@core/domain/index.js';

const acme: Tenant = { id: 't-acme', slug: 'acme', name: 'Acme', contentVersion: 4 };
const globex: Tenant = { id: 't-globex', slug: 'globex', name: 'Globex', contentVersion: 2 };

const product = (input: {
  id: string;
  tenantId: string;
  title: string;
  published: boolean;
}): Product => ({
  id: input.id,
  tenantId: input.tenantId,
  title: input.title,
  description: '',
  priceCents: 1000,
  currency: 'PLN',
  published: input.published,
  createdAt: '2026-07-12T00:00:00.000Z',
});

const deps = (input: {
  tenants?: Tenant[];
  domains?: TenantDomain[];
  products?: Product[];
  authenticated?: boolean;
} = {}): AppDeps => {
  const tenants = input.tenants ?? [acme, globex];
  const domains = input.domains ?? [];
  const products = input.products ?? [
    product({ id: 'acme-published', tenantId: 't-acme', title: 'Acme Published', published: true }),
    product({ id: 'acme-draft', tenantId: 't-acme', title: 'Acme Draft', published: false }),
    product({ id: 'globex-published', tenantId: 't-globex', title: 'Globex Published', published: true }),
  ];
  const memberships: Membership[] = [];
  const members: Member[] = [];
  return {
    auth: {
      handler: async () => new Response(null, { status: 404 }),
    },
    authPort: {
      getAuthenticatedUser: async () => {
        if (!input.authenticated) throw new Error('Public route must not authenticate');
        return null;
      },
      ensureUser: async () => ({ userId: 'user-id', created: true }),
      requestMagicLink: async () => undefined,
    },
    members: {
      findByEmail: async () => null,
      listWithProductIds: async () => [],
      create: async () => undefined,
      updateEmail: async () => null,
      delete: async () => false,
    },
    grants: {
      findGrant: async () => null,
      createGrant: async () => true,
      listGrantedProducts: async () => [],
    },
    purchases: {
      createMemberGrant: async (purchase) => ({
        member: {
          id: purchase.memberId,
          tenantId: purchase.tenantId,
          userId: purchase.userId,
          email: purchase.email,
          displayName: null,
          tags: [],
          marketingConsents: {},
          externalCustomerIds: {},
          createdAt: purchase.createdAt,
        },
        grantCreated: true,
      }),
    },
    devMagicLinks: {
      findByEmail: async () => null,
    },
    products: {
      listByTenant: async (tenantId) => products.filter((candidate) => candidate.tenantId === tenantId),
      listPublishedByTenant: async (tenantId) =>
        products.filter((candidate) => candidate.tenantId === tenantId && candidate.published),
      findById: async (tenantId, id) =>
        products.find((candidate) => candidate.tenantId === tenantId && candidate.id === id) ?? null,
      create: async () => undefined,
      setPublished: async () => undefined,
      bumpContentVersion: async () => undefined,
    },
    tenantDomains: {
      findByDomain: async (domain) => domains.find((candidate) => candidate.domain === domain) ?? null,
      listVerifiedDomains: async () => domains,
    },
    tenants: {
      findById: async (tenantId) => tenants.find((tenant) => tenant.id === tenantId) ?? null,
      findBySlug: async (slug) => tenants.find((tenant) => tenant.slug === slug) ?? null,
      createTenantWithOwnerGrant: async (tenant) => ({
        id: tenant.tenant.id,
        slug: tenant.tenant.slug,
        name: tenant.tenant.name,
        contentVersion: 1,
      }),
    },
    tenantAccess: {
      listTenantsForStaff: async () => memberships,
      findStaffGrant: async () => null,
      findMember: async (_userId, tenantId) =>
        members.find((candidate) => candidate.tenantId === tenantId) ?? null,
    },
    health: { pingDatabase: async () => true },
    ids: { nextId: () => 'id' },
    clock: { nowIso: () => '2026-07-12T00:00:00.000Z' },
    baseDomain: 'localhost',
    appBaseUrl: 'http://localhost:48730',
    devEndpoints: { simulatedPayments: false, exposeMagicLinks: false },
    authConfig: { googleEnabled: false },
  };
};

const requestPublicOffer = (app: ReturnType<typeof buildApp>, headers: Record<string, string>) =>
  app.request(API_PATHS.publicOffer, { headers });

describe('public offer route', () => {
  it('returns only published products with public CORS and cache headers', async () => {
    const app = buildApp(deps());

    const response = await requestPublicOffer(app, { host: 'acme.localhost:48730' });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(response.headers.get('vary')).toBe(`Host, ${TENANT_HEADER}`);
    expect(response.headers.get('etag')).toBe('W/"offer-t-acme-4"');
    expect(body).toMatchObject({
      ok: true,
      data: {
        tenant: { slug: 'acme', name: 'Acme' },
        contentVersion: 4,
        products: [{ id: 'acme-published', title: 'Acme Published' }],
      },
    });
    expect(JSON.stringify(body)).not.toContain('acme-draft');
    expect(JSON.stringify(body)).not.toContain('"published":');
  });

  it('round-trips ETag through If-None-Match as 304', async () => {
    const app = buildApp(deps());
    const first = await requestPublicOffer(app, { host: 'acme.localhost:48730' });
    const etag = first.headers.get('etag') ?? '';

    const second = await requestPublicOffer(app, {
      host: 'acme.localhost:48730',
      'if-none-match': etag,
    });

    expect(second.status).toBe(304);
    expect(second.headers.get('etag')).toBe(etag);
    expect(second.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('selects the tenant from x-tenant on the base domain', async () => {
    const app = buildApp(deps());

    const response = await requestPublicOffer(app, {
      host: 'localhost:48730',
      [TENANT_HEADER]: 'globex',
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        tenant: { slug: 'globex', name: 'Globex' },
        products: [{ id: 'globex-published' }],
      },
    });
  });

  it('returns a 404 envelope for an unknown tenant', async () => {
    const app = buildApp(deps());

    const response = await requestPublicOffer(app, { host: 'missing.localhost:48730' });
    const body: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });

  it('handles OPTIONS before auth middleware', async () => {
    const app = buildApp(deps());

    const response = await app.request(API_PATHS.publicOffer, { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });
});

describe('public auth-config route', () => {
  it('reports Google disabled with public CORS headers when no credentials are configured', async () => {
    const app = buildApp(deps());

    const response = await app.request(API_PATHS.authConfig);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(body).toMatchObject({
      ok: true,
      data: { googleEnabled: false, passkeysEnabled: true, totpEnabled: true },
    });
  });

  it('reports Google enabled when the composition provides credentials', async () => {
    const app = buildApp({ ...deps(), authConfig: { googleEnabled: true } });

    const response = await app.request(API_PATHS.authConfig);
    const body: unknown = await response.json();

    expect(body).toMatchObject({ ok: true, data: { googleEnabled: true } });
  });
});
