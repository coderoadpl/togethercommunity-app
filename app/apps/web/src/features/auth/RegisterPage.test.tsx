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

const renderRegisterPage = async () => {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomeAfterRegistration,
  });
  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/register',
    component: RegisterPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, registerRoute]),
    history: createMemoryHistory({ initialEntries: ['/register'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('RegisterPage', () => {
  it('creates an account and lands on home', async () => {
    server.use(http.post('*', () => HttpResponse.json({ user: { id: 'u1' } })));

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText(pl.auth.nameLabel), 'New Creator');
    await userEvent.type(screen.getByLabelText(pl.auth.emailLabel), 'new@together.dev');
    await userEvent.type(screen.getByLabelText(pl.auth.passwordLabel), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: pl.auth.createAccount }));

    expect(await screen.findByText('Home after registration')).toBeInTheDocument();
  });
});
