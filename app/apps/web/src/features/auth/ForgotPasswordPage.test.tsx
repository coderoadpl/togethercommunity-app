import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { anonymousMe, memberMe, server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { ForgotPasswordPage } from './ForgotPasswordPage.js';

const renderForgotPasswordPage = async () => {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div>Signed in home</div>,
  });
  const forgotPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    component: ForgotPasswordPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, forgotPasswordRoute]),
    history: createMemoryHistory({ initialEntries: ['/forgot-password'] }),
  });
  await router.load();
  return renderWithProviders(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
};

describe('ForgotPasswordPage', () => {
  it('redirects a signed-in tenant member to home', async () => {
    server.use(memberMe());

    await renderForgotPasswordPage();

    expect(await screen.findByText('Signed in home')).toBeInTheDocument();
  });

  it('sits on the auth shell, signed once with the Together wordmark', async () => {
    server.use(anonymousMe());

    await renderForgotPasswordPage();

    expect(screen.getByTestId('auth-together-logo')).toHaveAttribute('alt', 'Together');
    expect(screen.getAllByTestId('language-switcher')).toHaveLength(1);
  });

  it.each(['known@example.com', 'random-unknown@example.com'])(
    'shows the same neutral success for %s',
    async (email) => {
      let body: unknown;
      server.use(http.post('*', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          status: true,
          message: 'If this email exists in our system, check your email for the reset link',
        });
      }));
      server.use(anonymousMe());
      await renderForgotPasswordPage();

      await userEvent.type(screen.getByTestId('forgot-password-email'), email);
      await userEvent.click(screen.getByTestId('forgot-password-submit'));

      expect(await screen.findByTestId('forgot-password-success')).toHaveTextContent(
        pl.forgotPassword.successBody,
      );
      expect(body).toEqual({
        email,
        redirectTo: 'http://localhost:3000/reset-password',
      });
    },
  );

  it('validates the email before requesting a reset', async () => {
    server.use(anonymousMe());
    await renderForgotPasswordPage();
    await userEvent.type(screen.getByTestId('forgot-password-email'), 'not-an-email');
    fireEvent.submit(screen.getByTestId('forgot-password-form'));

    expect(await screen.findByRole('alert')).toHaveTextContent(pl.forgotPassword.invalidEmail);
  });

  it('disables submission while the provider request is pending', async () => {
    server.use(http.post('*', async () => {
      await delay('infinite');
      return HttpResponse.json({ status: true });
    }));
    server.use(anonymousMe());
    await renderForgotPasswordPage();

    await userEvent.type(screen.getByTestId('forgot-password-email'), 'member@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));

    expect(await screen.findByRole('button', { name: pl.forgotPassword.submitPending })).toBeDisabled();
  });

  it('shows a localized provider error and keeps the form available', async () => {
    server.use(http.post('*', () =>
      HttpResponse.json({ code: 'RESET_PASSWORD_DISABLED', message: 'Unavailable' }, { status: 400 })));
    server.use(anonymousMe());
    await renderForgotPasswordPage();

    await userEvent.type(screen.getByTestId('forgot-password-email'), 'member@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(pl.errors.messageValidation);
    expect(screen.getByTestId('forgot-password-email')).toBeInTheDocument();
  });
});
