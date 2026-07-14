import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  Link,
  OutlinedInput,
  Paper,
  Stack,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { useTranslations } from '../../i18n/index.js';
import { Eyebrow, FinePrint, Wordmark } from '../../theme.js';

const MIN_PASSWORD_LENGTH = 8;

const tokenFromLocation = (): string | null =>
  new URLSearchParams(window.location.search).get('token');

export const ResetPasswordPage = () => {
  const t = useTranslations();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const token = tokenFromLocation();

  const resetPassword = useMutation(actions.resetPassword);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!token) {
      setLocalError(t.resetPassword.missingToken);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(t.resetPassword.tooShort({ min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setLocalError(t.resetPassword.mismatch);
      return;
    }
    resetPassword.mutate({ token, newPassword: password });
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        sx={{ width: '100%', maxWidth: '23rem', px: '1.8rem', pt: '2rem', pb: '1.6rem' }}
      >
        <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
          Together
        </Wordmark>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
          {t.resetPassword.eyebrow({ host: window.location.hostname })}
        </Eyebrow>

        {resetPassword.isSuccess ? (
          <Stack useFlexGap spacing="0.8rem" data-testid="reset-success">
            <Wordmark variant="h2" component="p">
              {t.resetPassword.successTitle}
            </Wordmark>
            <FinePrint variant="body2" component="p">
              {t.resetPassword.successBody}
            </FinePrint>
            <Button component="a" href="/login" variant="contained" fullWidth>
              {t.resetPassword.goToLogin}
            </Button>
          </Stack>
        ) : (
          <>
            <FinePrint variant="caption" component="p" sx={{ mb: '1rem' }}>
              {t.resetPassword.intro}
            </FinePrint>
            <Stack component="form" onSubmit={submit} useFlexGap spacing="1rem">
              <FormControl fullWidth>
                <FormLabel htmlFor="reset-password">{t.resetPassword.newPasswordLabel}</FormLabel>
                <OutlinedInput
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  inputProps={{ 'data-testid': 'reset-password' }}
                  required
                />
              </FormControl>
              <FormControl fullWidth>
                <FormLabel htmlFor="reset-password-confirm">{t.resetPassword.confirmPasswordLabel}</FormLabel>
                <OutlinedInput
                  id="reset-password-confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  inputProps={{ 'data-testid': 'reset-password-confirm' }}
                  required
                />
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
            {localError ? (
              <Alert sx={{ mt: '0.6rem' }} data-testid="reset-local-error">
                {localError}
              </Alert>
            ) : null}
            {resetPassword.isError ? (
              <Alert sx={{ mt: '0.6rem' }}>
                {resetPassword.error instanceof ApiError
                  ? resetPassword.error.appError.message
                  : resetPassword.error.message}
              </Alert>
            ) : null}
            <FinePrint variant="caption" component="p" sx={{ mt: '1rem' }}>
              <Link href="/login">{t.resetPassword.goToLogin}</Link>
            </FinePrint>
          </>
        )}
      </Paper>
    </Box>
  );
};
