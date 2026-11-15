import { z } from 'zod';
import { configureStripeInputSchema, provisionTenantInputSchema, tenantSettingsSchema } from '#core/domain/index.js';

export type FakeInstance = {
  baseDomain: string;
  workspaces: string[];
  port?: string;
  customDomains?: Record<string, string>;
  tenantHost?: string;
  secretKeys?: Record<string, string[]>;
};
type FakeInstanceRequest = {
  origin: string; path: string; method: string; tenant: string | null; authorization: string | null; secret: string | null; body: string | null;
};

const json = (data: unknown, status = 200) => Response.json(status < 400 ? { ok: true, data } : { ok: false, error: data }, { status });
const hostnameOf = (url: URL) => url.hostname.replace(/\.+$/, '');

const resolveWorkspace = (instances: FakeInstance[], url: URL, tenantHeader: string | null) => {
  const host = hostnameOf(url);
  const candidates = instances.filter((instance) => (instance.port ?? '') === url.port);
  for (const instance of candidates) {
    const slug = instance.customDomains?.[host];
    if (slug !== undefined) return { instance, slug };
  }
  const instance = candidates.filter((candidate) => host === candidate.baseDomain || host.endsWith(`.${candidate.baseDomain}`))
    .toSorted((left, right) => right.baseDomain.length - left.baseDomain.length)[0];
  if (instance === undefined) return null;
  if (host === `start.${instance.baseDomain}`) return { instance, slug: null };
  if (host === instance.baseDomain) return { instance, slug: tenantHeader };
  const label = host.slice(0, -(instance.baseDomain.length + 1));
  return label.includes('.') ? null : { instance, slug: label };
};

export const createInstanceFetch = (instances: FakeInstance[]) => {
  const requests: FakeInstanceRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const request: FakeInstanceRequest = {
      origin: url.origin, path: url.pathname, method: init?.method ?? 'GET', tenant: headers.get('x-tenant'),
      authorization: headers.get('authorization'), secret: headers.get('x-scheduler-operator-secret'),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    requests.push(request);
    if (request.authorization === null && request.secret === null) return json({ code: 'unauthorized', message: 'Sign in' }, 401);
    const resolved = resolveWorkspace(instances, url, request.tenant);
    if (resolved === null) throw new TypeError('fetch failed');
    const { instance, slug } = resolved;
    if (request.path === '/api/tenants') {
      return json({
        tenants: instance.workspaces.map((workspace) => ({
          tenant: { id: `t-${workspace}`, slug: workspace, name: workspace, status: 'active', plan: 'hosted', contentVersion: 1 }, staffRole: 'owner',
        })),
        memberTenants: [], canCreateTenant: false,
      });
    }
    if (request.path === '/api/internal/tenants/provision') {
      const input: unknown = JSON.parse(z.string().parse(request.body));
      const body = provisionTenantInputSchema.parse(input);
      instance.workspaces.push(body.slug);
      return json({
        tenant: { id: `t-${body.slug}`, slug: body.slug, name: body.name }, created: true, ownerUserId: 'u1',
        readiness: { tenantExists: true, ownerGrantPresent: true, storageConfigured: false, lastProbeOk: false,
          lastProbeAt: null, stripeConfigured: false, mode: null, webhookEndpointRegistered: false, legalUrlsSet: false, publishedProducts: 0 },
      });
    }
    const identity = { userId: 'u1', email: 'owner@togethercommunity.app', name: 'Owner', emailVerified: true };
    if (slug === null) {
      return request.path === '/api/me' ? json({ ...identity, tenant: null }) : json({ code: 'forbidden', message: 'No workspace' }, 403);
    }
    if (!instance.workspaces.includes(slug)) return json({ code: 'tenant_not_found', message: 'No tenant' }, 404);
    const port = url.port === '' ? '' : `:${url.port}`;
    const tenantHost = instance.tenantHost ?? `${slug}.${instance.baseDomain}${port}`;
    switch (request.path) {
      case '/api/me':
        return json({ ...identity, tenant: { id: `t-${slug}`, slug, name: slug, staffRole: 'owner', memberId: null, banned: false } });
      case '/api/tenant/routing':
        return json({ routing: {
          tenantHost, storageCorsOrigins: [`${url.protocol}//${tenantHost}`], canonicalOrigin: `${url.protocol}//${tenantHost}`,
          customDomains: [], customDomainTarget: `start.${instance.baseDomain}`, apexDomainsSupported: false, canAddCustomDomain: true,
        } });
      case '/api/tenant/settings':
        return json({ settings: tenantSettingsSchema.parse({ name: slug, billingPortalUrl: null, bunnyStreamLibraryId: null }) });
      case '/api/products':
        return json({ products: [] });
      case '/api/tenant-secrets':
        return json({
          secrets: (instance.secretKeys?.[slug] ?? []).map((key) => ({ key, maskedPreview: '••••xxxx', updatedAt: '2026-01-01T00:00:00Z' })),
          stripeMode: null, stripeWebhookUrl: `${url.protocol}//${tenantHost}/api/webhooks/stripe/t-${slug}`,
        });
      case '/api/integrations/stripe/configure': {
        const input: unknown = JSON.parse(z.string().parse(request.body));
        const { mode } = configureStripeInputSchema.parse(input);
        const keys = mode === 'test' ? ['stripe.testRestrictedKey', 'stripe.testWebhookSecret', 'stripe.testWebhookEndpointId'] : ['stripe.restrictedKey', 'stripe.webhookSecret', 'stripe.webhookEndpointId'];
        instance.secretKeys = { ...instance.secretKeys, [slug]: keys };
        return json({ mode, webhookUrl: `${url.protocol}//${tenantHost}/api/stripe/webhook?mode=${mode}` });
      }
      default:
        throw new Error(`Unexpected fake instance request: ${request.method} ${request.path}`);
    }
  };
  return { fetchImpl, requests };
};
