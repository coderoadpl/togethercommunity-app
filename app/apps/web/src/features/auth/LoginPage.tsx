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
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { DemoValue, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const LoginPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [requestedMagicEmail, setRequestedMagicEmail] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const authConfig = useQuery(actions.authConfig);

  const signIn = useMutation({
    ...actions.signIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/' });
    },
  });

  const signInWithPasskey = useMutation({
    ...actions.signInWithPasskey,
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/' });
    },
  });

  const signInWithGoogle = useMutation(actions.signInWithGoogle);

  const requestMagicLink = useMutation({
    ...actions.requestMagicLink,
    onSuccess: (_data, variables) => {
      setRequestedMagicEmail(variables.email);
    },
  });

  const devMagicLink = useQuery({
    ...actions.devMagicLink(requestedMagicEmail),
    enabled: requestedMagicEmail.length > 0,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signIn.mutate({ email, password });
  };

  const submitMagicLink = (event: FormEvent) => {
    event.preventDefault();
    setRequestedMagicEmail('');
    requestMagicLink.mutate({ email: magicEmail, callbackURL: `${window.location.origin}/my`, language });
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
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
          {t.auth.signInEyebrow({ host: window.location.hostname })}
        </Eyebrow>
        <Stack component="form" onSubmit={submit} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="login-email">{t.auth.emailLabel}</FormLabel>
            <OutlinedInput
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              inputProps={{ 'data-testid': 'login-email' }}
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="login-password">{t.auth.passwordLabel}</FormLabel>
            <OutlinedInput
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              inputProps={{ 'data-testid': 'login-password' }}
              required
            />
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={signIn.isPending}
            data-testid="signin-submit"
            sx={{ mt: '0.4rem' }}
          >
            {signIn.isPending ? t.auth.signInPending : t.auth.signInIdle}
          </Button>
        </Stack>
        {signIn.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {localizeError(signIn.error, t)}
          </Alert>
        ) : null}
        <Stack useFlexGap spacing="0.6rem" sx={{ mt: '0.9rem' }}>
          <Button
            data-testid="signin-passkey"
            variant="outlined"
            fullWidth
            disabled={signInWithPasskey.isPending}
            onClick={() => signInWithPasskey.mutate()}
          >
            {signInWithPasskey.isPending ? t.auth.passkeyPending : t.auth.passkeyIdle}
          </Button>
          {authConfig.data?.googleEnabled ? (
            <Button
              data-testid="continue-google"
              variant="outlined"
              fullWidth
              disabled={signInWithGoogle.isPending}
              onClick={() => signInWithGoogle.mutate()}
            >
              {t.auth.continueWithGoogle}
            </Button>
          ) : null}
        </Stack>
        {signInWithPasskey.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {localizeError(signInWithPasskey.error, t)}
          </Alert>
        ) : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p" sx={{ mb: '0.6rem' }} data-testid="forgot-password">
          {t.auth.forgotPassword}
        </FinePrint>
        <Stack component="form" onSubmit={submitMagicLink} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="magic-link-email">{t.auth.magicLinkEmailLabel}</FormLabel>
            <OutlinedInput
              id="magic-link-email"
              type="email"
              value={magicEmail}
              onChange={(event) => setMagicEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </FormControl>
          <Button type="submit" variant="text" disabled={requestMagicLink.isPending}>
            {requestMagicLink.isPending ? t.auth.magicLinkPending : t.auth.magicLinkIdle}
          </Button>
        </Stack>
        {requestMagicLink.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {localizeError(requestMagicLink.error, t)}
          </Alert>
        ) : null}
        {requestedMagicEmail ? (
          <FinePrint variant="caption" component="p" sx={{ mt: '0.8rem' }}>
            {devMagicLink.isPending ? t.auth.magicLinkFetching : t.auth.magicLinkRequested}
          </FinePrint>
        ) : null}
        {devMagicLink.data?.magicLink ? (
          <FinePrint variant="caption" component="p" sx={{ mt: '0.4rem' }}>
            <Link href={devMagicLink.data.magicLink.url}>{t.auth.openMagicLink}</Link>
          </FinePrint>
        ) : null}
        {devMagicLink.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>{localizeError(devMagicLink.error, t)}</Alert>
        ) : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p" sx={{ mb: '1em' }}>
          {t.auth.demoAccount} <DemoValue>creator@together.dev</DemoValue> /{' '}
          <DemoValue>demo1234</DemoValue>
        </FinePrint>
        <FinePrint variant="caption" component="p">
          {t.auth.registerPrompt} <Link href="/register">{t.auth.registerLink}</Link>
        </FinePrint>
      </Paper>
    </Box>
  );
};
