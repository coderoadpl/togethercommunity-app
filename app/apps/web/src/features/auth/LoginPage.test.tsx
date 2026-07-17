import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { LoginPage } from './LoginPage.js';

const stubAuthConfig = (exposeMagicLinks = false) =>
  server.use(
    http.get('*/api/public/auth-config', () =>
      HttpResponse.json({
        ok: true,
        data: { googleEnabled: false, passkeysEnabled: true, totpEnabled: true, exposeMagicLinks },
      }),
    ),
  );

const renderLoginPage = async (exposeMagicLinks = false) => {
  stubAuthConfig(exposeMagicLinks);
  const rootRoute = createRootRoute({ component: LoginPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const fillCredentials = async () => {
  await userEvent.type(screen.getByLabelText(pl.auth.emailLabel), 'creator@together.dev');
  await userEvent.type(screen.getByLabelText(pl.auth.passwordLabel), 'wrong-password');
};

describe('LoginPage', () => {
  it('renders labeled login inputs', async () => {
    await renderLoginPage();

    expect(screen.getByLabelText(pl.auth.emailLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.auth.passwordLabel)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.auth.signInIdle })).toBeInTheDocument();
    expect(screen.queryByText('creator@together.dev')).not.toBeInTheDocument();
  });

  it('shows demo credentials only when dev magic-link exposure is enabled', async () => {
    await renderLoginPage(true);

    expect(await screen.findByText('creator@together.dev')).toBeInTheDocument();
    expect(screen.getByText('demo1234')).toBeInTheDocument();
  });

  it('swaps the form for a magic-link confirmation after requesting a link', async () => {
    server.use(
      http.post('*', () => HttpResponse.json({ status: true })),
      http.get('*/api/dev/magic-link', () =>
        HttpResponse.json({
          ok: true,
          data: {
            magicLink: {
              email: 'member@example.com',
              url: 'https://studio.test/magic',
              token: 'magic-token',
            },
          },
        }),
      ),
    );

    await renderLoginPage();
    await userEvent.type(screen.getByLabelText(pl.auth.magicLinkEmailLabel), 'member@example.com');
    await userEvent.click(screen.getByRole('button', { name: pl.auth.magicLinkIdle }));

    expect(await screen.findByTestId('magic-link-sent')).toHaveTextContent(
      pl.auth.magicLinkRequestedBody({ email: 'member@example.com' }),
    );
    expect(screen.queryByLabelText(pl.auth.passwordLabel)).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: pl.auth.openMagicLink })).toHaveAttribute(
      'href',
      'https://studio.test/magic',
    );
  });

  it('renders the AppError from a failed sign-in mutation', async () => {
    server.use(
      http.post('*', () =>
        HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 }),
      ),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: pl.auth.signInIdle }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(pl.errors.messageInvalidCredentials);
    expect(alert).not.toHaveTextContent(pl.errors.messageUnauthorized);
  });

  it('disables submit while the sign-in mutation is pending', async () => {
    server.use(
      http.post('*', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: pl.auth.signInIdle }));

    expect(await screen.findByRole('button', { name: pl.auth.signInPending })).toBeDisabled();
  });
});
