import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ResetPasswordPage } from './ResetPasswordPage.js';

const VALID_PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

const renderResetPage = async (search: string) => {
  window.history.replaceState({}, '', `/reset-password${search}`);
  const rootRoute = createRootRoute({ component: ResetPasswordPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/reset-password'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('ResetPasswordPage', () => {
  it('resets the password and shows a success state on the happy path', async () => {
    let body: unknown;
    server.use(http.post('*', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ status: true });
    }));

    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('reset-password-confirm'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByTestId('reset-success')).toBeInTheDocument();
    expect(body).toEqual({ token: 'valid-token', newPassword: VALID_PASSWORD });
  });

  it('blocks submission when the two passwords do not match', async () => {
    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('reset-password-confirm'), 'different123');
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByTestId('reset-local-error')).toHaveTextContent(pl.resetPassword.mismatch);
  });

  it('blocks a password below the shared minimum', async () => {
    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), 'short');
    await userEvent.type(screen.getByTestId('reset-password-confirm'), 'short');
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByTestId('reset-local-error')).toHaveTextContent(
      pl.resetPassword.tooShort({ min: PASSWORD_MIN_LENGTH }),
    );
  });

  it('guards a missing token before showing the password form', async () => {
    await renderResetPage('');

    expect(await screen.findByTestId('reset-invalid-token')).toHaveTextContent(
      pl.resetPassword.missingToken,
    );
    expect(screen.queryByTestId('reset-password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.resetPassword.requestNewLink })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('handles the provider callback INVALID_TOKEN state with a new-link action', async () => {
    await renderResetPage('?error=INVALID_TOKEN');

    expect(await screen.findByTestId('reset-invalid-token')).toHaveTextContent(
      pl.resetPassword.missingToken,
    );
    expect(screen.getByRole('link', { name: pl.resetPassword.requestNewLink })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('handles a consumed token returned by the provider', async () => {
    server.use(http.post('*', () => HttpResponse.json(
      { code: 'INVALID_TOKEN', message: 'Invalid token' },
      { status: 400 },
    )));
    await renderResetPage('?token=consumed-token');
    await userEvent.type(screen.getByTestId('reset-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('reset-password-confirm'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByTestId('reset-invalid-token')).toHaveTextContent(
      pl.resetPassword.missingToken,
    );
  });

  it('shows a localized non-token provider error and keeps the form available', async () => {
    server.use(http.post('*', () => HttpResponse.json(
      { code: 'PASSWORD_TOO_LONG', message: 'Password too long' },
      { status: 400 },
    )));
    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('reset-password-confirm'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(pl.errors.messageValidation);
    expect(screen.getByTestId('reset-password')).toBeInTheDocument();
  });

  it('disables submission while the provider reset is pending', async () => {
    server.use(http.post('*', async () => {
      await delay('infinite');
      return HttpResponse.json({ status: true });
    }));
    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('reset-password-confirm'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByRole('button', { name: pl.resetPassword.submitPending })).toBeDisabled();
  });
});
