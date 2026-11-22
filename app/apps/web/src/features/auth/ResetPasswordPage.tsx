import { useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Stack,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { PASSWORD_MIN_LENGTH, passwordMeetsMinimumLength } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { localizeError, providerCodeOf, useTranslations } from '../../i18n/index.js';
import { AuthAccentLink, AuthLead, AuthSecondaryAction, AuthTitle } from './auth-chrome.js';
import { describedBy } from './auth-fields.js';
import { AuthPasswordInput } from './auth-password-input.js';
import { AuthShell } from './AuthShell.js';

const PASSWORD_HINT_ID = 'reset-password-minimum';
const PASSWORD_ERROR_ID = 'reset-password-error';
const CONFIRM_ERROR_ID = 'reset-password-confirm-error';

const tokenFromLocation = (): string | null =>
  new URLSearchParams(window.location.search).get('token');

const invalidTokenFromLocation = (): boolean =>
  new URLSearchParams(window.location.search).get('error') === 'INVALID_TOKEN';

export const ResetPasswordPage = () => {
  const t = useTranslations();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const token = tokenFromLocation();
  const invalidToken = invalidTokenFromLocation();

  const resetPassword = useMutation(actions.resetPassword);
  const providerRejectedToken = providerCodeOf(resetPassword.error) === 'INVALID_TOKEN';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    resetPassword.reset();
    if (!token) return;
    const nextPasswordError = password === ''
      ? t.resetPassword.passwordRequired
      : passwordMeetsMinimumLength(password) ? null : t.resetPassword.tooShort({ min: PASSWORD_MIN_LENGTH });
    const nextConfirmError = confirm === ''
      ? t.resetPassword.confirmRequired
      : confirm === password ? null : t.resetPassword.mismatch;
    setPasswordError(nextPasswordError);
    setConfirmError(nextConfirmError);
    if (nextPasswordError !== null) {
      passwordRef.current?.focus();
      return;
    }
    if (nextConfirmError !== null) {
      confirmRef.current?.focus();
      return;
    }
    resetPassword.mutate({ token, newPassword: password });
  };

  const linkUnusable = !token || invalidToken || providerRejectedToken;
  const footer = linkUnusable || resetPassword.isSuccess ? null : (
    <AuthSecondaryAction component="p">
      <AuthAccentLink standalone component={Link} to="/login">{t.resetPassword.goToLogin}</AuthAccentLink>
    </AuthSecondaryAction>
  );

  return (
    <AuthShell title={t.resetPassword.title} footer={footer}>
        {linkUnusable ? (
          <StatusView
            state={{
              kind: 'not-found',
              title: t.resetPassword.missingTokenTitle,
              body: t.resetPassword.missingToken,
              action: (
                <Button component={Link} to="/forgot-password" variant="contained">
                  {t.resetPassword.requestNewLink}
                </Button>
              ),
            }}
            data-testid="reset-invalid-token"
          />
        ) : resetPassword.isSuccess ? (
          <Stack useFlexGap spacing="1rem" data-testid="reset-success">
            <Box>
              <AuthTitle variant="h1">{t.resetPassword.successTitle}</AuthTitle>
              <AuthLead component="p">{t.resetPassword.successBody}</AuthLead>
            </Box>
            <Button component={Link} to="/login" variant="contained" fullWidth>
              {t.resetPassword.goToLogin}
            </Button>
          </Stack>
        ) : (
          <>
            <Box sx={{ mb: '1.5rem' }}>
              <AuthTitle variant="h1">{t.resetPassword.title}</AuthTitle>
              <AuthLead component="p">{t.resetPassword.intro}</AuthLead>
            </Box>
            <Stack component="form" noValidate onSubmit={submit} useFlexGap spacing="1rem">
              <FormControl fullWidth error={passwordError !== null}>
                <FormLabel htmlFor="reset-password">{t.resetPassword.newPasswordLabel}</FormLabel>
                <AuthPasswordInput
                  id="reset-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordError(null);
                  }}
                  autoComplete="new-password"
                  inputRef={passwordRef}
                  {...describedBy(passwordError === null ? null : PASSWORD_ERROR_ID, PASSWORD_HINT_ID)}
                  inputProps={{ 'data-testid': 'reset-password' }}
                  required
                />
                {passwordError === null ? null : (
                  <FormHelperText id={PASSWORD_ERROR_ID} data-testid="reset-password-error">{passwordError}</FormHelperText>
                )}
                <FormHelperText id={PASSWORD_HINT_ID} error={false}>{t.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH })}</FormHelperText>
              </FormControl>
              <FormControl fullWidth error={confirmError !== null}>
                <FormLabel htmlFor="reset-password-confirm">{t.resetPassword.confirmPasswordLabel}</FormLabel>
                <AuthPasswordInput
                  id="reset-password-confirm"
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    setConfirmError(null);
                  }}
                  autoComplete="new-password"
                  inputRef={confirmRef}
                  {...describedBy(confirmError === null ? null : CONFIRM_ERROR_ID)}
                  inputProps={{ 'data-testid': 'reset-password-confirm' }}
                  required
                />
                {confirmError === null ? null : (
                  <FormHelperText id={CONFIRM_ERROR_ID} data-testid="reset-password-confirm-error">{confirmError}</FormHelperText>
                )}
              </FormControl>
              <Button
                type="submit"
                variant="contained"
                fullWidth
                data-testid="reset-submit"
                disabled={resetPassword.isPending}
              >
                {resetPassword.isPending ? t.resetPassword.submitPending : t.resetPassword.submitIdle}
              </Button>
            </Stack>
            {resetPassword.isError ? (
              <Alert severity="error" sx={{ mt: '0.6rem' }}>
                {localizeError(resetPassword.error, t)}
              </Alert>
            ) : null}
          </>
        )}
    </AuthShell>
  );
};
