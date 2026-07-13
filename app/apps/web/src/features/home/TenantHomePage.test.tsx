import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pl } from '../../i18n/pl.js';
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

/**
 * MUI's `useMediaQuery` reads `window.matchMedia`, which jsdom does not provide.
 * Stub it so the shell can resolve the permanent (desktop) vs temporary (mobile)
 * drawer deterministically per test.
 */
const stubViewport = (isDesktop: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  );
};

afterEach(() => vi.unstubAllGlobals());

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
  it('renders the classic admin shell with sidebar sections and the active section', async () => {
    stubViewport(true);
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
      http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
      http.get('/api/products/access-issues', () =>
        HttpResponse.json({ ok: true, data: { issues: [] } }),
      ),
    );

    await renderHomePage();

    expect(await screen.findByTestId('tenant-name')).toHaveTextContent('Acme');
    for (const id of ['products', 'courses', 'sales', 'members', 'integrations', 'settings'] as const) {
      expect(screen.getByTestId(`section-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('section-products')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('section-courses')).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { name: pl.products.newProduct })).toBeInTheDocument();
  });

  it('switches the active section and shows a coming-soon panel for stub sections', async () => {
    stubViewport(true);
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
      http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
      http.get('/api/products/access-issues', () =>
        HttpResponse.json({ ok: true, data: { issues: [] } }),
      ),
    );

    await renderHomePage();

    await userEvent.click(await screen.findByTestId('section-sales'));

    expect(screen.getByTestId('section-sales')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(pl.sections.comingSoon)).toBeInTheDocument();
  });

  it('opens the mobile navigation drawer from the AppBar hamburger', async () => {
    stubViewport(false);
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
      http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
      http.get('/api/products/access-issues', () =>
        HttpResponse.json({ ok: true, data: { issues: [] } }),
      ),
    );

    await renderHomePage();

    const hamburger = await screen.findByTestId('open-navigation');
    expect(screen.queryByTestId('section-products')).not.toBeInTheDocument();

    await userEvent.click(hamburger);

    await waitFor(() => {
      expect(screen.getByTestId('section-products')).toBeInTheDocument();
    });
    expect(screen.getByTestId('section-members')).toBeInTheDocument();
  });

  it('signs out from the account menu in the AppBar', async () => {
    stubViewport(true);
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
      http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
      http.get('/api/products/access-issues', () =>
        HttpResponse.json({ ok: true, data: { issues: [] } }),
      ),
    );

    await renderHomePage();

    await userEvent.click(await screen.findByTestId('user-menu'));
    expect(await screen.findByTestId('user-menu-email')).toHaveTextContent('creator@together.dev');
    expect(screen.getByTestId('sign-out')).toBeInTheDocument();
  });

  it('falls back to the tenant picker when no tenant is selected', async () => {
    stubViewport(true);
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithoutTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
    );

    await renderHomePage();

    expect(await screen.findByText(pl.tenant.choose)).toBeInTheDocument();
  });
});
