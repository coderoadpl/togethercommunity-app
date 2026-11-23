import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/password.js';

import { en } from '../../i18n/en.js';
import { LanguageProvider, useLanguage, type Language } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { languagePreference } from '../../theme-mode.js';
import { ChangePasswordForm } from './ChangePasswordForm.js';
import { ToastProvider } from './Toast.js';

const VALID_PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

const renderForm = (
  onSubmit = vi.fn(),
  error: Error | null = null,
  language: Language = 'en',
) => {
  languagePreference.save(language);
  render(
    <LanguageProvider>
      <ToastProvider>
        <ChangePasswordForm
          pending={false}
          success={false}
          error={error}
          onSubmit={onSubmit}
        />
      </ToastProvider>
    </LanguageProvider>,
  );
  return onSubmit;
};

const SwitchToPolish = () => {
  const { setLanguage } = useLanguage();
  return <button type="button" data-testid="switch-language" onClick={() => setLanguage('pl')}>switch</button>;
};

const renderDialogForm = (onSubmit = vi.fn()) => {
  languagePreference.save('en');
  render(
    <LanguageProvider>
      <ToastProvider>
        <SwitchToPolish />
        <ChangePasswordForm
          dialog
          revokeOtherSessionsByDefault
          pending={false}
          success={false}
          error={null}
          onSubmit={onSubmit}
        />
      </ToastProvider>
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
      screen.getByText(pl.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH })),
    ).toBeInTheDocument();
    cleanup();

    renderForm(vi.fn(), null, 'en');

    expect(
      screen.getByText(en.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH })),
    ).toBeInTheDocument();
  });

  it('blocks passwords below the shared minimum', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', 'short', 'short');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-local-error')).toHaveTextContent(
      en.changePassword.tooShort({ min: PASSWORD_MIN_LENGTH }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks a mismatched confirmation', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', VALID_PASSWORD, 'other-password');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-local-error')).toHaveTextContent(
      en.changePassword.mismatch,
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

  it('attaches the too-short error to the new password field', async () => {
    renderForm();
    await fillPasswordChange('current-password', 'short', 'short');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    const field = screen.getByTestId('change-new-password');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(`${en.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH })} ${en.changePassword.tooShort({ min: PASSWORD_MIN_LENGTH })}`);
    expect(screen.getByTestId('change-confirm-password')).toHaveAttribute('aria-invalid', 'false');
  });

  it('attaches the mismatch error to the confirmation field', async () => {
    renderForm();
    await fillPasswordChange('current-password', VALID_PASSWORD, 'other-password');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    const field = screen.getByTestId('change-confirm-password');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(en.changePassword.mismatch);
    expect(screen.getByTestId('change-new-password')).toHaveAttribute('aria-invalid', 'false');
  });

  it('clears the too-short error once the new password changes', async () => {
    renderForm();
    await fillPasswordChange('current-password', 'short', 'short');
    await userEvent.click(screen.getByTestId('change-password-submit'));
    expect(screen.getByTestId('change-password-local-error')).toBeVisible();

    await userEvent.type(screen.getByTestId('change-confirm-password'), 'x');
    expect(screen.getByTestId('change-password-local-error')).toBeVisible();
    await userEvent.type(screen.getByTestId('change-new-password'), 'x');
    expect(screen.queryByTestId('change-password-local-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('change-new-password')).toHaveAttribute('aria-invalid', 'false');
  });

  it('clears the mismatch error once either new password field changes', async () => {
    renderForm();
    await fillPasswordChange('current-password', VALID_PASSWORD, 'other-password');
    await userEvent.click(screen.getByTestId('change-password-submit'));
    expect(screen.getByTestId('change-password-local-error')).toBeVisible();

    await userEvent.type(screen.getByTestId('change-current-password'), 'x');
    expect(screen.getByTestId('change-password-local-error')).toBeVisible();
    await userEvent.type(screen.getByTestId('change-confirm-password'), 'x');
    expect(screen.queryByTestId('change-password-local-error')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('change-password-submit'));
    expect(screen.getByTestId('change-password-local-error')).toBeVisible();
    await userEvent.type(screen.getByTestId('change-new-password'), 'x');
    expect(screen.queryByTestId('change-password-local-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('change-confirm-password')).toHaveAttribute('aria-invalid', 'false');
  });

  it('describes the revocation checkbox with its scope hint', () => {
    renderForm();

    expect(screen.getByRole('checkbox', { name: en.changePassword.revokeOtherSessions })).toHaveAccessibleDescription(en.changePassword.revokeScopeHint);
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
      en.changePassword.invalidCurrentPassword,
    );
  });
  it('restores the configured revocation default when the dialog opens again after a cancel', async () => {
    renderDialogForm();
    await userEvent.click(screen.getByTestId('change-password-open'));
    expect(screen.getByRole('checkbox', { name: en.changePassword.revokeOtherSessions })).toBeChecked();

    await userEvent.click(screen.getByRole('checkbox', { name: en.changePassword.revokeOtherSessions }));
    expect(screen.getByRole('checkbox', { name: en.changePassword.revokeOtherSessions })).not.toBeChecked();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('change-password-open'));
    expect(screen.getByRole('checkbox', { name: en.changePassword.revokeOtherSessions })).toBeChecked();
  });

  it('shows a visible validation error in the newly chosen language', async () => {
    renderDialogForm();
    await userEvent.click(screen.getByTestId('change-password-open'));
    await fillPasswordChange('current-password', 'short', 'short');
    await userEvent.click(screen.getByTestId('change-password-submit'));
    expect(screen.getByTestId('change-password-local-error')).toHaveTextContent(
      en.changePassword.tooShort({ min: PASSWORD_MIN_LENGTH }),
    );

    await userEvent.click(screen.getByTestId('switch-language'));

    expect(screen.getByTestId('change-password-local-error')).toHaveTextContent(
      pl.changePassword.tooShort({ min: PASSWORD_MIN_LENGTH }),
    );
  });

  it('keeps the submit button at content width', () => {
    renderForm();

    expect(screen.getByTestId('change-password-submit').parentElement)
      .toHaveStyle({ display: 'block' });
  });
});
