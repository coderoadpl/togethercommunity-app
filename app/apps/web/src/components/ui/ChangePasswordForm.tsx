import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  FormHelperText,
  OutlinedInput,
  Typography,
} from '@mui/material';
import { PASSWORD_MIN_LENGTH, passwordMeetsMinimumLength } from '#core/domain/password.js';

import { localizeError, providerCodeOf, useTranslations } from '../../i18n/index.js';
import type { Messages } from '../../i18n/index.js';
import { AccountDialog } from './AccountDialog.js';

export const localizeChangePasswordError = (error: unknown, t: Messages): string => {
  const providerCode = providerCodeOf(error);
  if (providerCode === 'INVALID_PASSWORD') return t.changePassword.invalidCurrentPassword;
  if (providerCode === 'CREDENTIAL_ACCOUNT_NOT_FOUND') return t.changePassword.credentialAccountMissing;
  return localizeError(error, t);
};

interface ChangePasswordFormProps {
  showHeading?: boolean;
  dialog?: boolean;
  pending: boolean;
  success: boolean;
  error: Error | null;
  onSubmit(input: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions: boolean;
  }): void;
}

export const ChangePasswordForm = ({
  showHeading = true,
  dialog = false,
  pending,
  success,
  error,
  onSubmit,
}: ChangePasswordFormProps) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (success) {
      setOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [success]);

  const close = () => {
    setOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setLocalError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!passwordMeetsMinimumLength(newPassword)) {
      setLocalError(t.changePassword.tooShort({ min: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError(t.changePassword.mismatch);
      return;
    }
    onSubmit({ currentPassword, newPassword, revokeOtherSessions });
  };

  const remoteError = error === null ? null : localizeChangePasswordError(error, t);

  const form = (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.8rem' }}>
      {showHeading ? <Box>
        <Typography component="h3" variant="subtitle2">{t.changePassword.heading}</Typography>
        <Typography variant="body2">{t.changePassword.intro({ min: PASSWORD_MIN_LENGTH })}</Typography>
      </Box> : null}
      <FormControl fullWidth>
        <FormLabel htmlFor="change-current-password">{t.changePassword.currentPasswordLabel}</FormLabel>
        <OutlinedInput
          id="change-current-password"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          inputProps={{ 'data-testid': 'change-current-password' }}
          required
        />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="change-new-password">{t.changePassword.newPasswordLabel}</FormLabel>
        <OutlinedInput
          id="change-new-password"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          inputProps={{ 'data-testid': 'change-new-password', 'aria-describedby': 'change-password-minimum' }}
          required
        />
        <FormHelperText id="change-password-minimum">{t.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH })}</FormHelperText>
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="change-confirm-password">{t.changePassword.confirmPasswordLabel}</FormLabel>
        <OutlinedInput
          id="change-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          inputProps={{ 'data-testid': 'change-confirm-password' }}
          required
        />
      </FormControl>
      <FormControlLabel
        control={(
          <Checkbox
            checked={revokeOtherSessions}
            onChange={(event) => setRevokeOtherSessions(event.target.checked)}
            data-testid="change-revoke-sessions"
          />
        )}
        label={t.changePassword.revokeOtherSessions}
      />
      <Typography variant="caption" component="p">
        {t.changePassword.revokeScopeHint}
      </Typography>
      <Box>
        <Button
          type="submit"
          variant="contained"
          data-testid="change-password-submit"
          disabled={pending}
        >
          {pending ? t.changePassword.submitPending : t.changePassword.submitIdle}
        </Button>
      </Box>
      {remoteError ? <Alert severity="error" data-testid="change-password-remote-error">{remoteError}</Alert> : null}
      {localError ? <Alert severity="error" data-testid="change-password-local-error">{localError}</Alert> : null}
    </Box>
  );
  return dialog ? <>
    <Box><Button variant="contained" data-testid="change-password-open" onClick={() => setOpen(true)}>{t.changePassword.submitIdle}</Button></Box>
    <AccountDialog open={open} title={t.changePassword.heading} pending={pending} onClose={close}>{form}</AccountDialog>
  </> : form;
};
