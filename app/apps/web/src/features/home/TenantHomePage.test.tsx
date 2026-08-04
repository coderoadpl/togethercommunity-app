import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TenantHomePage } from './TenantHomePage.js';

const meWithTenant = {
  userId: 'u1',
  email: 'creator@together.dev',
  name: 'Demo',
  emailVerified: true,
  tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: null, banned: false },
};

const meMemberOnly = {
  userId: 'u1',
  email: 'member@together.dev',
  name: 'Member',
  emailVerified: true,
  tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'm1', banned: false },
};

const meWithoutTenant = {
  userId: 'u1',
  email: 'creator@together.dev',
  name: 'Demo',
  emailVerified: true,
  tenant: null,
};

const tenantsBody = {
  tenants: [{
    tenant: {
      id: 't1', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1,
    },
    staffRole: 'owner',
  }],
  canCreateTenant: true,
};

const stub = (label: string) => () => <div>{label}</div>;

const renderHome = async () => {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: TenantHomePage });
  const panelRoute = createRoute({ getParentRoute: () => rootRoute, path: '/panel', component: stub('PANEL') });
  const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: stub('LOGIN') });
  const myRoute = createRoute({ getParentRoute: () => rootRoute, path: '/my', component: stub('MY') });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, panelRoute, loginRoute, myRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('TenantHomePage dispatcher', () => {
  it('redirects a staff member into the creator panel', async () => {
    server.use(http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })));
    await renderHome();
    expect(await screen.findByText('PANEL')).toBeInTheDocument();
  });

  it('redirects a member-only account to their courses', async () => {
    server.use(http.get('/api/me', () => HttpResponse.json({ ok: true, data: meMemberOnly })));
    await renderHome();
    expect(await screen.findByText('MY')).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor to sign in', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }, { status: 401 }),
      ),
    );
    await renderHome();
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
  });

  it('shows the tenant picker when no space is selected', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithoutTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
      http.get('/api/public/auth-config', () => HttpResponse.json({
        ok: true,
        data: {
          googleEnabled: false,
          passkeysEnabled: true,
          totpEnabled: true,
          exposeMagicLinks: false,
        },
      })),
    );
    await renderHome();
    expect(await screen.findByText(pl.tenant.choose)).toBeInTheDocument();
    expect(screen.getByText(pl.tenant.welcome)).toBeInTheDocument();
    expect(await screen.findByLabelText(pl.tenant.slugLabel)).toBeInTheDocument();
  });

  it('hides tenant creation when the instance policy is closed', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithoutTenant })),
      http.get('/api/tenants', () => HttpResponse.json({
        ok: true,
        data: { ...tenantsBody, canCreateTenant: false },
      })),
      http.get('/api/public/auth-config', () => HttpResponse.json({
        ok: true,
        data: {
          googleEnabled: false,
          passkeysEnabled: true,
          totpEnabled: true,
          exposeMagicLinks: false,
        },
      })),
    );
    await renderHome();

    expect(await screen.findByText(pl.tenant.choose)).toBeInTheDocument();
    expect(screen.queryByLabelText(pl.tenant.nameLabel)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(pl.tenant.slugLabel)).not.toBeInTheDocument();
  });

  it('offers first-workspace creation and resend for an unverified platform account', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({
        ok: true,
        data: { ...meWithoutTenant, emailVerified: false },
      })),
      http.get('/api/tenants', () => HttpResponse.json({
        ok: true,
        data: { ...tenantsBody, canCreateTenant: true },
      })),
    );
    await renderHome();

    expect(await screen.findByTestId('resend-verification-email')).toBeInTheDocument();
    expect(await screen.findByLabelText(pl.tenant.nameLabel)).toBeInTheDocument();
  });
});
