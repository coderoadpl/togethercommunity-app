import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  FormControl,
  FormLabel,
  Link as MuiLink,
  Stack,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { z } from 'zod';

import { actions } from '../../api.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { FinePrint } from '../../theme.js';
import { AuthButton, AuthInput, AuthLead, AuthTitle } from './auth-chrome.js';
import { AuthShell } from './AuthShell.js';

const emailSchema = z.string().email();

export const ForgotPasswordPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const requestPasswordReset = useMutation(actions.requestPasswordReset);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const normalizedEmail = email.trim();
    if (!emailSchema.safeParse(normalizedEmail).success) {
      setLocalError(t.forgotPassword.invalidEmail);
      return;
    }
    requestPasswordReset.mutate({
      email: normalizedEmail,
      redirectTo: new URL('/reset-password', window.location.origin).toString(),
      language,
    });
  };

  const footer = (
    <FinePrint variant="caption" component="p" sx={{ mt: '1.75rem' }}>
      <MuiLink component={Link} to="/login">{t.forgotPassword.backToLogin}</MuiLink>
    </FinePrint>
  );

  return (
    <AuthShell footer={footer}>
      {requestPasswordReset.isSuccess ? (
        <Box data-testid="forgot-password-success">
          <AuthTitle variant="h1">{t.forgotPassword.successTitle}</AuthTitle>
          <AuthLead component="p">{t.forgotPassword.successBody}</AuthLead>
        </Box>
      ) : (
        <>
          <Box sx={{ mb: '1.5rem' }}>
            <AuthTitle variant="h1">{t.forgotPassword.title}</AuthTitle>
            <AuthLead component="p">{t.forgotPassword.intro}</AuthLead>
          </Box>
          <Stack
            component="form"
            onSubmit={submit}
            useFlexGap
            spacing="1rem"
            data-testid="forgot-password-form"
          >
            <FormControl fullWidth>
              <FormLabel htmlFor="forgot-password-email">{t.forgotPassword.emailLabel}</FormLabel>
              <AuthInput
                id="forgot-password-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                inputProps={{ 'data-testid': 'forgot-password-email', inputMode: 'email' }}
                required
              />
            </FormControl>
            <AuthButton
              type="submit"
              variant="contained"
              fullWidth
              disabled={requestPasswordReset.isPending}
              data-testid="forgot-password-submit"
            >
              {requestPasswordReset.isPending
                ? t.forgotPassword.submitPending
                : t.forgotPassword.submitIdle}
            </AuthButton>
          </Stack>
          {localError ? <Alert severity="error" sx={{ mt: '0.6rem' }}>{localError}</Alert> : null}
          {requestPasswordReset.isError ? (
            <Alert severity="error" sx={{ mt: '0.6rem' }}>{localizeError(requestPasswordReset.error, t)}</Alert>
          ) : null}
        </>
      )}
    </AuthShell>
  );
};
