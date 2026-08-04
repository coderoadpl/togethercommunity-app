import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import {
  hostHasTenantSubdomain,
  isConfiguredBaseDomainHost,
  tenantUrl,
  usesPlatformAuthSurface,
} from '../../lib/tenant.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TenantGate } from './TenantNotFoundPage.js';

const children = <div>APP</div>;

afterEach(() => vi.unstubAllEnvs());

describe('tenantUrl', () => {
  it('uses the configured base domain on the apex host', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(tenantUrl('coderoad', new URL('https://togethercommunity.app'))).toBe(
      'https://coderoad.togethercommunity.app',
    );
  });

  it('keeps a bare hostname intact without a configured base domain', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(tenantUrl('coderoad', new URL('https://togethercommunity.app'))).toBe(
      'https://coderoad.togethercommunity.app',
    );
  });

  it('uses the configured base domain on a tenant subdomain and preserves the port', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(tenantUrl('studio', new URL('https://acme.togethercommunity.app:8443'))).toBe(
      'https://studio.togethercommunity.app:8443',
    );
  });

  it('keeps the localhost fallback for local development', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(tenantUrl('studio', new URL('http://acme.localhost:48731'))).toBe(
      'http://studio.localhost:48731',
    );
  });

  it('infers the base from a tenant-shaped host without configuration', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(tenantUrl('studio', new URL('https://acme.preview.example'))).toBe(
      'https://studio.preview.example',
    );
  });

  it('uses the configured platform base domain from a custom domain', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(tenantUrl('coderoad', new URL('https://community.customer.example'))).toBe(
      'https://coderoad.togethercommunity.app',
    );
  });

  it('keeps tenant links on the configured base domain from the start host', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(tenantUrl('acme', new URL('https://start.togethercommunity.app'))).toBe(
      'https://acme.togethercommunity.app',
    );
  });
});

describe('platform host helpers', () => {
  it('recognizes both the configured base domain and its start host', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(isConfiguredBaseDomainHost('togethercommunity.app')).toBe(true);
    expect(isConfiguredBaseDomainHost('START.TOGETHERCOMMUNITY.APP')).toBe(true);
    expect(isConfiguredBaseDomainHost('acme.togethercommunity.app')).toBe(false);
  });

  it('uses the platform auth surface on the base and start hosts only', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');

    expect(usesPlatformAuthSurface('togethercommunity.app')).toBe(true);
    expect(usesPlatformAuthSurface('start.togethercommunity.app')).toBe(true);
    expect(usesPlatformAuthSurface('acme.togethercommunity.app')).toBe(false);
  });

  it('keeps the existing single-tenant platform fallback without configuration', () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', '');

    expect(isConfiguredBaseDomainHost('start.example.com')).toBe(false);
    expect(usesPlatformAuthSurface('start.example.com')).toBe(true);
  });
});

describe('hostHasTenantSubdomain', () => {
  it('is false on the configured apex domain', () => {
    expect(hostHasTenantSubdomain('togethercommunity.app', 'togethercommunity.app')).toBe(false);
  });

  it('is true for a single-label tenant subdomain', () => {
    expect(hostHasTenantSubdomain('acme.togethercommunity.app', 'togethercommunity.app')).toBe(true);
  });

  it('is false on the derived platform host', () => {
    expect(hostHasTenantSubdomain('start.togethercommunity.app', 'togethercommunity.app')).toBe(false);
  });

  it('supports the localhost fallback', () => {
    expect(hostHasTenantSubdomain('acme.localhost', 'localhost')).toBe(true);
  });

  it('ignores custom domains and multi-label tenant hosts', () => {
    expect(hostHasTenantSubdomain('community.customer.example', 'togethercommunity.app')).toBe(false);
    expect(hostHasTenantSubdomain('a.b.togethercommunity.app', 'togethercommunity.app')).toBe(false);
  });
});

describe('TenantGate', () => {
  it('renders the app on the apex domain without probing', () => {
    renderWithProviders(<TenantGate hostname="localhost">{children}</TenantGate>);
    expect(screen.getByText('APP')).toBeInTheDocument();
  });

  it('renders the app on the platform host without probing', () => {
    renderWithProviders(<TenantGate hostname="start.localhost">{children}</TenantGate>);
    expect(screen.getByText('APP')).toBeInTheDocument();
  });

  it('renders the app when the tenant subdomain resolves', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({ ok: true, data: { tenant: { slug: 'acme', name: 'Acme' }, contentVersion: 1, products: [] } }),
      ),
    );
    renderWithProviders(<TenantGate hostname="acme.localhost">{children}</TenantGate>);
    expect(await screen.findByText('APP')).toBeInTheDocument();
  });

  it('shows a friendly 404 when an unknown subdomain fails to resolve', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({ ok: false, error: { code: 'tenant_not_found', message: 'no such tenant' } }, { status: 404 }),
      ),
    );
    renderWithProviders(<TenantGate hostname="ghost.localhost">{children}</TenantGate>);

    expect(await screen.findByTestId('tenant-not-found')).toBeInTheDocument();
    expect(screen.getByAltText('Together')).toBeInTheDocument();
    expect(screen.getByText(pl.tenantNotFound.title)).toBeInTheDocument();
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
    expect(en.tenantNotFound.title).not.toBe(pl.tenantNotFound.title);
  });
});
