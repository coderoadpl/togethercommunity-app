import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
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

const renderHome = async (component: () => ReactNode = TenantHomePage) => {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component });
  const panelRoute = createRoute({ getParentRoute: () => rootRoute, path: '/panel', component: stub('PANEL') });
  const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: stub('LOGIN') });
  const startRoute = createRoute({ getParentRoute: () => rootRoute, path: '/start', component: stub('START') });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, panelRoute, loginRoute, startRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return { ...renderWithProviders(<RouterProvider router={router} />), router };
};

describe('TenantHomePage dispatcher', () => {
  it('redirects a staff member into the creator panel', async () => {
    server.use(http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })));
    await renderHome();
    expect(await screen.findByText('PANEL')).toBeInTheDocument();
  });

  it('redirects a member-only account to their start page', async () => {
    server.use(http.get('/api/me', () => HttpResponse.json({ ok: true, data: meMemberOnly })));
    await renderHome();
    expect(await screen.findByText('START')).toBeInTheDocument();
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

  it('offers the data reset only when the deployment reports a resettable environment', async () => {
    const withoutReset = async () => {
      server.use(
        http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithoutTenant })),
        http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
      );
      await renderHome();
      expect(await screen.findByText(pl.tenant.choose)).toBeInTheDocument();
    };
    await withoutReset();
    expect(screen.queryByTestId('platform-reset-open')).not.toBeInTheDocument();

    cleanup();
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithoutTenant })),
      http.get('/api/tenants', () => HttpResponse.json({
        ok: true,
        data: { ...tenantsBody, dataResetEnvironment: 'staging' },
      })),
    );
    await renderHome();

    expect(await screen.findByTestId('platform-reset-open')).toHaveTextContent(pl.platformReset.action);
  });

  it('renders the anonymous home on a tenant host instead of redirecting to sign in', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }, { status: 401 }),
      ),
    );

    const { router } = await renderHome(() => (
      <TenantHomePage hostname="acme.localhost" anonymousHome={<div>ANON</div>} />
    ));

    expect(await screen.findByText('ANON')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps the sign-in redirect on a tenant host without an anonymous surface', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }, { status: 401 }),
      ),
    );

    await renderHome(() => <TenantHomePage hostname="acme.localhost" />);

    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
  });

  it('keeps the sign-in redirect on the platform host even with an anonymous surface', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }, { status: 401 }),
      ),
    );

    const { router } = await renderHome(() => (
      <TenantHomePage hostname="localhost" anonymousHome={<div>ANON</div>} />
    ));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.queryByText('ANON')).not.toBeInTheDocument();
  });
});
