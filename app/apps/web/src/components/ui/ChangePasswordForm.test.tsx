import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { ChangePasswordForm } from './ChangePasswordForm.js';

const renderForm = (onSubmit = vi.fn()) => {
  render(
    <LanguageProvider>
      <ChangePasswordForm
        minPasswordLength={8}
        pending={false}
        success={false}
        error={null}
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
  it('blocks passwords below the shared minimum', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', 'short', 'short');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-local-error')).toHaveTextContent(
      pl.changePassword.tooShort({ min: 8 }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks a mismatched confirmation', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', 'new-password', 'other-password');
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-local-error')).toHaveTextContent(
      pl.changePassword.mismatch,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits every password-change option', async () => {
    const onSubmit = renderForm();
    await fillPasswordChange('current-password', 'new-password', 'new-password');
    await userEvent.click(screen.getByTestId('change-revoke-sessions'));
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      revokeOtherSessions: false,
    });
  });
});
