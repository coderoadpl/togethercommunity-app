import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ResetPasswordPage } from './ResetPasswordPage.js';

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
    server.use(http.post('*', () => HttpResponse.json({ status: true })));

    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), 'newpassword123');
    await userEvent.type(screen.getByTestId('reset-password-confirm'), 'newpassword123');
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByTestId('reset-success')).toBeInTheDocument();
  });

  it('blocks submission when the two passwords do not match', async () => {
    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), 'newpassword123');
    await userEvent.type(screen.getByTestId('reset-password-confirm'), 'different123');
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByTestId('reset-local-error')).toHaveTextContent(pl.resetPassword.mismatch);
  });

  it('guards a missing token before showing the password form', async () => {
    await renderResetPage('');

    expect(await screen.findByTestId('reset-missing-token')).toHaveTextContent(
      pl.resetPassword.missingToken,
    );
    expect(screen.queryByTestId('reset-password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.resetPassword.goToLogin })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
