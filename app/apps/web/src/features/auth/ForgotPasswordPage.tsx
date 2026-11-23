import { useEffect, useRef, useState, type FormEvent } from 'react';
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
import { Link, useRouterState } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { returnToFromSearch } from '../../lib/auth-return.js';
import { AuthAccentLink, AuthHelp, AuthInput, AuthLead, AuthSecondaryAction, AuthTitle } from './auth-chrome.js';
import { describedBy, isEmailAddress } from './auth-fields.js';
import { useRedirectSignedInWithTenant } from './auth-redirect.js';
import { AuthShell } from './AuthShell.js';

const EMAIL_ERROR_ID = 'forgot-password-email-error';
type EmailError = 'required' | 'invalid';

export const ForgotPasswordPage = () => {
  const t = useTranslations();
  const { explicitLanguage } = useLanguage();
  useRedirectSignedInWithTenant();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const returnTo = returnToFromSearch(search);
  const [email, setEmail] = useState(() => new URLSearchParams(search).get('email') ?? '');
  const [emailError, setEmailError] = useState<EmailError | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const sentTitleRef = useRef<HTMLHeadingElement>(null);
  const [returnedToForm, setReturnedToForm] = useState(false);
  const requestPasswordReset = useMutation(actions.requestPasswordReset);
  const sent = requestPasswordReset.isSuccess;

  useEffect(() => {
    if (sent) sentTitleRef.current?.focus();
    else if (returnedToForm) emailRef.current?.focus();
  }, [sent, returnedToForm]);

  const useDifferentAddress = () => {
    requestPasswordReset.reset();
    setReturnedToForm(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    requestPasswordReset.reset();
    const normalizedEmail = email.trim();
    const error: EmailError | null = normalizedEmail === ''
      ? 'required'
      : isEmailAddress(normalizedEmail) ? null : 'invalid';
    setEmailError(error);
    if (error !== null) {
      emailRef.current?.focus();
      return;
    }
    const redirectTo = new URL('/reset-password', window.location.origin);
    if (returnTo !== null) redirectTo.searchParams.set('returnTo', returnTo);
    requestPasswordReset.mutate({
      email: normalizedEmail,
      redirectTo: redirectTo.toString(),
      ...(explicitLanguage === undefined ? {} : { language: explicitLanguage }),
    });
  };

  const footer = (
    <AuthSecondaryAction component="p">
      <AuthAccentLink standalone component={Link} to={returnTo === null ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`}>
        {t.forgotPassword.backToLogin}
      </AuthAccentLink>
    </AuthSecondaryAction>
  );

  return (
    <AuthShell title={t.forgotPassword.title} footer={footer}>
      {sent ? (
        <Box data-testid="forgot-password-success">
          <AuthTitle variant="h1" ref={sentTitleRef} tabIndex={-1}>{t.forgotPassword.successTitle}</AuthTitle>
          <AuthLead component="p">
            {t.forgotPassword.successBody({ email: requestPasswordReset.variables?.email ?? email.trim() })}
          </AuthLead>
          <AuthHelp component="p" sx={{ mt: '1rem' }}>
            <AuthAccentLink
              standalone
              component="button"
              type="button"
              data-testid="forgot-password-use-different"
              onClick={useDifferentAddress}
            >
              {t.forgotPassword.useDifferentAddress}
            </AuthAccentLink>
          </AuthHelp>
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
                <FormHelperText id={EMAIL_ERROR_ID} data-testid="forgot-password-email-error">
                  {emailError === 'required' ? t.forgotPassword.emailRequired : t.forgotPassword.invalidEmail}
                </FormHelperText>
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
