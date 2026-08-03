import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { RegisterPage } from './RegisterPage.js';

const HomeAfterRegistration = () => <div>Home after registration</div>;

const renderRegisterPage = async (hostname?: string) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomeAfterRegistration,
  });
  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/register',
    component: () =>
      hostname === undefined ? <RegisterPage /> : <RegisterPage hostname={hostname} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, registerRoute]),
    history: createMemoryHistory({ initialEntries: ['/register'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const tenantOffer = (legal: { termsUrl: string | null; privacyUrl: string | null }) => ({
  tenant: { slug: 'akademia', name: 'Akademia', legal },
  contentVersion: 1,
  products: [],
});

const noTenantOffer = http.get('/api/public/offer', () =>
  HttpResponse.json(
    { ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } },
    { status: 404 },
  ));

describe('RegisterPage', () => {
  it('blocks a password below the shared minimum', async () => {
    let requested = false;
    server.use(
      noTenantOffer,
      http.post('*', () => {
        requested = true;
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(pl.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(pl.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(pl.auth.passwordLabel), 'short');
    await userEvent.click(screen.getByRole('button', { name: pl.auth.createAccount }));

    expect(await screen.findByText(pl.auth.passwordTooShort({ min: 8 }))).toBeInTheDocument();
    expect(requested).toBe(false);
  });

  it('creates an account and lands on home', async () => {
    server.use(
      noTenantOffer,
      http.post('*', () => HttpResponse.json({ user: { id: 'u1' } })),
    );

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(pl.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(pl.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(pl.auth.passwordLabel), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: pl.auth.createAccount }));

    expect(await screen.findByText('Home after registration')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('lands on home when a tenant offer resolves on the bare host', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({ ok: true, data: tenantOffer({ termsUrl: null, privacyUrl: null }) }),
      ),
      http.post('*', () => HttpResponse.json({ user: { id: 'u1' } })),
    );

    await renderRegisterPage('localhost');
    await userEvent.type(screen.getByLabelText(pl.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(pl.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(pl.auth.passwordLabel), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: pl.auth.createAccount }));

    expect(await screen.findByText('Home after registration')).toBeInTheDocument();
  });

  it('requires accepting configured documents and submits consent with signup', async () => {
    const signupBodies: unknown[] = [];
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: tenantOffer({
            termsUrl: 'https://akademia.test/regulamin',
            privacyUrl: 'https://akademia.test/prywatnosc',
          }),
        }),
      ),
      http.post('*', async ({ request }) => {
        signupBodies.push(await request.json());
        return HttpResponse.json({ user: { id: 'u1' } });
      }),
    );

    await renderRegisterPage('akademia.localhost');

    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).toBeRequired();
    expect(screen.getByRole('link', { name: pl.consent.terms })).toHaveAttribute(
      'href',
      'https://akademia.test/regulamin',
    );
    expect(screen.getByRole('link', { name: pl.consent.privacy })).toHaveAttribute(
      'href',
      'https://akademia.test/prywatnosc',
    );

    await userEvent.type(screen.getByLabelText(pl.auth.nameLabel), 'New Member');
    await userEvent.type(screen.getByLabelText(pl.auth.emailLabel), 'member@together.dev');
    await userEvent.type(screen.getByLabelText(pl.auth.passwordLabel), 'demo1234');
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: pl.auth.createAccount }));

    expect(await screen.findByText(pl.auth.registeredTitle)).toBeInTheDocument();
    expect(signupBodies).toEqual([
      {
        name: 'New Member',
        email: 'member@together.dev',
        password: 'demo1234',
        termsAccepted: true,
      },
    ]);
  });

  it('shows no consent checkbox on a tenant without configured documents', async () => {
    server.use(
      http.get('/api/public/offer', () =>
        HttpResponse.json({ ok: true, data: tenantOffer({ termsUrl: null, privacyUrl: null }) }),
      ),
    );

    await renderRegisterPage();

    expect(await screen.findByLabelText(pl.auth.nameLabel)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
