import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  OutlinedInput,
  Typography,
} from '@mui/material';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { Eyebrow } from '../../theme.js';

const providerCodeOf = (error: Error | null): string | null => {
  if (error === null || !('appError' in error)) return null;
  const { appError } = error;
  if (typeof appError !== 'object' || appError === null || !('details' in appError)) return null;
  const { details } = appError;
  if (typeof details !== 'object' || details === null || !('providerCode' in details)) return null;
  return typeof details.providerCode === 'string' ? details.providerCode : null;
};

interface ChangePasswordFormProps {
  minPasswordLength: number;
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
  minPasswordLength,
  pending,
  success,
  error,
  onSubmit,
}: ChangePasswordFormProps) => {
  const t = useTranslations();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (success) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [success]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (newPassword.length < minPasswordLength) {
      setLocalError(t.changePassword.tooShort({ min: minPasswordLength }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError(t.changePassword.mismatch);
      return;
    }
    onSubmit({ currentPassword, newPassword, revokeOtherSessions });
  };

  const providerCode = providerCodeOf(error);
  const remoteError = providerCode === 'INVALID_PASSWORD'
    ? t.changePassword.invalidCurrentPassword
    : providerCode === 'CREDENTIAL_ACCOUNT_NOT_FOUND'
      ? t.changePassword.credentialAccountMissing
      : error !== null
        ? localizeError(error, t)
        : null;

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.8rem' }}>
      <Box>
        <Eyebrow variant="overline" component="h3">
          {t.changePassword.heading}
        </Eyebrow>
        <Typography variant="body2">{t.changePassword.intro}</Typography>
      </Box>
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
          inputProps={{ 'data-testid': 'change-new-password' }}
          required
        />
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
      <Button
        type="submit"
        variant="outlined"
        data-testid="change-password-submit"
        disabled={pending}
      >
        {pending ? t.changePassword.submitPending : t.changePassword.submitIdle}
      </Button>
      {success ? (
        <Typography variant="caption" component="p" data-testid="change-password-success">
          {t.changePassword.success}
        </Typography>
      ) : null}
      {localError ? <Alert data-testid="change-password-local-error">{localError}</Alert> : null}
      {remoteError ? <Alert data-testid="change-password-remote-error">{remoteError}</Alert> : null}
    </Box>
  );
};
