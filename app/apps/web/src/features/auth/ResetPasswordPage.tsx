import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  FormControl,
  FormLabel,
  Link,
  OutlinedInput,
  Stack,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';

import { PASSWORD_MIN_LENGTH, passwordMeetsMinimumLength } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { FinePrint, Wordmark } from '../../theme.js';

const tokenFromLocation = (): string | null =>
  new URLSearchParams(window.location.search).get('token');

const invalidTokenFromLocation = (): boolean =>
  new URLSearchParams(window.location.search).get('error') === 'INVALID_TOKEN';

const providerCodeOf = (error: Error | null): string | null => {
  if (error === null || !('appError' in error)) return null;
  const { appError } = error;
  if (typeof appError !== 'object' || appError === null || !('details' in appError)) return null;
  const { details } = appError;
  if (typeof details !== 'object' || details === null || !('providerCode' in details)) return null;
  return typeof details.providerCode === 'string' ? details.providerCode : null;
};

export const ResetPasswordPage = () => {
  const t = useTranslations();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const token = tokenFromLocation();
  const invalidToken = invalidTokenFromLocation();

  const resetPassword = useMutation(actions.resetPassword);
  const providerRejectedToken = providerCodeOf(resetPassword.error) === 'INVALID_TOKEN';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!token) {
      setLocalError(t.resetPassword.missingToken);
      return;
    }
    if (!passwordMeetsMinimumLength(password)) {
      setLocalError(t.resetPassword.tooShort({ min: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setLocalError(t.resetPassword.mismatch);
      return;
    }
    resetPassword.mutate({ token, newPassword: password });
  };

  return (
    <FocusCard eyebrow={t.resetPassword.eyebrow({ host: window.location.hostname })}>
        {!token || invalidToken || providerRejectedToken ? (
          <StatusView
            state={{
              kind: 'not-found',
              title: t.resetPassword.missingTokenTitle,
              body: t.resetPassword.missingToken,
              action: (
                <Button component="a" href="/forgot-password" variant="contained">
                  {t.resetPassword.requestNewLink}
                </Button>
              ),
            }}
            data-testid="reset-invalid-token"
          />
        ) : resetPassword.isSuccess ? (
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
                {localizeError(resetPassword.error, t)}
              </Alert>
            ) : null}
            <FinePrint variant="caption" component="p" sx={{ mt: '1rem' }}>
              <Link href="/login">{t.resetPassword.goToLogin}</Link>
            </FinePrint>
          </>
        )}
    </FocusCard>
  );
};
