import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import { hostHasTenantSubdomain } from '../../lib/tenant.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TenantGate } from './TenantNotFoundPage.js';

const children = <div>APP</div>;

describe('hostHasTenantSubdomain', () => {
  it('is false on the apex domain', () => {
    expect(hostHasTenantSubdomain('localhost', 'localhost')).toBe(false);
    expect(hostHasTenantSubdomain('example.com', 'example.com')).toBe(false);
  });

  it('is true for a single-label tenant subdomain', () => {
    expect(hostHasTenantSubdomain('acme.localhost', 'localhost')).toBe(true);
    expect(hostHasTenantSubdomain('acme.example.com', 'example.com')).toBe(true);
  });

  it('ignores unrelated or multi-label hosts', () => {
    expect(hostHasTenantSubdomain('evil.com', 'localhost')).toBe(false);
    expect(hostHasTenantSubdomain('a.b.localhost', 'localhost')).toBe(false);
  });
});

describe('TenantGate', () => {
  it('renders the app on the apex domain without probing', () => {
    renderWithProviders(<TenantGate hostname="localhost">{children}</TenantGate>);
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
    expect(screen.getByText('Together')).toBeInTheDocument();
    expect(screen.getByText(pl.tenantNotFound.title)).toBeInTheDocument();
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
    expect(en.tenantNotFound.title).not.toBe(pl.tenantNotFound.title);
  });
});
