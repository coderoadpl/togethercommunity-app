import { describe, expect, it } from 'vitest';

import type { Tenant } from '#core/domain/index.js';

import type { TenantRepository } from '../ports.js';
import { createSesWebhookBaseUrlResolver } from './ses-webhook-url.js';

const acme: Tenant = {
  id: 't-acme',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'hosted',
  contentVersion: 1,
};

const fakeTenants: TenantRepository = {
  findById: async (tenantId) => tenantId === acme.id ? acme : null,
  findBySlug: async (slug) => slug === acme.slug ? acme : null,
  findSole: async () => acme,
  hasAny: async () => true,
  findSettings: async () => null,
  updateSettings: async (_tenantId, settings) => settings,
  createTenantWithOwnerGrant: async () => acme,
};

const routing = {
  appBaseUrl: 'https://togethercommunity.app',
  baseDomain: 'togethercommunity.app',
  singleTenantMode: false,
};

describe('SES webhook base URL', () => {
  it('uses the platform host for the tenant instead of the platform apex', async () => {
    const resolve = createSesWebhookBaseUrlResolver({ tenants: fakeTenants, routing });

    expect(await resolve('t-acme')).toBe('https://acme.togethercommunity.app/api/webhooks/ses');
  });

  it('falls back to the platform apex for an unknown tenant', async () => {
    const resolve = createSesWebhookBaseUrlResolver({ tenants: fakeTenants, routing });

    expect(await resolve('t-missing')).toBe('https://togethercommunity.app/api/webhooks/ses');
  });

  it('keeps the configured base URL in single-tenant mode', async () => {
    const resolve = createSesWebhookBaseUrlResolver({
      tenants: fakeTenants,
      routing: { ...routing, appBaseUrl: 'http://localhost:48730', singleTenantMode: true },
    });

    expect(await resolve('t-acme')).toBe('http://localhost:48730/api/webhooks/ses');
  });
});
