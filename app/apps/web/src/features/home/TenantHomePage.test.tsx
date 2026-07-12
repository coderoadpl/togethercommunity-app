import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TenantHomePage } from './TenantHomePage.js';

const meWithTenant = {
  userId: 'u1',
  email: 'creator@together.dev',
  name: 'Demo',
  tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: null },
};

const meWithoutTenant = {
  userId: 'u1',
  email: 'creator@together.dev',
  name: 'Demo',
  tenant: null,
};

const tenantsBody = {
  tenants: [{ tenant: { id: 't1', slug: 'acme', name: 'Acme', contentVersion: 1 }, staffRole: 'owner' }],
};

const renderHomePage = async () => {
  const rootRoute = createRootRoute({ component: TenantHomePage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('TenantHomePage', () => {
  it('shows the tenant name and placeholder when a tenant is resolved', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
    );

    await renderHomePage();

    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByText(/the creator panel arrives in a later stage/i)).toBeInTheDocument();
  });

  it('falls back to the tenant picker when no tenant is selected', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithoutTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
    );

    await renderHomePage();

    expect(await screen.findByText('Choose a tenant')).toBeInTheDocument();
  });
});
