import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import {
  AuthenticationMethods,
  type AuthenticationMethodsProps,
} from './AuthenticationMethods.js';

const idle = { pending: false, success: false, error: null };

const propsWith = (
  overrides: Partial<AuthenticationMethodsProps> = {},
): AuthenticationMethodsProps => ({
  passkeys: { data: [], pending: false, error: null },
  registerPasskey: { ...idle, run: vi.fn() },
  removePasskey: { ...idle, run: vi.fn() },
  requestPasswordSetup: { ...idle, run: vi.fn() },
  enableTwoFactor: { ...idle, data: undefined, submittedAt: 0, run: vi.fn() },
  verifyTotp: { ...idle, run: vi.fn() },
  disableTwoFactor: { ...idle, submittedAt: 0, run: vi.fn() },
  regenerateBackupCodes: { ...idle, data: undefined, submittedAt: 0, run: vi.fn() },
  ...overrides,
});

const renderMethods = (props: AuthenticationMethodsProps) => render(
  <LanguageProvider>
    <AuthenticationMethods {...props} />
  </LanguageProvider>,
);

describe('AuthenticationMethods', () => {
  it('keeps passkey add and removal confirmation disabled without a password', async () => {
    const props = propsWith({
      passkeys: {
        data: [{ id: 'passkey-1', name: 'Laptop', createdAt: '2026-08-01T10:00:00.000Z' }],
        pending: false,
        error: null,
      },
    });
    renderMethods(props);

    expect(screen.getByTestId('add-passkey')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: pl.security.removePasskey }));
    expect(screen.getByRole('button', { name: pl.security.confirmRemovePasskey })).toBeDisabled();
  });

  it('offers password setup before passkey management', async () => {
    const requestPasswordSetup = vi.fn();
    renderMethods(propsWith({
      requestPasswordSetup: { ...idle, run: requestPasswordSetup },
    }));

    expect(screen.getByText(pl.security.passkeyPasswordlessHint)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('passkey-set-password'));

    expect(requestPasswordSetup).toHaveBeenCalledOnce();
  });

  it('passes a fresh password into passkey removal', async () => {
    const remove = vi.fn();
    const props = propsWith({
      passkeys: {
        data: [{ id: 'passkey-1', name: 'Laptop', createdAt: '2026-08-01T10:00:00.000Z' }],
        pending: false,
        error: null,
      },
      removePasskey: { ...idle, run: remove },
    });
    renderMethods(props);

    await userEvent.type(screen.getByLabelText(pl.security.passkeyPasswordLabel), 'current-password');
    await userEvent.click(screen.getByRole('button', { name: pl.security.removePasskey }));
    await userEvent.click(screen.getByRole('button', { name: pl.security.confirmRemovePasskey }));

    expect(remove).toHaveBeenCalledExactlyOnceWith({
      id: 'passkey-1',
      password: 'current-password',
    });
  });

  it('shows replacement backup codes and states that old codes are invalidated', () => {
    renderMethods(propsWith({
      regenerateBackupCodes: {
        ...idle,
        success: true,
        data: ['once-one', 'once-two'],
        submittedAt: 2,
        run: vi.fn(),
      },
    }));

    expect(screen.getByText('once-one')).toBeInTheDocument();
    expect(screen.getByText('once-two')).toBeInTheDocument();
    expect(screen.getByTestId('backup-codes-regenerated')).toHaveTextContent(
      pl.security.backupCodesRegenerated,
    );
  });

  it('hides issued backup codes after a later successful two-factor disable', () => {
    renderMethods(propsWith({
      enableTwoFactor: {
        ...idle,
        success: true,
        data: { totpURI: 'otpauth://totp/Together', backupCodes: ['stale-code'] },
        submittedAt: 1,
        run: vi.fn(),
      },
      disableTwoFactor: {
        ...idle,
        success: true,
        submittedAt: 2,
        run: vi.fn(),
      },
    }));

    expect(screen.queryByText('stale-code')).not.toBeInTheDocument();
    expect(screen.getByTestId('two-factor-disabled')).toBeInTheDocument();
  });
});
