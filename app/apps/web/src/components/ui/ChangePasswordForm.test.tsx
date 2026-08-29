import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/password.js';

import { en } from '../../i18n/en.js';
import { LanguageProvider, type Language } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { languagePreference } from '../../theme-mode.js';
import { ChangePasswordForm } from './ChangePasswordForm.js';

const VALID_PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

const renderForm = (
  onSubmit = vi.fn(),
  error: Error | null = null,
  language: Language = 'pl',
) => {
  languagePreference.save(language);
  render(
    <LanguageProvider>
      <ChangePasswordForm
        pending={false}
        success={false}
        error={error}
        onSubmit={onSubmit}
      />
    </LanguageProvider>,
  );
  return onSubmit;
};

const fillPasswordChange = async (current: string, password: string, confirm: string) => {
  await userEvent.type(screen.getByTestId('change-current-password'), current);
  await userEvent.type(screen.getByTestId('change-new-password'), password);
  await userEvent.type(screen.getByTestId('change-confirm-password'), confirm);
};

describe('ChangePasswordForm', () => {
  it('renders the length-only policy in both languages', () => {
    renderForm(vi.fn(), null, 'pl');

    expect(
      screen.getByText(pl.changePassword.intro({ min: PASSWORD_MIN_LENGTH })),
    ).toBeInTheDocument();
    cleanup();

    renderForm(vi.fn(), null, 'en');

    expect(
      screen.getByText(en.changePassword.intro({ min: PASSWORD_MIN_LENGTH })),
    ).toBeInTheDocument();
  });

  it('blocks passwords below the shared minimum', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', 'short', 'short');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-local-error')).toHaveTextContent(
      pl.changePassword.tooShort({ min: PASSWORD_MIN_LENGTH }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks a mismatched confirmation', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', VALID_PASSWORD, 'other-password');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-local-error')).toHaveTextContent(
      pl.changePassword.mismatch,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits false when the revocation checkbox is untouched', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', VALID_PASSWORD, VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      currentPassword: 'current-password',
      newPassword: VALID_PASSWORD,
      revokeOtherSessions: false,
    });
  });

  it('submits true when the user checks the revocation checkbox', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', VALID_PASSWORD, VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-revoke-sessions'));
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      currentPassword: 'current-password',
      newPassword: VALID_PASSWORD,
      revokeOtherSessions: true,
    });
  });

  it('maps provider INVALID_PASSWORD to the localized current-password error', async () => {
    const providerError = Object.assign(new Error('Invalid password'), {
      appError: {
        code: 'validation',
        message: 'Invalid password',
        details: { providerCode: 'INVALID_PASSWORD' },
      },
    });
    renderForm(vi.fn(), providerError);

    expect(screen.getByTestId('change-password-remote-error')).toHaveTextContent(
      pl.changePassword.invalidCurrentPassword,
    );
  });
  it('keeps the submit button at content width', () => {
    renderForm();

    expect(screen.getByTestId('change-password-submit').parentElement)
      .toHaveStyle({ display: 'block' });
  });
});
