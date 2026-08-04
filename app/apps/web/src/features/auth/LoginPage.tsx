import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  Link as MuiLink,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { BrandMark, TenantSocialLinks } from '../../branding.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { BuildStamp } from '../../components/ui/BuildStamp.js';
import { EmailVerificationResult } from '../../components/ui/EmailVerificationStatus.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { CardTitle, DemoValue, FinePrint } from '../../theme.js';

const invalidTokenFromLocation = (): boolean =>
  new URLSearchParams(window.location.search).get('error') === 'INVALID_TOKEN';

export const LoginPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const magicLinkExpired = invalidTokenFromLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [requestedMagicEmail, setRequestedMagicEmail] = useState('');
  const [twoFactorRequired, setTwoFactorRequired] = useState(
    () => new URLSearchParams(window.location.search).get('twoFactor') === 'required',
  );
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const authConfig = useQuery(actions.authConfig);
  const publicOffer = useQuery(actions.publicOffer);

  const signIn = useMutation({
    ...actions.signIn,
    onSuccess: async (result) => {
      if (result.twoFactorRedirect) {
        setTwoFactorRequired(true);
        return;
      }
      await queryClient.invalidateQueries();
      await navigate({ to: '/' });
    },
  });

  const signInWithPasskey = useMutation({
    ...actions.signInWithPasskey,
    onSuccess: async (result) => {
      if (result.twoFactorRedirect) {
        setTwoFactorRequired(true);
        return;
      }
      queryClient.clear();
      await navigate({ to: '/' });
    },
  });

  const signInWithGoogle = useMutation(actions.signInWithGoogle);

  const completeTwoFactor = async () => {
    setTwoFactorRequired(false);
    queryClient.clear();
    await navigate({ to: '/' });
  };
  const verifyTotp = useMutation({
    ...actions.verifyTotp,
    onSuccess: completeTwoFactor,
  });
  const verifyBackupCode = useMutation({
    ...actions.verifyBackupCode,
    onSuccess: completeTwoFactor,
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
    requestMagicLink.mutate({ email: magicEmail, callbackURL: `${window.location.origin}/my`, language });
  };

  const submitTwoFactor = (event: FormEvent) => {
    event.preventDefault();
    verifyTotp.mutate({ code: twoFactorCode.trim() });
  };

  const footer = (
    <>
      {authConfig.data?.exposeMagicLinks ? (
        <FinePrint variant="caption" component="p" sx={{ mb: '1em' }}>
          {t.auth.demoAccount} <DemoValue>creator@together.dev</DemoValue> /{' '}
          <DemoValue>demo-password-15</DemoValue>
        </FinePrint>
      ) : null}
      <FinePrint variant="caption" component="p">
        {t.auth.registerPrompt} <MuiLink component={Link} to="/register">{t.auth.registerLink}</MuiLink>
      </FinePrint>
      {publicOffer.data !== undefined && publicOffer.data.previewLessons.length > 0 ? (
        <Box sx={{ mt: '1em' }}>
          <FinePrint variant="caption" component="p" sx={{ mb: '0.35em' }}>
            {t.auth.previewLessons}
          </FinePrint>
          <Stack useFlexGap spacing="0.25em">
            {publicOffer.data.previewLessons.map((lesson) => (
              <MuiLink key={`${lesson.courseId}:${lesson.id}`} component={Link} to={`/my/courses/${encodeURIComponent(lesson.courseId)}/lessons/${encodeURIComponent(lesson.id)}`}>
                {lesson.name}
              </MuiLink>
            ))}
          </Stack>
        </Box>
      ) : null}
      {publicOffer.data?.tenant.support.url ? (
        <FinePrint variant="caption" component="p">
          <MuiLink href={publicOffer.data.tenant.support.url}>{t.support.externalLink}</MuiLink>
        </FinePrint>
      ) : null}
      {publicOffer.data?.tenant.socialLinks.length ? (
        <TenantSocialLinks links={publicOffer.data.tenant.socialLinks} />
      ) : null}
      {authConfig.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(authConfig.error, t), retry: { label: t.common.retry, onRetry: () => void authConfig.refetch() } }} /> : null}
      {publicOffer.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(publicOffer.error, t), retry: { label: t.common.retry, onRetry: () => void publicOffer.refetch() } }} /> : null}
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: '1.2rem' }}>
        <BuildStamp />
      </Box>
    </>
  );

  if (requestedMagicEmail) {
    return (
      <FocusCard brand={<BrandMark />} eyebrow={t.auth.signInEyebrow({ host: window.location.hostname })} footer={footer}>
        <Stack useFlexGap spacing="1rem" data-testid="magic-link-sent">
          <CardTitle variant="h1">{t.auth.magicLinkRequested}</CardTitle>
          <Typography variant="body1">
            {t.auth.magicLinkRequestedBody({ email: requestedMagicEmail })}
          </Typography>
          {devMagicLink.isPending ? (
            <FinePrint variant="caption" component="p">
              {t.auth.magicLinkFetching}
            </FinePrint>
          ) : null}
          {devMagicLink.data?.magicLink ? (
            <Button component="a" href={devMagicLink.data.magicLink.url} variant="contained" fullWidth>
              {t.auth.openMagicLink}
            </Button>
          ) : null}
          {devMagicLink.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(devMagicLink.error, t), retry: { label: t.common.retry, onRetry: () => void devMagicLink.refetch() } }} /> : null}
        </Stack>
      </FocusCard>
    );
  }

  if (twoFactorRequired) {
    return (
      <FocusCard brand={<BrandMark />} eyebrow={t.auth.signInEyebrow({ host: window.location.hostname })} footer={footer}>
        <Stack component="form" onSubmit={submitTwoFactor} useFlexGap spacing="1rem" data-testid="two-factor-challenge">
          <CardTitle variant="h1">{t.auth.twoFactorTitle}</CardTitle>
          <Typography variant="body1">{t.auth.twoFactorIntro}</Typography>
          <FormControl fullWidth>
            <FormLabel htmlFor="two-factor-code">{t.auth.twoFactorCodeLabel}</FormLabel>
            <OutlinedInput
              id="two-factor-code"
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value)}
              autoComplete="one-time-code"
              inputProps={{ 'data-testid': 'two-factor-code' }}
              required
            />
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={verifyTotp.isPending || verifyBackupCode.isPending || twoFactorCode.trim().length === 0}
            data-testid="verify-login-totp"
          >
            {verifyTotp.isPending ? t.auth.twoFactorVerifying : t.auth.twoFactorVerifyTotp}
          </Button>
          <Button
            type="button"
            variant="outlined"
            fullWidth
            disabled={verifyTotp.isPending || verifyBackupCode.isPending || twoFactorCode.trim().length === 0}
            data-testid="verify-login-backup-code"
            onClick={() => verifyBackupCode.mutate({ code: twoFactorCode.trim() })}
          >
            {verifyBackupCode.isPending ? t.auth.twoFactorVerifying : t.auth.twoFactorUseBackupCode}
          </Button>
          {verifyTotp.isError ? <Alert severity="error">{localizeError(verifyTotp.error, t)}</Alert> : null}
          {verifyBackupCode.isError ? <Alert severity="error">{localizeError(verifyBackupCode.error, t)}</Alert> : null}
        </Stack>
      </FocusCard>
    );
  }

  return (
    <FocusCard brand={<BrandMark />} eyebrow={t.auth.signInEyebrow({ host: window.location.hostname })} footer={footer}>
        {magicLinkExpired ? (
          <Alert severity="error" sx={{ mb: '1rem' }}>
            {t.auth.magicLinkExpired}
          </Alert>
        ) : (
          <EmailVerificationResult />
        )}
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
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
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
          {signInWithGoogle.isError ? <Alert severity="error">{localizeError(signInWithGoogle.error, t)}</Alert> : null}
        </Stack>
        {signInWithPasskey.isError ? (
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
            {localizeError(signInWithPasskey.error, t)}
          </Alert>
        ) : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p" sx={{ mb: '0.6rem' }} data-testid="forgot-password">
          {t.auth.forgotPassword} <MuiLink component={Link} to="/forgot-password">{t.auth.forgotPasswordLink}</MuiLink>
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
              autoFocus={magicLinkExpired}
              required
            />
          </FormControl>
          <Button type="submit" variant="text" disabled={requestMagicLink.isPending}>
            {requestMagicLink.isPending ? t.auth.magicLinkPending : t.auth.magicLinkIdle}
          </Button>
        </Stack>
        {requestMagicLink.isError ? (
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
            {localizeError(requestMagicLink.error, t)}
          </Alert>
        ) : null}
    </FocusCard>
  );
};
