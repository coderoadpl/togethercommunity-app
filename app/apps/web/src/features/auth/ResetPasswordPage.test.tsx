import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ThemeModeProvider } from '../../theme-mode.js';
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
  return renderWithProviders(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
};

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

const expectSecondaryLink = (link: HTMLElement) => {
  const style = window.getComputedStyle(link);
  expect([style.fontSize, style.textDecorationLine, style.minHeight, style.minWidth]).toEqual([
    '0.875rem', 'underline', '44px', '44px',
  ]);
  const row = link.closest('p');
  if (row === null) throw new Error('expected the link to sit in a paragraph');
  expect(window.getComputedStyle(row).marginTop).toBe('1.5rem');
};

describe('ResetPasswordPage', () => {
  it('sizes the go-to-sign-in link as a 14px underlined 44px target after the form', async () => {
    await renderResetPage('?token=valid-token');

    expectSecondaryLink(screen.getByRole('link', { name: en.resetPassword.goToLogin }));
  });

  it('sits on the auth shell, signed once with the Together wordmark', async () => {
    await renderResetPage('?token=valid-token');

    expect(screen.getByTestId('auth-together-logo')).toHaveAttribute('alt', en.common.appName);
    expect(screen.getAllByTestId('language-switcher')).toHaveLength(1);
  });

  it('states the password minimum under the new password and describes the field with it', async () => {
    await renderResetPage('?token=valid-token');

    const hint = screen.getByText(en.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH }));
    expect(screen.getByTestId('reset-password')).toHaveAttribute('aria-describedby', hint.id);
  });

  it.each(['reset-password', 'reset-password-confirm'])(
    'reveals and hides %s with a pressed toggle that keeps the value and never submits',
    async (testId) => {
      let requested = false;
      server.use(http.post('*', () => {
        requested = true;
        return HttpResponse.json({ status: true });
      }));
      await renderResetPage('?token=valid-token');
      const field = screen.getByTestId(testId);
      const toggle = screen.getByTestId(`${field.id}-reveal`);
      await userEvent.type(field, VALID_PASSWORD);
      expect(toggle).toHaveAccessibleName(en.auth.showPassword);
      expect(toggle).toHaveAttribute('aria-controls', field.id);

      await userEvent.click(toggle);

      expect(field).toHaveAttribute('type', 'text');
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(field).toHaveValue(VALID_PASSWORD);
      expect(field).toHaveAttribute('autocomplete', 'new-password');

      await userEvent.click(toggle);

      expect(field).toHaveAttribute('type', 'password');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(field).toHaveValue(VALID_PASSWORD);
      expect(field).toHaveAttribute('autocomplete', 'new-password');
      expect(screen.queryByTestId('reset-password-confirm-error')).not.toBeInTheDocument();
      expect(screen.queryByTestId('reset-success')).not.toBeInTheDocument();
      expect(requested).toBe(false);
    },
  );

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

    const error = await screen.findByTestId('reset-password-confirm-error');
    const confirm = screen.getByTestId('reset-password-confirm');
    expect(error).toHaveTextContent(en.resetPassword.mismatch);
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(confirm).toHaveAttribute('aria-describedby', error.id);
    expect(confirm).toHaveFocus();
    expect(screen.getByTestId('reset-password')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('binds both empty field errors and focuses the new password first', async () => {
    let requested = false;
    server.use(http.post('*', () => {
      requested = true;
      return HttpResponse.json({ status: true });
    }));
    await renderResetPage('?token=valid-token');
    await userEvent.click(screen.getByTestId('reset-submit'));

    const password = screen.getByTestId('reset-password');
    const passwordError = await screen.findByTestId('reset-password-error');
    const confirmError = screen.getByTestId('reset-password-confirm-error');
    const hint = screen.getByText(en.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH }));
    expect(passwordError).toHaveTextContent(en.resetPassword.passwordRequired);
    expect(confirmError).toHaveTextContent(en.resetPassword.confirmRequired);
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-describedby', `${passwordError.id} ${hint.id}`);
    expect(screen.getByTestId('reset-password-confirm')).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });

  it('blocks a password below the shared minimum', async () => {
    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), 'short');
    await userEvent.type(screen.getByTestId('reset-password-confirm'), 'short');
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByTestId('reset-password-error')).toHaveTextContent(
      en.resetPassword.tooShort({ min: PASSWORD_MIN_LENGTH }),
    );
    expect(screen.getByTestId('reset-password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('reset-password')).toHaveFocus();
    expect(screen.getByTestId('reset-password-error')).not.toHaveTextContent('short');
  });

  it('guards a missing token before showing the password form', async () => {
    await renderResetPage('');

    expect(await screen.findByTestId('reset-invalid-token')).toHaveTextContent(
      en.resetPassword.missingToken,
    );
    expect(screen.queryByTestId('reset-password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.resetPassword.requestNewLink })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('handles the provider callback INVALID_TOKEN state with a new-link action', async () => {
    await renderResetPage('?error=INVALID_TOKEN');

    expect(await screen.findByTestId('reset-invalid-token')).toHaveTextContent(
      en.resetPassword.missingToken,
    );
    expect(screen.getByRole('link', { name: en.resetPassword.requestNewLink })).toHaveAttribute(
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
      en.resetPassword.missingToken,
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

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.messageValidation);
    expect(screen.getByTestId('reset-password')).toBeInTheDocument();
    expect(screen.getByTestId('reset-password')).toHaveAttribute('aria-invalid', 'false');
  });

  it('drops a previous provider error when the form is submitted again', async () => {
    server.use(http.post('*', () => HttpResponse.json(
      { code: 'PASSWORD_TOO_LONG', message: 'Password too long' },
      { status: 400 },
    )));
    await renderResetPage('?token=valid-token');
    await userEvent.type(screen.getByTestId('reset-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('reset-password-confirm'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('reset-submit'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.clear(screen.getByTestId('reset-password-confirm'));
    await userEvent.click(screen.getByTestId('reset-submit'));

    expect(await screen.findByTestId('reset-password-confirm-error')).toHaveTextContent(en.resetPassword.confirmRequired);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

    expect(await screen.findByRole('button', { name: en.resetPassword.submitPending })).toBeDisabled();
  });
});
