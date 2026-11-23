import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { en } from '../../i18n/en.js';
import { ToastProvider } from './Toast.js';
import {
  AuthenticationMethods,
  type AuthenticationMethodsProps,
} from './AuthenticationMethods.js';

const idle = { pending: false, success: false, error: null };

const propsWith = (
  overrides: Partial<AuthenticationMethodsProps> = {},
): AuthenticationMethodsProps => ({
  presentation: 'embedded',
  passkeys: { data: [], pending: false, error: null, retry: vi.fn() },
  registerPasskey: { ...idle, run: vi.fn() },
  removePasskey: { ...idle, run: vi.fn() },
  requestPasswordSetup: { ...idle, run: vi.fn() },
  enableTwoFactor: { ...idle, data: undefined, submittedAt: 0, run: vi.fn() },
  verifyTotp: { ...idle, submittedAt: 0, run: vi.fn() },
  disableTwoFactor: { ...idle, submittedAt: 0, run: vi.fn() },
  regenerateBackupCodes: { ...idle, data: undefined, submittedAt: 0, run: vi.fn() },
  ...overrides,
});

const renderMethods = (props: AuthenticationMethodsProps) => render(
  <LanguageProvider>
    <ToastProvider>
      <AuthenticationMethods {...props} />
    </ToastProvider>
  </LanguageProvider>,
);

describe('AuthenticationMethods', () => {
  it('keeps two-factor operations visible and reachable without a disclosure', async () => {
    const run = vi.fn();
    renderMethods(propsWith({ enableTwoFactor: { ...idle, data: undefined, submittedAt: 0, run } }));
    const enable = screen.getByRole('button', { name: en.security.enableTwoFactor });
    expect(enable.closest('details')).toBeNull();
    expect(enable).toBeVisible();
    await userEvent.type(screen.getByLabelText(en.security.accountPasswordLabel), 'fresh-password');
    await userEvent.click(enable);
    expect(run).toHaveBeenCalledExactlyOnceWith({ password: 'fresh-password' });
  });

  it('keeps panel authentication sections unboxed and their operations expanded', () => {
    const view = renderMethods(propsWith({ presentation: 'embedded' }));
    expect(view.container.querySelector('.MuiPaper-root')).toBeNull();
    expect(screen.getByRole('heading', { name: en.security.passkeys })).toBeVisible();
    expect(screen.getByRole('heading', { name: en.security.twoFactor })).toBeVisible();
    expect(screen.getByTestId('passkey-set-password').closest('details')).toBeNull();
    expect(screen.getByTestId('enable-2fa').closest('details')).toBeNull();
  });

  it('does not invent a persisted two-factor status from successful verification', () => {
    renderMethods(propsWith({ verifyTotp: { ...idle, submittedAt: 0, success: true, run: vi.fn() } }));
    expect(screen.getByText(en.security.twoFactorStatusUnknown)).toBeInTheDocument();
  });

  it('identifies incomplete enrollment without calling it enabled', () => {
    renderMethods(propsWith({ enableTwoFactor: { ...idle, success: true, data: { totpURI: 'otpauth://totp/Together', backupCodes: ['demo-once-code'] }, submittedAt: 1, run: vi.fn() } }));
    expect(screen.getByText(en.security.twoFactorStatusIncomplete)).toBeInTheDocument();
  });

  it('keeps passkey add and removal confirmation disabled without a password', async () => {
    const props = propsWith({
      passkeys: {
        data: [{ id: 'passkey-1', name: 'Laptop', createdAt: '2026-08-01T10:00:00.000Z' }],
        pending: false,
        error: null,
        retry: vi.fn(),
      },
    });
    renderMethods(props);

    expect(screen.getByTestId('add-passkey')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: en.security.removePasskey }));
    expect(screen.getByRole('button', { name: en.security.confirmRemovePasskey })).toBeDisabled();
  });

  it('offers password setup before passkey management', async () => {
    const requestPasswordSetup = vi.fn();
    renderMethods(propsWith({
      requestPasswordSetup: { ...idle, run: requestPasswordSetup },
    }));

    expect(screen.getByText(en.security.passkeyPasswordlessHint)).toBeInTheDocument();
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
        retry: vi.fn(),
      },
      removePasskey: { ...idle, run: remove },
    });
    renderMethods(props);

    await userEvent.type(screen.getByLabelText(en.security.passkeyPasswordLabel), 'current-password');
    await userEvent.click(screen.getByRole('button', { name: en.security.removePasskey }));
    await userEvent.click(screen.getByRole('button', { name: en.security.confirmRemovePasskey }));

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
  });
  it('wraps the two-factor action row instead of stretching its buttons', () => {
    renderMethods(propsWith());

    const row = screen.getByTestId('enable-2fa').parentElement;
    expect(row).toHaveStyle({ flexWrap: 'wrap' });
    expect(screen.getByTestId('regenerate-backup-codes').parentElement).toBe(row);
    expect(screen.getByTestId('disable-2fa').parentElement).toBe(row);
  });

  it('offers a password link instead of two-factor enrollment to a passwordless account', async () => {
    const requestPasswordSetup = vi.fn();
    renderMethods(propsWith({
      presentation: 'account',
      hasPassword: false,
      requestPasswordSetup: { ...idle, run: requestPasswordSetup },
    }));

    expect(screen.queryByTestId('enable-2fa-open')).not.toBeInTheDocument();
    expect(screen.getByText(en.security.twoFactorNeedsPassword)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: en.security.setOrResetPassword }));

    expect(requestPasswordSetup).toHaveBeenCalledOnce();
  });

  it('keeps two-factor enrollment for an account with a password', () => {
    renderMethods(propsWith({ presentation: 'account', hasPassword: true }));

    expect(screen.getByTestId('enable-2fa-open')).toBeVisible();
    expect(screen.queryByTestId('two-factor-needs-password')).not.toBeInTheDocument();
  });

  it('replaces the passkey form with the password link when the account has no password', async () => {
    const requestPasswordSetup = vi.fn();
    renderMethods(propsWith({ presentation: 'account', hasPassword: false, requestPasswordSetup: { ...idle, run: requestPasswordSetup } }));
    await userEvent.click(screen.getByTestId('add-passkey-open'));

    const body = screen.getByTestId('passkey-passwordless');
    expect(body.closest('details')).toBeNull();
    expect(body).toHaveTextContent(en.security.passkeyPasswordlessHint);
    const setup = screen.getByTestId('passkey-set-password');
    expect(setup).toHaveTextContent(en.security.setOrResetPassword);
    expect(setup).toHaveFocus();
    expect(screen.queryByTestId('passkey-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('passkey-proof-password')).not.toBeInTheDocument();
    expect(screen.queryByTestId('passkey-help')).not.toBeInTheDocument();
    await userEvent.click(setup);
    expect(requestPasswordSetup).toHaveBeenCalledOnce();
  });

  it('shows a password link error only beside the passwordless button that sent it', async () => {
    const failure = new Error('password link failed');
    renderMethods(propsWith({ presentation: 'account', hasPassword: false, requestPasswordSetup: { ...idle, error: failure, run: vi.fn() } }));
    expect(screen.queryByTestId('two-factor-set-password-error')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('two-factor-set-password'));
    expect(screen.getByTestId('two-factor-set-password-error')).toBeVisible();

    await userEvent.click(screen.getByTestId('add-passkey-open'));
    expect(screen.queryByTestId('passkey-set-password-error')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('passkey-set-password'));
    expect(screen.getByTestId('passkey-set-password-error')).toBeVisible();
    expect(screen.queryByTestId('two-factor-set-password-error')).not.toBeInTheDocument();
  });

  it('keeps the password hint inside the passkey help when the account has a password', async () => {
    renderMethods(propsWith({ presentation: 'account', hasPassword: true }));
    await userEvent.click(screen.getByTestId('add-passkey-open'));

    expect(screen.getByTestId('passkey-passwordless').closest('details')).not.toBeNull();
  });
});
