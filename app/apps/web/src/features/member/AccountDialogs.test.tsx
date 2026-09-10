import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/index.js';
import { en } from '../../i18n/en.js';
import { ToastProvider } from '../../components/ui/Toast.js';
import { AuthenticationMethods, type AuthenticationMethodsProps } from '../../components/ui/AuthenticationMethods.js';
import { ChangePasswordForm } from '../../components/ui/ChangePasswordForm.js';
import { AccountNameFields } from './AccountNameFields.js';
import { AccountErasureCard } from './AccountErasureCard.js';
import { AccountSupportForm } from './AccountSupportForm.js';

vi.mock('qrcode', () => ({ toCanvas: vi.fn(() => Promise.resolve()) }));

const idle = { pending: false, success: false, error: null };
const failure = new Error('Service unavailable');
const enrollment = { totpURI: 'otpauth://totp/Together?secret=DEMO', backupCodes: ['demo-code'] };
const propsWith = (overrides: Partial<AuthenticationMethodsProps> = {}): AuthenticationMethodsProps => ({
  passkeys: { data: [{ id: 'demo', name: 'Laptop', createdAt: '2026-08-01' }], pending: false, error: null, retry: vi.fn() },
  registerPasskey: { ...idle, run: vi.fn() }, removePasskey: { ...idle, run: vi.fn() }, requestPasswordSetup: { ...idle, run: vi.fn() },
  enableTwoFactor: { ...idle, submittedAt: 0, data: undefined, run: vi.fn() }, verifyTotp: { ...idle, submittedAt: 0, run: vi.fn() },
  disableTwoFactor: { ...idle, submittedAt: 0, run: vi.fn() }, regenerateBackupCodes: { ...idle, submittedAt: 0, data: undefined, run: vi.fn() }, ...overrides,
});
const tree = (props: AuthenticationMethodsProps) => <LanguageProvider><ToastProvider><AuthenticationMethods {...props} /></ToastProvider></LanguageProvider>;
const fill = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } });

describe('Account dialogs', () => {
  it('opens password change, validates locally, submits the revocation choice and keeps provider errors inside', async () => {
    const onSubmit = vi.fn();
    render(<LanguageProvider><ToastProvider><ChangePasswordForm dialog {...idle} error={failure} onSubmit={onSubmit} /></ToastProvider></LanguageProvider>);
    expect(screen.queryByTestId('change-current-password')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('change-password-open'));
    fill('change-current-password', 'current-password'); fill('change-new-password', 'short'); fill('change-confirm-password', 'short');
    await userEvent.click(screen.getByTestId('change-password-submit'));
    expect(within(screen.getByRole('dialog')).getByTestId('change-password-local-error')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
    fill('change-new-password', 'new-password-long'); fill('change-confirm-password', 'new-password-long');
    await userEvent.click(screen.getByTestId('change-revoke-sessions'));
    await userEvent.click(screen.getByTestId('change-password-submit'));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ currentPassword: 'current-password', newPassword: 'new-password-long', revokeOtherSessions: true });
    expect(within(screen.getByRole('dialog')).getByTestId('change-password-remote-error')).toBeVisible();
  });

  it('opens passkey registration, requires proof and submits a trimmed name', async () => {
    const run = vi.fn();
    render(tree(propsWith({ registerPasskey: { ...idle, error: failure, run } })));
    expect(screen.queryByTestId('passkey-name')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('add-passkey-open'));
    expect(screen.getByTestId('add-passkey')).toBeDisabled();
    fill('passkey-name', ' Laptop '); fill('passkey-proof-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('add-passkey'));
    expect(run).toHaveBeenCalledExactlyOnceWith({ name: 'Laptop', password: 'fresh-password' });
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
  });

  it('requires fresh proof to remove a passkey and leaves errors in the confirmation', async () => {
    const run = vi.fn();
    render(tree(propsWith({ removePasskey: { ...idle, error: failure, run } })));
    await userEvent.click(screen.getByRole('button', { name: en.security.removePasskey }));
    expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();
    fill('remove-passkey-proof-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(run).toHaveBeenCalledExactlyOnceWith({ id: 'demo', password: 'fresh-password' });
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
  });

  it('keeps removal available after a successful removal and a failed registration', async () => {
    const props = propsWith();
    const view = render(tree(props));
    await userEvent.click(screen.getByRole('button', { name: en.security.removePasskey }));
    fill('remove-passkey-proof-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    view.rerender(tree({ ...props, removePasskey: { ...props.removePasskey, pending: true } }));
    const removed = { ...props, removePasskey: { ...props.removePasskey, success: true } };
    view.rerender(tree(removed));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('add-passkey-open'));
    fill('passkey-proof-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('add-passkey'));
    view.rerender(tree({ ...removed, registerPasskey: { ...props.registerPasskey, pending: true } }));
    view.rerender(tree({ ...removed, registerPasskey: { ...props.registerPasskey, error: failure } }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: en.security.removePasskey }));
    expect(screen.getByTestId('remove-passkey-proof-password')).toBeVisible();
    fill('remove-passkey-proof-password', 'new-proof');
    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(props.removePasskey.run).toHaveBeenLastCalledWith({ id: 'demo', password: 'new-proof' });
    view.rerender(tree({ ...removed, removePasskey: { ...props.removePasskey, pending: true } }));
    view.rerender(tree(removed));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes registration on success and allows another registration', async () => {
    const props = propsWith();
    const view = render(tree(props));
    await userEvent.click(screen.getByTestId('add-passkey-open'));
    fill('passkey-proof-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('add-passkey'));
    view.rerender(tree({ ...props, registerPasskey: { ...props.registerPasskey, success: true } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('add-passkey-open'));
    expect(screen.getByTestId('passkey-proof-password')).toHaveValue('');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('closes password change on success and can reopen after stale success or failure', async () => {
    const onSubmit = vi.fn();
    const passwordTree = (state: { pending: boolean; success: boolean; error: Error | null }) => (
      <LanguageProvider><ToastProvider><ChangePasswordForm dialog {...state} onSubmit={onSubmit} /></ToastProvider></LanguageProvider>
    );
    const view = render(passwordTree(idle));
    await userEvent.click(screen.getByTestId('change-password-open'));
    fill('change-current-password', 'current-password');
    fill('change-new-password', 'new-password-long');
    fill('change-confirm-password', 'new-password-long');
    await userEvent.click(screen.getByTestId('change-password-submit'));
    view.rerender(passwordTree({ ...idle, pending: true }));
    expect(screen.getByRole('dialog')).toBeVisible();
    view.rerender(passwordTree({ ...idle, success: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('change-password-open'));
    expect(screen.getByTestId('change-current-password')).toHaveValue('');
    view.rerender(passwordTree({ ...idle, pending: true }));
    view.rerender(passwordTree({ ...idle, error: failure }));
    expect(within(screen.getByRole('dialog')).getByTestId('change-password-remote-error')).toBeVisible();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('change-password-open'));
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('clears password values when a password change is dismissed', async () => {
    render(<LanguageProvider><ToastProvider><ChangePasswordForm dialog {...idle} onSubmit={vi.fn()} /></ToastProvider></LanguageProvider>);
    await userEvent.click(screen.getByTestId('change-password-open'));
    fill('change-current-password', 'current-password');
    fill('change-new-password', 'new-password-long');
    fill('change-confirm-password', 'new-password-long');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));
    await userEvent.click(screen.getByTestId('change-password-open'));
    expect(screen.getByTestId('change-current-password')).toHaveValue('');
    expect(screen.getByTestId('change-new-password')).toHaveValue('');
    expect(screen.getByTestId('change-confirm-password')).toHaveValue('');
  });

  it('advances enrollment through password, QR, verification, backup codes and done', async () => {
    const refresh = vi.fn();
    const props = propsWith({ onSecurityRefresh: refresh });
    const view = render(tree(props));
    expect(screen.queryByTestId('enable-2fa-password')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('enable-2fa-open'));
    expect(screen.getByTestId('enable-2fa')).toBeDisabled();
    fill('enable-2fa-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('enable-2fa'));
    expect(props.enableTwoFactor.run).toHaveBeenCalledExactlyOnceWith({ password: 'fresh-password' });

    const enabled = { ...props, enableTwoFactor: { ...props.enableTwoFactor, success: true, submittedAt: 1, data: enrollment } };
    view.rerender(tree(enabled));
    expect(await screen.findByTestId('two-factor-qr-code')).toBeVisible();
    expect(screen.getByTestId('totp-uri')).not.toBeVisible();
    await userEvent.click(screen.getByTestId('two-factor-manual-setup'));
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('DEMO');
    expect(screen.getByTestId('totp-uri')).toBeVisible();

    await userEvent.click(screen.getByTestId('two-factor-next'));
    expect(screen.getByTestId('verify-totp')).toBeDisabled();
    fill('verify-totp-code', '12ab3456');
    expect(props.verifyTotp.run).toHaveBeenCalledExactlyOnceWith({ code: '123456' });

    view.rerender(tree({ ...enabled, verifyTotp: { ...props.verifyTotp, submittedAt: 2, success: true } }));
    expect(await screen.findByTestId('backup-codes')).toHaveTextContent('demo-code');
    expect(screen.getByTestId('two-factor-finish')).toBeDisabled();
    await userEvent.click(screen.getByLabelText(en.security.backupCodesSaved));
    await userEvent.click(screen.getByTestId('two-factor-finish'));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByTestId('two-factor-done')).toBeVisible();

    await userEvent.click(screen.getByTestId('two-factor-done-close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByTestId('enable-2fa-password')).not.toBeInTheDocument();
    expect(screen.queryByTestId('totp-secret')).not.toBeInTheDocument();
    expect(screen.queryByTestId('totp-uri')).not.toBeInTheDocument();
  });
  it('keeps enrollment and verification errors on the relevant step', async () => {
    const props = propsWith({ enableTwoFactor: { ...idle, error: failure, submittedAt: 0, data: undefined, run: vi.fn() } });
    const view = render(tree(props));
    await userEvent.click(screen.getByTestId('enable-2fa-open'));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));

    const ready = { ...props, enableTwoFactor: { ...props.enableTwoFactor, error: null } };
    view.rerender(tree(ready));
    await userEvent.click(screen.getByTestId('enable-2fa-open'));
    fill('enable-2fa-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('enable-2fa'));
    const enabled = { ...ready, enableTwoFactor: { ...ready.enableTwoFactor, success: true, submittedAt: 1, data: enrollment } };
    view.rerender(tree(enabled));
    await userEvent.click(screen.getByTestId('two-factor-next'));
    view.rerender(tree({ ...enabled, verifyTotp: { ...props.verifyTotp, submittedAt: 2, error: failure } }));
    expect(screen.getByTestId('verify-totp-error')).toBeVisible();
    expect(screen.getByTestId('two-factor-step')).toHaveTextContent(en.security.wizardSteps.verify);
  });
  it('refreshes authoritative status when enrollment is dismissed after verification', async () => {
    const refresh = vi.fn();
    const props = propsWith({ onSecurityRefresh: refresh });
    const view = render(tree(props));
    await userEvent.click(screen.getByTestId('enable-2fa-open'));
    fill('enable-2fa-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('enable-2fa'));
    const enabled = { ...props, enableTwoFactor: { ...props.enableTwoFactor, success: true, submittedAt: 1, data: enrollment } };
    view.rerender(tree(enabled));
    await userEvent.click(await screen.findByTestId('two-factor-next'));
    fill('verify-totp-code', '123456');
    view.rerender(tree({ ...enabled, verifyTotp: { ...props.verifyTotp, submittedAt: 2, success: true } }));
    await screen.findByTestId('backup-codes');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));
    expect(refresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('provides a finish path when enrollment returns no backup codes', async () => {
    const refresh = vi.fn();
    const props = propsWith({ onSecurityRefresh: refresh });
    const view = render(tree(props));
    await userEvent.click(screen.getByTestId('enable-2fa-open'));
    fill('enable-2fa-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('enable-2fa'));
    const enabled = { ...props, enableTwoFactor: { ...props.enableTwoFactor, success: true, submittedAt: 1, data: { ...enrollment, backupCodes: [] } } };
    view.rerender(tree(enabled));
    await userEvent.click(await screen.findByTestId('two-factor-next'));
    fill('verify-totp-code', '123456');
    view.rerender(tree({ ...enabled, verifyTotp: { ...props.verifyTotp, submittedAt: 2, success: true } }));
    expect(await screen.findByTestId('two-factor-finish')).toBeEnabled();
    await userEvent.click(screen.getByTestId('two-factor-finish'));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByTestId('two-factor-done')).toBeVisible();
  });
  it('confirms disabling with password proof and refreshes authoritative status', async () => {
    const refresh = vi.fn();
    const props = propsWith({ twoFactorEnabled: true, onSecurityRefresh: refresh });
    const view = render(tree(props));
    await userEvent.click(screen.getByTestId('disable-2fa-open'));
    expect(screen.getByTestId('disable-2fa')).toBeDisabled();
    fill('enable-2fa-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('disable-2fa'));
    expect(props.disableTwoFactor.run).toHaveBeenCalledExactlyOnceWith({ password: 'fresh-password' });

    view.rerender(tree({ ...props, disableTwoFactor: { ...props.disableTwoFactor, pending: true } }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeVisible();
    view.rerender(tree({ ...props, disableTwoFactor: { ...props.disableTwoFactor, success: true, submittedAt: 1 } }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('regenerates backup codes after password confirmation', async () => {
    const props = propsWith({ twoFactorEnabled: true });
    const view = render(tree(props));
    await userEvent.click(screen.getByTestId('regenerate-backup-codes'));
    expect(screen.getByTestId('regenerate-backup-codes-confirm')).toBeDisabled();
    fill('enable-2fa-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('regenerate-backup-codes-confirm'));
    expect(props.regenerateBackupCodes.run).toHaveBeenCalledExactlyOnceWith({ password: 'fresh-password' });

    view.rerender(tree({ ...props, regenerateBackupCodes: { ...props.regenerateBackupCodes, success: true, submittedAt: 2, data: ['replacement'] } }));
    expect(await screen.findByTestId('backup-codes')).toHaveTextContent('replacement');
  });
  it.each([
    ['regenerate-backup-codes', 'regenerateBackupCodes'],
    ['disable-2fa-open', 'disableTwoFactor'],
  ] as const)('submits %s password confirmation with Enter', async (openTestId, operation) => {
    const run = vi.fn();
    const props = propsWith({
      twoFactorEnabled: true,
      [operation]: { ...propsWith()[operation], run },
    });
    render(tree(props));
    await userEvent.click(screen.getByTestId(openTestId));
    fill('enable-2fa-password', 'fresh-password');
    await userEvent.type(screen.getByTestId('enable-2fa-password'), '{Enter}');
    expect(run).toHaveBeenCalledExactlyOnceWith({ password: 'fresh-password' });
  });
  it('opens the name dialog and keeps save errors beside the field', async () => {
    const onSubmit = vi.fn();
    render(<LanguageProvider><AccountNameFields savedDisplayName="Ada" onCancel={vi.fn()} displayName="Ada" onChange={vi.fn()} pending={false} dirty error={failure} onSubmit={onSubmit} /></LanguageProvider>);
    await userEvent.click(screen.getByTestId('account-name-open'));
    await userEvent.click(screen.getByTestId('account-display-name-save'));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
  });

  it('opens support and keeps submit errors in the dialog', async () => {
    const onSubmit = vi.fn();
    render(<LanguageProvider><AccountSupportForm supportSubject="Help" supportBody="Details" onSubjectChange={vi.fn()} onBodyChange={vi.fn()} pending={false} error={failure} onSubmit={onSubmit} /></LanguageProvider>);
    await userEvent.click(screen.getByTestId('account-support-open'));
    await userEvent.click(screen.getByRole('button', { name: en.support.send }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ subject: 'Help', body: 'Details' });
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
  });

  it('keeps erasure validation and server errors inside its confirmation', async () => {
    const props = {
      request: null, pending: false, error: null, createPending: false, createError: failure,
      cancelPending: false, cancelError: null, email: 'demo@example.com', erasureConfirmEmail: 'wrong@example.com',
      onConfirmEmailChange: vi.fn(), onCreate: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn(),
    };
    const view = render(<LanguageProvider><AccountErasureCard {...props} /></LanguageProvider>);
    expect(screen.queryByLabelText(en.account.erasureConfirmLabel)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('account-erasure-open'));
    expect(screen.getByTestId('account-erasure-create')).toBeDisabled();
    view.rerender(<LanguageProvider><AccountErasureCard {...props} erasureConfirmEmail="demo@example.com" /></LanguageProvider>);
    await userEvent.click(screen.getByTestId('account-erasure-create'));
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith({ confirmEmail: 'demo@example.com' });
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
  });
});
