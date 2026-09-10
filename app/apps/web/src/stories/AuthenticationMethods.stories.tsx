import { AccountCard } from '../features/member/AccountCard.js';
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { AuthenticationMethods, type AuthenticationMethodsProps } from '../components/ui/AuthenticationMethods.js';
import { accountPasskeys } from './account-fixtures.js';
import { withAccountPreview, idleOperation, previewFailure } from './page-decorators.js';
const enrollment = { totpURI: 'otpauth://totp/Together:demo@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Together', backupCodes: ['demo-once-1111', 'demo-once-2222'] };
const AuthenticationMethodsStory = ({ state, args }: { state: string; args: AuthenticationMethodsProps }) => {
  const [enableTwoFactor, setEnableTwoFactor] = useState(args.enableTwoFactor);
  const [verifyTotp, setVerifyTotp] = useState(args.verifyTotp);
  const [regenerateBackupCodes, setRegenerateBackupCodes] = useState(args.regenerateBackupCodes);
  return <AuthenticationMethods
    {...args}
    enableTwoFactor={{
      ...enableTwoFactor,
      run: () => setEnableTwoFactor({
        ...enableTwoFactor,
        success: state !== 'EnrollmentError',
        error: state === 'EnrollmentError' ? previewFailure : null,
        data: state === 'EnrollmentError' ? undefined : enrollment,
        submittedAt: enableTwoFactor.submittedAt + 1,
      }),
    }}
    verifyTotp={{
      ...verifyTotp,
      run: () => setVerifyTotp({
        ...verifyTotp,
        success: state !== 'VerificationFailure',
        error: state === 'VerificationFailure' ? previewFailure : null,
        submittedAt: verifyTotp.submittedAt + 1,
      }),
    }}
    regenerateBackupCodes={{
      ...regenerateBackupCodes,
      run: () => setRegenerateBackupCodes({
        ...regenerateBackupCodes,
        success: true,
        error: null,
        data: ['replacement-1111', 'replacement-2222'],
        submittedAt: regenerateBackupCodes.submittedAt + 1,
      }),
    }}
  />;
};
const meta = { title: 'Account/AuthenticationMethods', component: AuthenticationMethods, decorators: [withAccountPreview] } satisfies Meta<typeof AuthenticationMethods>;
export default meta;
type Story = StoryObj<typeof meta>;
const stateStory = (state: string, colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { colorScheme }, globals: { viewport: { value: viewport } },
  render: (args) => <AuthenticationMethodsStory state={state} args={args} />,
  args: {
    Card: AccountCard,
    twoFactorEnabled: ['ReplacementCodes', 'LaterDisable', 'RegenerateDialog', 'DisableDialog'].includes(state),
    passkeys: { data: state === 'PasskeysLoading' || state === 'PasskeysError' ? undefined : state === 'PasskeysEmpty' || state === 'ProofAbsent' ? [] : accountPasskeys, pending: state === 'PasskeysLoading', error: state === 'PasskeysError' ? previewFailure : null, retry: () => undefined },
    registerPasskey: { ...idleOperation, pending: state === 'AddPending', error: state === 'AddError' ? previewFailure : null },
    removePasskey: { ...idleOperation, pending: state === 'RemovalPending' },
    requestPasswordSetup: { ...idleOperation, pending: state === 'PasswordLinkPending', success: state === 'PasswordLinkSent', error: state === 'PasswordLinkError' ? previewFailure : null },
    enableTwoFactor: { ...idleOperation, submittedAt: 0, data: state === 'LaterDisable' ? enrollment : undefined },
    verifyTotp: { ...idleOperation, submittedAt: 0 },
    disableTwoFactor: { ...idleOperation, submittedAt: 3, success: state === 'LaterDisable' },
    regenerateBackupCodes: { ...idleOperation, submittedAt: 2, success: state === 'LaterDisable', data: state === 'LaterDisable' ? ['replacement-1111', 'replacement-2222'] : undefined },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    if (['ProofAbsent', 'ProofPresent', 'AddPending', 'AddError'].includes(state) || state.startsWith('PasswordLink') || state === 'AddDialog') {
      await userEvent.click(canvas.getByTestId('add-passkey-open'));
      if (state !== 'ProofAbsent' && state !== 'AddDialog') await userEvent.type(canvas.getByTestId('passkey-proof-password'), 'fresh-proof-password');
      if (state.startsWith('PasswordLink')) await userEvent.click(canvas.getByTestId('passkey-help'));
    }
    if (state === 'RemovalConfirmation' || state === 'RemovalPending') {
      await userEvent.click(within(canvas.getByTestId('passkey-laptop')).getByRole('button'));
      await userEvent.type(canvas.getByTestId('remove-passkey-proof-password'), 'fresh-proof-password');
    }
    if (state.startsWith('Wizard') || ['TwoFactorSetup', 'VerificationFailure', 'EnrollmentError'].includes(state)) {
      await userEvent.click(canvas.getByTestId('enable-2fa-open'));
      if (state !== 'WizardPassword') {
        await userEvent.type(canvas.getByTestId('enable-2fa-password'), 'fresh-proof-password');
        await userEvent.click(canvas.getByTestId('enable-2fa'));
      }
      if (state === 'WizardVerify' || state === 'WizardCodes' || state === 'VerificationFailure') await userEvent.click(await canvas.findByTestId('two-factor-next'));
      if (state === 'WizardCodes' || state === 'VerificationFailure') await userEvent.type(canvas.getByTestId('verify-totp-code'), '123456');
    }
    if (['ReplacementCodes', 'RegenerateDialog', 'DisableDialog'].includes(state)) {
      await userEvent.click(canvas.getByTestId(state === 'DisableDialog' ? 'disable-2fa-open' : 'regenerate-backup-codes'));
      if (state === 'ReplacementCodes') {
        await userEvent.type(canvas.getByTestId('enable-2fa-password'), 'fresh-proof-password');
        await userEvent.click(canvas.getByTestId('regenerate-backup-codes-confirm'));
        await canvas.findByTestId('backup-codes');
      }
    }
  },
});
export const PasskeysLoadingLightDesktop1440: Story = stateStory('PasskeysLoading', 'light', 'desktop');
export const PasskeysLoadingLightMobile390: Story = stateStory('PasskeysLoading', 'light', 'mobile');
export const PasskeysLoadingDarkDesktop1440: Story = stateStory('PasskeysLoading', 'dark', 'desktop');
export const PasskeysLoadingDarkMobile390: Story = stateStory('PasskeysLoading', 'dark', 'mobile');
export const PasskeysEmptyLightDesktop1440: Story = stateStory('PasskeysEmpty', 'light', 'desktop');
export const PasskeysEmptyLightMobile390: Story = stateStory('PasskeysEmpty', 'light', 'mobile');
export const PasskeysEmptyDarkDesktop1440: Story = stateStory('PasskeysEmpty', 'dark', 'desktop');
export const PasskeysEmptyDarkMobile390: Story = stateStory('PasskeysEmpty', 'dark', 'mobile');
export const PasskeysItemsLightDesktop1440: Story = stateStory('PasskeysItems', 'light', 'desktop');
export const PasskeysItemsLightMobile390: Story = stateStory('PasskeysItems', 'light', 'mobile');
export const PasskeysItemsDarkDesktop1440: Story = stateStory('PasskeysItems', 'dark', 'desktop');
export const PasskeysItemsDarkMobile390: Story = stateStory('PasskeysItems', 'dark', 'mobile');
export const PasskeysErrorLightDesktop1440: Story = stateStory('PasskeysError', 'light', 'desktop');
export const PasskeysErrorLightMobile390: Story = stateStory('PasskeysError', 'light', 'mobile');
export const PasskeysErrorDarkDesktop1440: Story = stateStory('PasskeysError', 'dark', 'desktop');
export const PasskeysErrorDarkMobile390: Story = stateStory('PasskeysError', 'dark', 'mobile');
export const ProofAbsentLightDesktop1440: Story = stateStory('ProofAbsent', 'light', 'desktop');
export const ProofAbsentLightMobile390: Story = stateStory('ProofAbsent', 'light', 'mobile');
export const ProofAbsentDarkDesktop1440: Story = stateStory('ProofAbsent', 'dark', 'desktop');
export const ProofAbsentDarkMobile390: Story = stateStory('ProofAbsent', 'dark', 'mobile');
export const ProofPresentLightDesktop1440: Story = stateStory('ProofPresent', 'light', 'desktop');
export const ProofPresentLightMobile390: Story = stateStory('ProofPresent', 'light', 'mobile');
export const ProofPresentDarkDesktop1440: Story = stateStory('ProofPresent', 'dark', 'desktop');
export const ProofPresentDarkMobile390: Story = stateStory('ProofPresent', 'dark', 'mobile');
export const AddPendingLightDesktop1440: Story = stateStory('AddPending', 'light', 'desktop');
export const AddPendingLightMobile390: Story = stateStory('AddPending', 'light', 'mobile');
export const AddPendingDarkDesktop1440: Story = stateStory('AddPending', 'dark', 'desktop');
export const AddPendingDarkMobile390: Story = stateStory('AddPending', 'dark', 'mobile');
export const AddErrorLightDesktop1440: Story = stateStory('AddError', 'light', 'desktop');
export const AddErrorLightMobile390: Story = stateStory('AddError', 'light', 'mobile');
export const AddErrorDarkDesktop1440: Story = stateStory('AddError', 'dark', 'desktop');
export const AddErrorDarkMobile390: Story = stateStory('AddError', 'dark', 'mobile');
export const RemovalConfirmationLightDesktop1440: Story = stateStory('RemovalConfirmation', 'light', 'desktop');
export const RemovalConfirmationLightMobile390: Story = stateStory('RemovalConfirmation', 'light', 'mobile');
export const RemovalConfirmationDarkDesktop1440: Story = stateStory('RemovalConfirmation', 'dark', 'desktop');
export const RemovalConfirmationDarkMobile390: Story = stateStory('RemovalConfirmation', 'dark', 'mobile');
export const RemovalPendingLightDesktop1440: Story = stateStory('RemovalPending', 'light', 'desktop');
export const RemovalPendingLightMobile390: Story = stateStory('RemovalPending', 'light', 'mobile');
export const RemovalPendingDarkDesktop1440: Story = stateStory('RemovalPending', 'dark', 'desktop');
export const RemovalPendingDarkMobile390: Story = stateStory('RemovalPending', 'dark', 'mobile');
export const PasswordLinkPendingLightDesktop1440: Story = stateStory('PasswordLinkPending', 'light', 'desktop');
export const PasswordLinkPendingLightMobile390: Story = stateStory('PasswordLinkPending', 'light', 'mobile');
export const PasswordLinkPendingDarkDesktop1440: Story = stateStory('PasswordLinkPending', 'dark', 'desktop');
export const PasswordLinkPendingDarkMobile390: Story = stateStory('PasswordLinkPending', 'dark', 'mobile');
export const PasswordLinkSentLightDesktop1440: Story = stateStory('PasswordLinkSent', 'light', 'desktop');
export const PasswordLinkSentLightMobile390: Story = stateStory('PasswordLinkSent', 'light', 'mobile');
export const PasswordLinkSentDarkDesktop1440: Story = stateStory('PasswordLinkSent', 'dark', 'desktop');
export const PasswordLinkSentDarkMobile390: Story = stateStory('PasswordLinkSent', 'dark', 'mobile');
export const PasswordLinkErrorLightDesktop1440: Story = stateStory('PasswordLinkError', 'light', 'desktop');
export const PasswordLinkErrorLightMobile390: Story = stateStory('PasswordLinkError', 'light', 'mobile');
export const PasswordLinkErrorDarkDesktop1440: Story = stateStory('PasswordLinkError', 'dark', 'desktop');
export const PasswordLinkErrorDarkMobile390: Story = stateStory('PasswordLinkError', 'dark', 'mobile');
export const TwoFactorSetupLightDesktop1440: Story = stateStory('TwoFactorSetup', 'light', 'desktop');
export const TwoFactorSetupLightMobile390: Story = stateStory('TwoFactorSetup', 'light', 'mobile');
export const TwoFactorSetupDarkDesktop1440: Story = stateStory('TwoFactorSetup', 'dark', 'desktop');
export const TwoFactorSetupDarkMobile390: Story = stateStory('TwoFactorSetup', 'dark', 'mobile');
export const EnrollmentErrorLightDesktop1440: Story = stateStory('EnrollmentError', 'light', 'desktop');
export const EnrollmentErrorLightMobile390: Story = stateStory('EnrollmentError', 'light', 'mobile');
export const EnrollmentErrorDarkDesktop1440: Story = stateStory('EnrollmentError', 'dark', 'desktop');
export const EnrollmentErrorDarkMobile390: Story = stateStory('EnrollmentError', 'dark', 'mobile');
export const VerificationFailureLightDesktop1440: Story = stateStory('VerificationFailure', 'light', 'desktop');
export const VerificationFailureLightMobile390: Story = stateStory('VerificationFailure', 'light', 'mobile');
export const VerificationFailureDarkDesktop1440: Story = stateStory('VerificationFailure', 'dark', 'desktop');
export const VerificationFailureDarkMobile390: Story = stateStory('VerificationFailure', 'dark', 'mobile');
export const ReplacementCodesLightDesktop1440: Story = stateStory('ReplacementCodes', 'light', 'desktop');
export const ReplacementCodesLightMobile390: Story = stateStory('ReplacementCodes', 'light', 'mobile');
export const ReplacementCodesDarkDesktop1440: Story = stateStory('ReplacementCodes', 'dark', 'desktop');
export const ReplacementCodesDarkMobile390: Story = stateStory('ReplacementCodes', 'dark', 'mobile');
export const LaterDisableLightDesktop1440: Story = stateStory('LaterDisable', 'light', 'desktop');
export const LaterDisableLightMobile390: Story = stateStory('LaterDisable', 'light', 'mobile');
export const LaterDisableDarkDesktop1440: Story = stateStory('LaterDisable', 'dark', 'desktop');
export const LaterDisableDarkMobile390: Story = stateStory('LaterDisable', 'dark', 'mobile');
export const EnglishMobile: Story = { ...stateStory('PasskeysLoading', 'dark', 'mobile'), parameters: { colorScheme: 'dark', locale: 'en' } };

export const AddDialogLightDesktop1440: Story = stateStory('AddDialog', 'light', 'desktop');
export const AddDialogLightMobile390: Story = stateStory('AddDialog', 'light', 'mobile');
export const AddDialogDarkDesktop1440: Story = stateStory('AddDialog', 'dark', 'desktop');
export const AddDialogDarkMobile390: Story = stateStory('AddDialog', 'dark', 'mobile');
export const WizardPasswordLightDesktop1440: Story = stateStory('WizardPassword', 'light', 'desktop');
export const WizardPasswordLightMobile390: Story = stateStory('WizardPassword', 'light', 'mobile');
export const WizardPasswordDarkDesktop1440: Story = stateStory('WizardPassword', 'dark', 'desktop');
export const WizardPasswordDarkMobile390: Story = stateStory('WizardPassword', 'dark', 'mobile');
export const WizardSecretLightDesktop1440: Story = stateStory('WizardSecret', 'light', 'desktop');
export const WizardSecretLightMobile390: Story = stateStory('WizardSecret', 'light', 'mobile');
export const WizardSecretDarkDesktop1440: Story = stateStory('WizardSecret', 'dark', 'desktop');
export const WizardSecretDarkMobile390: Story = stateStory('WizardSecret', 'dark', 'mobile');
export const WizardVerifyLightDesktop1440: Story = stateStory('WizardVerify', 'light', 'desktop');
export const WizardVerifyLightMobile390: Story = stateStory('WizardVerify', 'light', 'mobile');
export const WizardVerifyDarkDesktop1440: Story = stateStory('WizardVerify', 'dark', 'desktop');
export const WizardVerifyDarkMobile390: Story = stateStory('WizardVerify', 'dark', 'mobile');
export const WizardCodesLightDesktop1440: Story = stateStory('WizardCodes', 'light', 'desktop');
export const WizardCodesLightMobile390: Story = stateStory('WizardCodes', 'light', 'mobile');
export const WizardCodesDarkDesktop1440: Story = stateStory('WizardCodes', 'dark', 'desktop');
export const WizardCodesDarkMobile390: Story = stateStory('WizardCodes', 'dark', 'mobile');
export const RegenerateDialogLightDesktop1440: Story = stateStory('RegenerateDialog', 'light', 'desktop');
export const RegenerateDialogLightMobile390: Story = stateStory('RegenerateDialog', 'light', 'mobile');
export const RegenerateDialogDarkDesktop1440: Story = stateStory('RegenerateDialog', 'dark', 'desktop');
export const RegenerateDialogDarkMobile390: Story = stateStory('RegenerateDialog', 'dark', 'mobile');
export const DisableDialogLightDesktop1440: Story = stateStory('DisableDialog', 'light', 'desktop');
export const DisableDialogLightMobile390: Story = stateStory('DisableDialog', 'light', 'mobile');
export const DisableDialogDarkDesktop1440: Story = stateStory('DisableDialog', 'dark', 'desktop');
export const DisableDialogDarkMobile390: Story = stateStory('DisableDialog', 'dark', 'mobile');
