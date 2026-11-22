import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/index.js';
import { en } from '../../i18n/en.js';
import { ToastProvider } from '../../components/ui/Toast.js';
import { AuthenticationMethods, type AuthenticationMethodsProps } from '../../components/ui/AuthenticationMethods.js';
import { ChangePasswordForm } from '../../components/ui/ChangePasswordForm.js';
import { AccountNameFields } from './AccountNameFields.js';
import { ERASURE_REQUEST_RESPONSE_DAYS } from '#core/domain/index.js';
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

  it('checks the revocation box by default when asked and submits the cleared choice', async () => {
    const onSubmit = vi.fn();
    render(<LanguageProvider><ToastProvider><ChangePasswordForm dialog revokeOtherSessionsByDefault {...idle} onSubmit={onSubmit} /></ToastProvider></LanguageProvider>);
    await userEvent.click(screen.getByTestId('change-password-open'));
    expect(screen.getByRole('checkbox', { name: en.changePassword.revokeOtherSessions })).toBeChecked();
    fill('change-current-password', 'current-password'); fill('change-new-password', 'new-password-long'); fill('change-confirm-password', 'new-password-long');
    await userEvent.click(screen.getByTestId('change-revoke-sessions'));
    await userEvent.click(screen.getByTestId('change-password-submit'));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ currentPassword: 'current-password', newPassword: 'new-password-long', revokeOtherSessions: false });
  });

  it('focuses the first field when each account dialog opens', async () => {
    const first = render(<LanguageProvider><AccountNameFields savedDisplayName="Ada" onCancel={vi.fn()} displayName="Ada" onChange={vi.fn()} pending={false} dirty={false} /></LanguageProvider>);
    await userEvent.click(screen.getByTestId('account-name-open'));
    const name = screen.getByLabelText(en.account.displayNameLabel);
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute('autocomplete', 'nickname');
    first.unmount();

    const password = render(<LanguageProvider><ToastProvider><ChangePasswordForm dialog {...idle} onSubmit={vi.fn()} /></ToastProvider></LanguageProvider>);
    await userEvent.click(screen.getByTestId('change-password-open'));
    await waitFor(() => expect(screen.getByTestId('change-current-password')).toHaveFocus());
    password.unmount();

    const support = render(<LanguageProvider><AccountSupportForm supportSubject="" supportBody="" onSubjectChange={vi.fn()} onBodyChange={vi.fn()} pending={false} onSubmit={vi.fn()} /></LanguageProvider>);
    await userEvent.click(screen.getByTestId('account-support-open'));
    await waitFor(() => expect(screen.getByLabelText(en.support.subjectLabel)).toHaveFocus());
    support.unmount();

    const methods = render(tree(propsWith()));
    await userEvent.click(screen.getByTestId('enable-2fa-open'));
    await waitFor(() => expect(screen.getByTestId('enable-2fa-password')).toHaveFocus());
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('add-passkey-open'));
    await waitFor(() => expect(screen.getByTestId('passkey-name')).toHaveFocus());
    methods.unmount();
  });

  it('keeps the inline studio passkey form from taking focus', () => {
    render(tree(propsWith({ presentation: 'embedded' })));
    expect(screen.getByTestId('passkey-name')).not.toHaveFocus();
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
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByTestId('two-factor-leave-dialog')).getByTestId('two-factor-leave-confirm'));
    expect(refresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('asks before leaving unsaved backup codes by Close or Escape and stays on Stay', async () => {
    const props = propsWith();
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

    await userEvent.click(screen.getByRole('button', { name: en.common.close }));
    const leave = await screen.findByTestId('two-factor-leave-dialog');
    expect(within(leave).getByRole('heading', { name: en.security.leaveWithoutCodesTitle })).toBeVisible();
    expect(leave).not.toHaveTextContent('demo-code');
    await userEvent.click(within(leave).getByRole('button', { name: en.security.leaveWithoutCodesCancel }));
    await waitFor(() => expect(screen.queryByTestId('two-factor-leave-dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('backup-codes')).toHaveTextContent('demo-code');

    await userEvent.keyboard('{Escape}');
    expect(await screen.findByTestId('two-factor-leave-dialog')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: en.security.leaveWithoutCodesCancel }));
    await waitFor(() => expect(screen.queryByTestId('two-factor-leave-dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByLabelText(en.security.backupCodesSaved));
    await userEvent.click(screen.getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByTestId('two-factor-leave-dialog')).not.toBeInTheDocument();
  });
  it('goes back from verification to the QR code', async () => {
    const props = propsWith();
    const view = render(tree(props));
    await userEvent.click(screen.getByTestId('enable-2fa-open'));
    fill('enable-2fa-password', 'fresh-password');
    await userEvent.click(screen.getByTestId('enable-2fa'));
    view.rerender(tree({ ...props, enableTwoFactor: { ...props.enableTwoFactor, success: true, submittedAt: 1, data: enrollment } }));
    await userEvent.click(await screen.findByTestId('two-factor-next'));
    fill('verify-totp-code', '12');
    await userEvent.click(screen.getByTestId('two-factor-back'));
    expect(screen.getByTestId('two-factor-step')).toHaveTextContent(en.security.wizardSteps.qr);
    expect(screen.getByTestId('two-factor-qr-code')).toBeVisible();
    await userEvent.click(screen.getByTestId('two-factor-next'));
    expect(screen.getByTestId('verify-totp-code')).toHaveValue('');
    expect(props.verifyTotp.run).not.toHaveBeenCalled();
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

  it('labels the saved display name and falls back to a not-set value instead of an empty line', () => {
    const view = render(<LanguageProvider><AccountNameFields savedDisplayName="Ada" onCancel={vi.fn()} displayName="Ada" onChange={vi.fn()} pending={false} dirty={false} /></LanguageProvider>);
    const value = screen.getByTestId('account-display-name-value');
    expect(value.tagName).toBe('DD');
    expect(value).toHaveTextContent('Ada');
    const label = screen.getByText(en.account.displayNameLabel);
    expect(label.tagName).toBe('DT');
    expect(label.parentElement).toBe(value.parentElement);
    view.rerender(<LanguageProvider><AccountNameFields savedDisplayName="  " onCancel={vi.fn()} displayName="" onChange={vi.fn()} pending={false} dirty={false} /></LanguageProvider>);
    expect(screen.getByTestId('account-display-name-value')).toHaveTextContent(en.account.displayNameNotSet);
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

  it.each(['cancelled', 'rejected'] as const)('keeps the %s status and offers a new erasure request', async (status) => {
    const onCreate = vi.fn();
    render(<LanguageProvider><AccountErasureCard
      request={{ id: 'erasure-1', tenantId: 't1', memberId: 'm1', status, reason: null, requestedAt: '2026-06-20T12:00:00.000Z', dueAt: '2026-07-20T12:00:00.000Z', resolvedAt: '2026-06-30T12:00:00.000Z', resolvedByUserId: null, resolutionNote: null }}
      pending={false} error={null} createPending={false} createError={null}
      cancelPending={false} cancelError={null} email="demo@example.com" erasureConfirmEmail="demo@example.com"
      onConfirmEmailChange={vi.fn()} onCreate={onCreate} onCancel={vi.fn()} onRetry={vi.fn()}
    /></LanguageProvider>);
    expect(screen.getByTestId('account-erasure-status')).toHaveTextContent(en.account.erasureRequestStatus[status]);
    expect(screen.queryByTestId('account-erasure-cancel')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('account-erasure-open'));
    await userEvent.click(within(screen.getByRole('dialog')).getByTestId('account-erasure-create'));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ confirmEmail: 'demo@example.com' });
  });

  it('closes the erasure confirmation once the request is open so a later cancellation does not reopen it', async () => {
    const onConfirmEmailChange = vi.fn();
    const card = (request: Parameters<typeof AccountErasureCard>[0]['request']) => <LanguageProvider><AccountErasureCard
      request={request} pending={false} error={null} createPending={false} createError={null}
      cancelPending={false} cancelError={null} email="demo@example.com" erasureConfirmEmail="demo@example.com"
      onConfirmEmailChange={onConfirmEmailChange} onCreate={vi.fn()} onCancel={vi.fn()} onRetry={vi.fn()}
    /></LanguageProvider>;
    const base = { id: 'erasure-1', tenantId: 't1', memberId: 'm1', reason: null, requestedAt: '2026-06-20T12:00:00.000Z', dueAt: '2026-07-20T12:00:00.000Z', resolvedByUserId: null, resolutionNote: null };
    const view = render(card(null));
    await userEvent.click(screen.getByTestId('account-erasure-open'));
    expect(screen.getByRole('dialog')).toBeVisible();
    view.rerender(card({ ...base, status: 'open', resolvedAt: null }));
    expect(screen.getByTestId('account-erasure-cancel')).toBeVisible();
    expect(onConfirmEmailChange).toHaveBeenLastCalledWith('');
    view.rerender(card({ ...base, status: 'cancelled', resolvedAt: '2026-06-21T12:00:00.000Z' }));
    expect(screen.getByTestId('account-erasure-open')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('confirms erasure with Enter, shows the address to retype and clears the typed value on close', async () => {
    const onCreate = vi.fn();
    const onConfirmEmailChange = vi.fn();
    const card = (typed: string) => <LanguageProvider><AccountErasureCard
      request={null} pending={false} error={null} createPending={false} createError={null}
      cancelPending={false} cancelError={null} email="demo@example.com" erasureConfirmEmail={typed}
      onConfirmEmailChange={onConfirmEmailChange} onCreate={onCreate} onCancel={vi.fn()} onRetry={vi.fn()}
    /></LanguageProvider>;
    const view = render(card(''));
    await userEvent.click(screen.getByTestId('account-erasure-open'));
    const field = screen.getByLabelText(en.account.erasureConfirmLabel);
    expect(field).toHaveAttribute('type', 'email');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    expect(field).toHaveAccessibleDescription(en.account.erasureConfirmHint({ email: 'demo@example.com' }));
    expect(within(screen.getByRole('dialog')).getByTestId('account-erasure-confirm-hint')).toHaveTextContent('demo@example.com');
    await userEvent.type(field, '{Enter}');
    expect(onCreate).not.toHaveBeenCalled();
    view.rerender(card('Demo@Example.com'));
    await userEvent.type(screen.getByLabelText(en.account.erasureConfirmLabel), '{Enter}');
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ confirmEmail: 'Demo@Example.com' });
    await userEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onConfirmEmailChange).toHaveBeenLastCalledWith('');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers no new erasure request after a completed one', () => {
    render(<LanguageProvider><AccountErasureCard
      request={{ id: 'erasure-1', tenantId: 't1', memberId: 'm1', status: 'completed', reason: null, requestedAt: '2026-06-20T12:00:00.000Z', dueAt: '2026-07-20T12:00:00.000Z', resolvedAt: '2026-06-30T12:00:00.000Z', resolvedByUserId: null, resolutionNote: null }}
      pending={false} error={null} createPending={false} createError={null}
      cancelPending={false} cancelError={null} email="demo@example.com" erasureConfirmEmail=""
      onConfirmEmailChange={vi.fn()} onCreate={vi.fn()} onCancel={vi.fn()} onRetry={vi.fn()}
    /></LanguageProvider>);
    expect(screen.getByTestId('account-erasure-status')).toHaveTextContent(en.account.erasureRequestStatus.completed);
    expect(screen.queryByTestId('account-erasure-open')).not.toBeInTheDocument();
  });

  it('states the erasure scope on the card and the review process in the dialog without repeating the intro', async () => {
    render(<LanguageProvider><AccountErasureCard
      request={null} pending={false} error={null} createPending={false} createError={null}
      cancelPending={false} cancelError={null} email="demo@example.com" erasureConfirmEmail=""
      onConfirmEmailChange={vi.fn()} onCreate={vi.fn()} onCancel={vi.fn()} onRetry={vi.fn()}
    /></LanguageProvider>);
    const effects = within(screen.getByTestId('account-erasure-effects')).getAllByRole('listitem').map((item) => item.textContent);
    expect(effects).toEqual([
      en.account.erasureEffects.profile,
      en.account.erasureEffects.posts,
      en.account.erasureEffects.access,
      en.account.erasureEffects.signIn,
    ]);
    await userEvent.click(screen.getByTestId('account-erasure-open'));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByTestId('account-erasure-dialog-body')).toHaveTextContent(en.account.erasureDialogBody({ days: ERASURE_REQUEST_RESPONSE_DAYS }));
    expect(dialog.getByTestId('account-erasure-dialog-body')).toHaveTextContent('within 30 days');
    expect(dialog.queryByText(en.account.erasureIntro)).not.toBeInTheDocument();
  });
});
