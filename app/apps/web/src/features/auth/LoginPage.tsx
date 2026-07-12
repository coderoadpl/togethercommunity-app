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

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { DemoValue, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [requestedMagicEmail, setRequestedMagicEmail] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signIn = useMutation({
    ...actions.signIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/' });
    },
  });

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
    requestMagicLink.mutate({ email: magicEmail, callbackURL: `${window.location.origin}/my` });
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
          sign in · tenant {window.location.hostname}
        </Eyebrow>
        <Stack component="form" onSubmit={submit} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="login-email">email</FormLabel>
            <OutlinedInput
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="login-password">password</FormLabel>
            <OutlinedInput
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={signIn.isPending}
            sx={{ mt: '0.4rem' }}
          >
            {signIn.isPending ? 'signing in…' : 'sign in'}
          </Button>
        </Stack>
        {signIn.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {signIn.error instanceof ApiError ? signIn.error.appError.message : signIn.error.message}
          </Alert>
        ) : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <Stack component="form" onSubmit={submitMagicLink} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="magic-link-email">magic link email</FormLabel>
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
            {requestMagicLink.isPending ? 'sending magic link…' : 'Send me a magic link'}
          </Button>
        </Stack>
        {requestMagicLink.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {requestMagicLink.error instanceof ApiError
              ? requestMagicLink.error.appError.message
              : requestMagicLink.error.message}
          </Alert>
        ) : null}
        {requestedMagicEmail ? (
          <FinePrint variant="caption" component="p" sx={{ mt: '0.8rem' }}>
            {devMagicLink.isPending ? 'fetching dev magic link…' : 'Magic link requested.'}
          </FinePrint>
        ) : null}
        {devMagicLink.data?.magicLink ? (
          <FinePrint variant="caption" component="p" sx={{ mt: '0.4rem' }}>
            <Link href={devMagicLink.data.magicLink.url}>Open magic link</Link>
          </FinePrint>
        ) : null}
        {devMagicLink.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>{devMagicLink.error.message}</Alert>
        ) : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p" sx={{ mb: '1em' }}>
          demo account: <DemoValue>creator@together.dev</DemoValue> /{' '}
          <DemoValue>demo1234</DemoValue>
        </FinePrint>
        <FinePrint variant="caption" component="p">
          New here? <Link href="/register">Create an account</Link>
        </FinePrint>
      </Paper>
    </Box>
  );
};
