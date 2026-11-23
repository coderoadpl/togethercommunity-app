import { useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Link as MuiLink,
  Stack,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { returnToFromSearch } from '../../lib/auth-return.js';
import { FinePrint } from '../../theme.js';
import { AuthInput, AuthLead, AuthTitle } from './auth-chrome.js';
import { describedBy, isEmailAddress } from './auth-fields.js';
import { useRedirectSignedInWithTenant } from './auth-redirect.js';
import { AuthShell } from './AuthShell.js';

const EMAIL_ERROR_ID = 'forgot-password-email-error';

export const ForgotPasswordPage = () => {
  const t = useTranslations();
  const { explicitLanguage } = useLanguage();
  useRedirectSignedInWithTenant();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const returnTo = returnToFromSearch(search);
  const [email, setEmail] = useState(() => new URLSearchParams(search).get('email') ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const requestPasswordReset = useMutation(actions.requestPasswordReset);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    requestPasswordReset.reset();
    const normalizedEmail = email.trim();
    const error = normalizedEmail === ''
      ? t.forgotPassword.emailRequired
      : isEmailAddress(normalizedEmail) ? null : t.forgotPassword.invalidEmail;
    setEmailError(error);
    if (error !== null) {
      emailRef.current?.focus();
      return;
    }
    requestPasswordReset.mutate({
      email: normalizedEmail,
      redirectTo: new URL('/reset-password', window.location.origin).toString(),
      ...(explicitLanguage === undefined ? {} : { language: explicitLanguage }),
    });
  };

  const footer = (
    <FinePrint variant="caption" component="p" sx={{ mt: '1.75rem' }}>
      <MuiLink component={Link} to={returnTo === null ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`}>{t.forgotPassword.backToLogin}</MuiLink>
    </FinePrint>
  );

  return (
    <AuthShell title={t.forgotPassword.title} footer={footer}>
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
            noValidate
            onSubmit={submit}
            useFlexGap
            spacing="1rem"
            data-testid="forgot-password-form"
          >
            <FormControl fullWidth error={emailError !== null}>
              <FormLabel htmlFor="forgot-password-email">{t.forgotPassword.emailLabel}</FormLabel>
              <AuthInput
                id="forgot-password-email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(null);
                }}
                autoComplete="email"
                inputRef={emailRef}
                {...describedBy(emailError === null ? null : EMAIL_ERROR_ID)}
                inputProps={{ 'data-testid': 'forgot-password-email', inputMode: 'email' }}
                required
              />
              {emailError === null ? null : (
                <FormHelperText id={EMAIL_ERROR_ID} data-testid="forgot-password-email-error">{emailError}</FormHelperText>
              )}
            </FormControl>
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={requestPasswordReset.isPending}
              data-testid="forgot-password-submit"
            >
              {requestPasswordReset.isPending
                ? t.forgotPassword.submitPending
                : t.forgotPassword.submitIdle}
            </Button>
          </Stack>
          {requestPasswordReset.isError ? (
            <Alert severity="error" sx={{ mt: '0.6rem' }}>{localizeError(requestPasswordReset.error, t)}</Alert>
          ) : null}
        </>
      )}
    </AuthShell>
  );
};
