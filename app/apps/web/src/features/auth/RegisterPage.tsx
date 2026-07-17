import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  Link,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { appBaseDomain, hostHasTenantSubdomain } from '../../lib/tenant.js';
import { Eyebrow, FinePrint, Wordmark } from '../../theme.js';

const baseDomainUrl = (): string => {
  const { protocol, port } = window.location;
  return `${protocol}//${appBaseDomain()}${port ? `:${port}` : ''}`;
};

export const RegisterPage = () => {
  const t = useTranslations();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registeredOnTenant, setRegisteredOnTenant] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signUp = useMutation({
    ...actions.signUp,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      if (hostHasTenantSubdomain(window.location.hostname)) {
        setRegisteredOnTenant(true);
        return;
      }
      await navigate({ to: '/' });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signUp.mutate({ name, email, password });
  };

  if (registeredOnTenant) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
        <Paper
          variant="outlined"
          sx={{
            width: '100%',
            maxWidth: '25rem',
            px: '1.8rem',
            pt: '2rem',
            pb: '1.6rem',
            animation: 'settle 0.45s ease-out both',
          }}
        >
          <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
            Together
          </Wordmark>
          <Eyebrow variant="overline" component="p" sx={{ mb: '1.2rem' }}>
            {t.auth.registeredTitle}
          </Eyebrow>
          <Typography variant="body1" sx={{ mb: '1.4rem' }}>
            {t.auth.registeredOnTenantBody({ host: window.location.hostname })}
          </Typography>
          <Stack useFlexGap spacing="0.9rem">
            <Button variant="contained" fullWidth component="a" href={baseDomainUrl()}>
              {t.auth.registeredCreateOwnCta}
            </Button>
            <Box>
              <FinePrint variant="caption" component="p" sx={{ mb: '0.4rem' }}>
                {t.auth.registeredBoughtHint}
              </FinePrint>
              <Link href="/login">{t.auth.registeredUseMagicLinkCta}</Link>
            </Box>
          </Stack>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        component="form"
        onSubmit={submit}
        sx={{
          width: '100%',
          maxWidth: '23rem',
          px: '1.8rem',
          pt: '2rem',
          pb: '1.6rem',
          animation: 'settle 0.45s ease-out both',
        }}
      >
        <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
          Together
        </Wordmark>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
          {t.auth.createAccountEyebrow({ host: window.location.hostname })}
        </Eyebrow>
        <Stack useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="register-name">{t.auth.nameLabel}</FormLabel>
            <OutlinedInput
              id="register-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="register-email">{t.auth.emailLabel}</FormLabel>
            <OutlinedInput
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="register-password">{t.auth.passwordLabel}</FormLabel>
            <OutlinedInput
              id="register-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={signUp.isPending}
            sx={{ mt: '0.4rem' }}
          >
            {signUp.isPending ? t.auth.creatingAccount : t.auth.createAccount}
          </Button>
        </Stack>
        {signUp.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {localizeError(signUp.error, t)}
          </Alert>
        ) : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p">
          {t.auth.alreadyHaveAccount} <Link href="/login">{t.auth.signInLink}</Link>
        </FinePrint>
      </Paper>
    </Box>
  );
};
