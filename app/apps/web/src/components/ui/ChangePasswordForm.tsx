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
  revokeOtherSessionsByDefault?: boolean;
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
  revokeOtherSessionsByDefault = false,
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
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(revokeOtherSessionsByDefault);
  const [localError, setLocalError] = useState<'tooShort' | 'mismatch' | null>(null);
  useEffect(() => {
    if (success) {
      setOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [success]);

  const openDialog = () => {
    setRevokeOtherSessions(revokeOtherSessionsByDefault);
    setLocalError(null);
    setOpen(true);
  };

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
      setLocalError('tooShort');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('mismatch');
      return;
    }
    onSubmit({ currentPassword, newPassword, revokeOtherSessions });
  };

  const remoteError = error === null ? null : localizeChangePasswordError(error, t);
  const newPasswordError = localError === 'tooShort' ? t.changePassword.tooShort({ min: PASSWORD_MIN_LENGTH }) : null;
  const confirmPasswordError = localError === 'mismatch' ? t.changePassword.mismatch : null;

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
          autoFocus={dialog}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          inputProps={{ 'data-testid': 'change-current-password' }}
          required
        />
      </FormControl>
      <FormControl fullWidth error={newPasswordError !== null}>
        <FormLabel htmlFor="change-new-password">{t.changePassword.newPasswordLabel}</FormLabel>
        <OutlinedInput
          id="change-new-password"
          type="password"
          value={newPassword}
          onChange={(event) => {
            setNewPassword(event.target.value);
            setLocalError(null);
          }}
          autoComplete="new-password"
          inputProps={{ 'data-testid': 'change-new-password', 'aria-describedby': newPasswordError === null ? 'change-password-minimum' : 'change-password-minimum change-new-password-error' }}
          required
        />
        <FormHelperText id="change-password-minimum">{t.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH })}</FormHelperText>
        {newPasswordError === null ? null : <FormHelperText id="change-new-password-error" role="alert" data-testid="change-password-local-error">{newPasswordError}</FormHelperText>}
      </FormControl>
      <FormControl fullWidth error={confirmPasswordError !== null}>
        <FormLabel htmlFor="change-confirm-password">{t.changePassword.confirmPasswordLabel}</FormLabel>
        <OutlinedInput
          id="change-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            if (localError === 'mismatch') setLocalError(null);
          }}
          autoComplete="new-password"
          inputProps={{ 'data-testid': 'change-confirm-password', 'aria-describedby': confirmPasswordError === null ? undefined : 'change-confirm-password-error' }}
          required
        />
        {confirmPasswordError === null ? null : <FormHelperText id="change-confirm-password-error" role="alert" data-testid="change-password-local-error">{confirmPasswordError}</FormHelperText>}
      </FormControl>
      <FormControlLabel
        control={(
          <Checkbox
            checked={revokeOtherSessions}
            onChange={(event) => setRevokeOtherSessions(event.target.checked)}
            slotProps={{ input: { 'aria-describedby': 'change-revoke-sessions-hint' } }}
            data-testid="change-revoke-sessions"
          />
        )}
        label={t.changePassword.revokeOtherSessions}
      />
      <Typography variant="caption" component="p" id="change-revoke-sessions-hint">
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
    </Box>
  );
  return dialog ? <>
    <Box><Button variant="contained" data-testid="change-password-open" onClick={openDialog}>{t.changePassword.submitIdle}</Button></Box>
    <AccountDialog open={open} title={t.changePassword.heading} pending={pending} onClose={close}>{form}</AccountDialog>
  </> : form;
};
