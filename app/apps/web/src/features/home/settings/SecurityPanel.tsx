import {
  Box,
  Button,
  Stack,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actions } from '../../../api.js';
import { SectionCard } from '../../../components/layout/index.js';
import { ActiveSessions } from '../../../components/ui/ActiveSessions.js';
import { AuthenticationMethods } from '../../../components/ui/AuthenticationMethods.js';
import { ChangePasswordForm, localizeChangePasswordError } from '../../../components/ui/ChangePasswordForm.js';
import { useToast } from '../../../components/ui/Toast.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { Eyebrow } from '../../../theme.js';
import { usePanelContext } from '../panel-context.js';

export const SecurityPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { email } = usePanelContext();
  const toast = useToast();
  const reportFailure = (error: Error) => {
    toast.error(localizePanelError(error, t));
  };
  const queryClient = useQueryClient();
  const passkeys = useQuery(actions.passkeys);
  const accountSessions = useQuery(actions.accountSessions);
  const revokeAccountSession = useMutation({
    ...actions.revokeAccountSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.accountSessionsInvalidates());
    },
  });
  const revokeOtherAccountSessions = useMutation({
    ...actions.revokeOtherAccountSessions,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.accountSessionsInvalidates());
    },
  });
  const registerPasskey = useMutation({
    ...actions.registerPasskey,
    onSuccess: async () => {
      toast.success(t.security.passkeyAdded);
      await queryClient.invalidateQueries(actions.passkeysInvalidates());
    },
    onError: reportFailure,
  });
  const removePasskey = useMutation({
    ...actions.removePasskey,
    onSuccess: async () => {
      toast.success(t.security.passkeyRemoved);
      await queryClient.invalidateQueries(actions.passkeysInvalidates());
    },
    onError: reportFailure,
  });
  const enableTwoFactor = useMutation({
    ...actions.enableTwoFactor,
    onError: reportFailure,
  });
  const verifyTotp = useMutation({
    ...actions.verifyTotp,
    onSuccess: () => {
      toast.success(t.security.twoFactorOn);
    },
    onError: reportFailure,
  });
  const disableTwoFactor = useMutation({
    ...actions.disableTwoFactor,
    onSuccess: () => {
      toast.success(t.security.twoFactorOff);
    },
    onError: reportFailure,
  });
  const regenerateBackupCodes = useMutation({
    ...actions.regenerateBackupCodes,
    onSuccess: () => {
      toast.success(t.security.backupCodesRegenerated);
    },
    onError: reportFailure,
  });
  const changePassword = useMutation({
    ...actions.changePassword,
    onSuccess: () => {
      toast.success(t.changePassword.success);
    },
    onError: (error) => {
      toast.error(localizeChangePasswordError(error, t));
    },
  });
  const requestPasswordReset = useMutation({
    ...actions.requestPasswordReset,
    onSuccess: () => {
      toast.success(t.security.resetSent);
    },
    onError: reportFailure,
  });
  const requestPasskeyPasswordSetup = useMutation({
    ...actions.requestPasswordReset,
    onSuccess: () => {
      toast.success(t.security.resetSent);
    },
    onError: reportFailure,
  });
  const passwordSetupInput = {
    email,
    redirectTo: new URL('/reset-password', window.location.origin).toString(),
    language,
  };
  return (
    <SectionCard title={t.security.heading} data-testid="security-settings">
      <Stack useFlexGap spacing="1.75rem">
        <Box sx={{ display: 'grid', gap: '0.8rem' }}>
          <ChangePasswordForm
            pending={changePassword.isPending}
            success={changePassword.isSuccess}
            error={changePassword.error}
            onSubmit={(input) => changePassword.mutate(input)}
          />
          <Box sx={{ display: 'grid', gap: '0.8rem' }}>
            <Eyebrow variant="overline" component="h3">
              {t.security.setOrResetPasswordHeading}
            </Eyebrow>
            <Button
              variant="outlined"
              data-testid="security-reset-password"
              disabled={requestPasswordReset.isPending}
              onClick={() => requestPasswordReset.mutate(passwordSetupInput)}
            >
              {requestPasswordReset.isPending
                ? t.security.resetSending
                : t.security.setOrResetPassword}
            </Button>
          </Box>
        </Box>

        <AuthenticationMethods
          presentation="embedded"
          passkeys={{ data: passkeys.data, pending: passkeys.isPending, error: passkeys.error, retry: () => void passkeys.refetch() }}
          registerPasskey={{
            pending: registerPasskey.isPending,
            success: registerPasskey.isSuccess,
            error: registerPasskey.error,
            run: registerPasskey.mutate,
          }}
          removePasskey={{
            pending: removePasskey.isPending,
            success: removePasskey.isSuccess,
            error: removePasskey.error,
            run: removePasskey.mutate,
          }}
          requestPasswordSetup={{
            pending: requestPasskeyPasswordSetup.isPending,
            success: requestPasskeyPasswordSetup.isSuccess,
            error: requestPasskeyPasswordSetup.error,
            run: () => requestPasskeyPasswordSetup.mutate(passwordSetupInput),
          }}
          enableTwoFactor={{
            data: enableTwoFactor.data,
            submittedAt: enableTwoFactor.submittedAt,
            pending: enableTwoFactor.isPending,
            success: enableTwoFactor.isSuccess,
            error: enableTwoFactor.error,
            run: enableTwoFactor.mutate,
          }}
          verifyTotp={{
                  submittedAt: verifyTotp.submittedAt,
            pending: verifyTotp.isPending,
            success: verifyTotp.isSuccess,
            error: verifyTotp.error,
            run: verifyTotp.mutate,
          }}
          disableTwoFactor={{
            submittedAt: disableTwoFactor.submittedAt,
            pending: disableTwoFactor.isPending,
            success: disableTwoFactor.isSuccess,
            error: disableTwoFactor.error,
            run: disableTwoFactor.mutate,
          }}
          regenerateBackupCodes={{
            data: regenerateBackupCodes.data,
            submittedAt: regenerateBackupCodes.submittedAt,
            pending: regenerateBackupCodes.isPending,
            success: regenerateBackupCodes.isSuccess,
            error: regenerateBackupCodes.error,
            run: regenerateBackupCodes.mutate,
          }}
        />
        <ActiveSessions
          presentation="embedded"
          sessions={{
            data: accountSessions.data?.sessions,
            pending: accountSessions.isPending,
            error: accountSessions.error,
            retry: () => void accountSessions.refetch(),
          }}
          revokeSession={{
            pending: revokeAccountSession.isPending,
            success: revokeAccountSession.isSuccess,
            error: revokeAccountSession.error,
            run: revokeAccountSession.mutate,
          }}
          revokeOtherSessions={{
            pending: revokeOtherAccountSessions.isPending,
            success: revokeOtherAccountSessions.isSuccess,
            error: revokeOtherAccountSessions.error,
            run: () => revokeOtherAccountSessions.mutate(undefined),
          }}
        />
      </Stack>
    </SectionCard>
  );
};
