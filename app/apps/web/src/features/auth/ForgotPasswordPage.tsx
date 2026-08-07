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
import { z } from 'zod';

import { actions } from '../../api.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { FinePrint, Wordmark } from '../../theme.js';

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
    <FinePrint variant="caption" component="p">
      <Link href="/login">{t.forgotPassword.backToLogin}</Link>
    </FinePrint>
  );

  return (
    <FocusCard
      eyebrow={t.forgotPassword.eyebrow({ host: window.location.hostname })}
      footer={footer}
      {...(requestPasswordReset.isSuccess ? {} : { onSubmit: submit })}
      data-testid="forgot-password-page"
    >
      {requestPasswordReset.isSuccess ? (
        <Stack useFlexGap spacing="0.8rem" data-testid="forgot-password-success">
          <Wordmark variant="h2" component="p">
            {t.forgotPassword.successTitle}
          </Wordmark>
          <FinePrint variant="body2" component="p">
            {t.forgotPassword.successBody}
          </FinePrint>
        </Stack>
      ) : (
        <>
          <FinePrint variant="body2" component="p" sx={{ mb: '1rem' }}>
            {t.forgotPassword.intro}
          </FinePrint>
          <Stack useFlexGap spacing="1rem">
            <FormControl fullWidth>
              <FormLabel htmlFor="forgot-password-email">{t.forgotPassword.emailLabel}</FormLabel>
              <OutlinedInput
                id="forgot-password-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                inputProps={{ 'data-testid': 'forgot-password-email' }}
                required
              />
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
          {localError ? <Alert severity="error" sx={{ mt: '0.6rem' }}>{localError}</Alert> : null}
          {requestPasswordReset.isError ? (
            <Alert severity="error" sx={{ mt: '0.6rem' }}>{localizeError(requestPasswordReset.error, t)}</Alert>
          ) : null}
        </>
      )}
    </FocusCard>
  );
};
