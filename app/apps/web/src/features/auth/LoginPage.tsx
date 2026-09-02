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

import type { SignInMethod } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { BrandMark, TenantSocialLinks } from '../../branding.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { BuildStamp } from '../../components/ui/BuildStamp.js';
import { EmailVerificationResult } from '../../components/ui/EmailVerificationStatus.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { rememberedLoginIdentifier, rememberLoginIdentifier } from '../../lib/login-identifier.js';
import { isConfiguredBaseDomainHost, usesPlatformAuthSurface } from '../../lib/tenant.js';
import { CardTitle, DemoValue, FinePrint } from '../../theme.js';

const MAGIC_LINK_BODY_ID = 'login-magic-link-body';

const invalidTokenFromLocation = (): boolean =>
  new URLSearchParams(window.location.search).get('error') === 'INVALID_TOKEN';

export const LoginPage = ({ hostname = window.location.hostname }: { hostname?: string } = {}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const magicLinkExpired = invalidTokenFromLocation();
  const [email, setEmail] = useState(rememberedLoginIdentifier);
  const [method, setMethod] = useState<SignInMethod | null>(null);
  const [password, setPassword] = useState('');
  const [requestedMagicEmail, setRequestedMagicEmail] = useState('');
  const [twoFactorRequired, setTwoFactorRequired] = useState(
    () => new URLSearchParams(window.location.search).get('twoFactor') === 'required',
  );
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const authConfig = useQuery(actions.authConfig);
  const resolveTenantOffer = !isConfiguredBaseDomainHost(hostname);
  const publicOffer = useQuery({ ...actions.publicOffer, enabled: resolveTenantOffer });
  const eyebrow = usesPlatformAuthSurface(hostname)
    ? t.auth.signInPlatformEyebrow
    : t.auth.signInEyebrow({ host: hostname });

  const resolveSignInMethods = useMutation({
    ...actions.resolveSignInMethods,
    onSuccess: (result) => {
      const offersPassword = result.methods.includes('password') && !magicLinkExpired;
      setMethod(offersPassword ? 'password' : 'magic-link');
    },
    onError: () => {
      setMethod('magic-link');
    },
  });

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
    enabled: authConfig.data?.exposeMagicLinks === true && requestedMagicEmail.length > 0,
  });

  const submitIdentifier = (event: FormEvent) => {
    event.preventDefault();
    const identifier = email.trim();
    setEmail(identifier);
    rememberLoginIdentifier(identifier);
    resolveSignInMethods.mutate({ email: identifier });
  };

  const editIdentifier = () => {
    setMethod(null);
    setPassword('');
    resolveSignInMethods.reset();
    signIn.reset();
    requestMagicLink.reset();
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    signIn.mutate({ email, password });
  };

  const submitMagicLink = (event: FormEvent) => {
    event.preventDefault();
    setRequestedMagicEmail('');
    requestMagicLink.mutate({ email, callbackURL: `${window.location.origin}/my`, language });
  };

  const submitTwoFactor = (event: FormEvent) => {
    event.preventDefault();
    verifyTotp.mutate({ code: twoFactorCode.trim() });
  };

  const footer = (
    <>
      {authConfig.isError || publicOffer.isError ? (
        <Stack useFlexGap spacing="0.75rem" sx={{ mb: '1.25rem' }}>
          {authConfig.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(authConfig.error, t), retry: { label: t.common.retry, onRetry: () => void authConfig.refetch() } }} /> : null}
          {publicOffer.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(publicOffer.error, t), retry: { label: t.common.retry, onRetry: () => void publicOffer.refetch() } }} /> : null}
        </Stack>
      ) : null}
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
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: '1.2rem' }}>
        <BuildStamp />
      </Box>
    </>
  );

  if (requestedMagicEmail) {
    return (
      <FocusCard brand={<BrandMark tenantAware={resolveTenantOffer} />} eyebrow={eyebrow} footer={footer}>
        <Stack useFlexGap spacing="1rem" data-testid="magic-link-sent">
          <CardTitle variant="h1">{t.auth.magicLinkRequested}</CardTitle>
          <Typography variant="body1">
            {t.auth.magicLinkRequestedBody({ email: requestedMagicEmail })}
          </Typography>
          {devMagicLink.isLoading ? (
            <FinePrint variant="caption" component="p">
              {t.auth.magicLinkFetching}
            </FinePrint>
          ) : null}
          {devMagicLink.data?.magicLink ? (
            <Button component="a" href={devMagicLink.data.magicLink.url} variant="contained" fullWidth>
              {t.auth.openMagicLink}
            </Button>
          ) : null}
        </Stack>
      </FocusCard>
    );
  }

  if (twoFactorRequired) {
    return (
      <FocusCard brand={<BrandMark tenantAware={resolveTenantOffer} />} eyebrow={eyebrow} footer={footer}>
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

  if (method === null) {
    return (
      <FocusCard brand={<BrandMark tenantAware={resolveTenantOffer} />} eyebrow={eyebrow} footer={footer}>
        {magicLinkExpired ? (
          <Alert severity="error" sx={{ mb: '1rem' }}>
            {t.auth.magicLinkExpired}
          </Alert>
        ) : (
          <EmailVerificationResult />
        )}
        <Stack component="form" onSubmit={submitIdentifier} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="login-email">{t.auth.emailLabel}</FormLabel>
            <OutlinedInput
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoFocus
              disabled={resolveSignInMethods.isPending}
              inputProps={{ 'data-testid': 'login-email' }}
              required
            />
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={resolveSignInMethods.isPending}
            data-testid="login-continue"
            sx={{ mt: '0.4rem' }}
          >
            {resolveSignInMethods.isPending ? t.auth.identifierPending : t.auth.identifierContinue}
          </Button>
        </Stack>
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
      </FocusCard>
    );
  }

  const changeIdentifierButton = (
    <Box>
      <Button
        type="button"
        variant="text"
        size="small"
        sx={{ px: 0 }}
        data-testid="login-change-email"
        onClick={editIdentifier}
      >
        {t.auth.changeIdentifier}
      </Button>
    </Box>
  );

  return (
    <FocusCard brand={<BrandMark tenantAware={resolveTenantOffer} />} eyebrow={eyebrow} footer={footer}>
      {method === 'password' ? (
        <>
          <Stack component="form" onSubmit={submitPassword} useFlexGap spacing="1rem">
            <FormControl fullWidth>
              <FormLabel htmlFor="login-identity-email">{t.auth.emailLabel}</FormLabel>
              <OutlinedInput
                id="login-identity-email"
                type="email"
                value={email}
                readOnly
                autoComplete="username"
                inputProps={{ 'data-testid': 'login-identity-email' }}
              />
            </FormControl>
            {changeIdentifierButton}
            <FormControl fullWidth>
              <FormLabel htmlFor="login-password">{t.auth.passwordLabel}</FormLabel>
              <OutlinedInput
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
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
          <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
          <FinePrint variant="caption" component="p" sx={{ mb: '0.6rem' }} data-testid="forgot-password">
            {t.auth.forgotPassword} <MuiLink component={Link} to="/forgot-password">{t.auth.forgotPasswordLink}</MuiLink>
          </FinePrint>
          <Button
            type="button"
            variant="text"
            fullWidth
            data-testid="use-magic-link"
            onClick={() => setMethod('magic-link')}
          >
            {t.auth.useMagicLinkInstead}
          </Button>
        </>
      ) : (
        <>
          <Stack useFlexGap spacing="0.2rem" sx={{ mb: '1rem' }}>
            <FinePrint variant="caption" component="p" data-testid="login-identity">
              {t.auth.signingInAs({ email })}
            </FinePrint>
            {changeIdentifierButton}
          </Stack>
          {resolveSignInMethods.isError ? (
            <Alert severity="warning" sx={{ mb: '1rem' }} data-testid="sign-in-methods-unavailable">
              {t.auth.signInMethodsUnavailable}
            </Alert>
          ) : null}
          <Stack component="form" onSubmit={submitMagicLink} useFlexGap spacing="1rem">
            <Typography variant="body1" id={MAGIC_LINK_BODY_ID}>{t.auth.magicLinkStepBody}</Typography>
            <Button
              type="submit"
              variant="contained"
              fullWidth
              autoFocus
              aria-describedby={MAGIC_LINK_BODY_ID}
              disabled={requestMagicLink.isPending}
              data-testid="send-magic-link"
            >
              {requestMagicLink.isPending ? t.auth.magicLinkPending : t.auth.magicLinkIdle}
            </Button>
          </Stack>
          {requestMagicLink.isError ? (
            <Alert severity="error" sx={{ mt: '0.6rem' }}>
              {localizeError(requestMagicLink.error, t)}
            </Alert>
          ) : null}
          <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
          <Button
            type="button"
            variant="text"
            fullWidth
            data-testid="use-password"
            onClick={() => setMethod('password')}
          >
            {t.auth.usePasswordInstead}
          </Button>
        </>
      )}
    </FocusCard>
  );
};
