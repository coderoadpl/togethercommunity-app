import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormHelperText,
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
import { DemoValue, FinePrint, VisuallyHidden } from '../../theme.js';

const MAGIC_LINK_BODY_ID = 'login-magic-link-body';
const IDENTITY_ID = 'login-identity';
const EMAIL_ERROR_ID = 'login-email-error';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const RESEND_COOLDOWN_SECONDS = 30;

const invalidTokenFromLocation = (): boolean =>
  new URLSearchParams(window.location.search).get('error') === 'INVALID_TOKEN';

export const LoginPage = ({ hostname = window.location.hostname }: { hostname?: string } = {}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const magicLinkExpired = invalidTokenFromLocation();
  const [email, setEmail] = useState(rememberedLoginIdentifier);
  const [identifierInvalid, setIdentifierInvalid] = useState(false);
  const [method, setMethod] = useState<SignInMethod | null>(null);
  const [password, setPassword] = useState('');
  const [requestedMagicEmail, setRequestedMagicEmail] = useState('');
  const [magicLinkResent, setMagicLinkResent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [twoFactorRequired, setTwoFactorRequired] = useState(
    () => new URLSearchParams(window.location.search).get('twoFactor') === 'required',
  );
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const twoFactorCodeRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const authConfig = useQuery(actions.authConfig);
  const resolveTenantOffer = !isConfiguredBaseDomainHost(hostname);
  const publicOffer = useQuery({ ...actions.publicOffer, enabled: resolveTenantOffer });
  const eyebrow = usesPlatformAuthSurface(hostname)
    ? t.auth.signInPlatformEyebrow
    : t.auth.signInEyebrow({ host: hostname });

  useEffect(() => {
    if (resendCooldown === 0) return undefined;
    const timer = window.setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

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
    if (resolveSignInMethods.isPending) return;
    const identifier = email.trim();
    if (!EMAIL_PATTERN.test(identifier)) {
      setIdentifierInvalid(true);
      return;
    }
    setIdentifierInvalid(false);
    setEmail(identifier);
    rememberLoginIdentifier(identifier);
    resolveSignInMethods.mutate({ email: identifier });
  };

  const editIdentifier = () => {
    setMethod(null);
    setPassword('');
    setRequestedMagicEmail('');
    setMagicLinkResent(false);
    setResendCooldown(0);
    resolveSignInMethods.reset();
    signIn.reset();
    requestMagicLink.reset();
  };

  const switchMethod = (next: SignInMethod) => {
    signIn.reset();
    requestMagicLink.reset();
    setPassword('');
    setMethod(next);
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    signIn.mutate({ email, password });
  };

  const submitMagicLink = (event: FormEvent) => {
    event.preventDefault();
    setRequestedMagicEmail('');
    setMagicLinkResent(false);
    requestMagicLink.mutate({ email, callbackURL: `${window.location.origin}/my`, language });
  };

  const resendMagicLink = () => {
    setMagicLinkResent(false);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    requestMagicLink.mutate(
      { email: requestedMagicEmail, callbackURL: `${window.location.origin}/my`, language },
      { onSuccess: () => setMagicLinkResent(true) },
    );
  };

  const submitTwoFactor = (event: FormEvent) => {
    event.preventDefault();
    verifyTotp.mutate({ code: twoFactorCode.trim() });
  };

  const cancelTwoFactor = () => {
    setTwoFactorRequired(false);
    setTwoFactorCode('');
    verifyTotp.reset();
    verifyBackupCode.reset();
    editIdentifier();
    window.history.replaceState(null, '', '/login');
  };

  const changeIdentifierLink = (
    <MuiLink
      component="button"
      type="button"
      color="text.secondary"
      data-testid="login-change-email"
      onClick={editIdentifier}
      sx={{
        textUnderlineOffset: '0.15em',
        minHeight: 44,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {t.auth.changeIdentifier}
    </MuiLink>
  );

  const signingInAs = (
    <FinePrint
      variant="caption"
      component="p"
      id={IDENTITY_ID}
      data-testid={IDENTITY_ID}
      sx={{ overflowWrap: 'anywhere' }}
    >
      {t.auth.signingInAs({ email })} · {changeIdentifierLink}
    </FinePrint>
  );

  const showDemoAccount =
    authConfig.data?.exposeMagicLinks === true &&
    usesPlatformAuthSurface(hostname) &&
    method === null &&
    !twoFactorRequired &&
    requestedMagicEmail === '';

  const footerNotices =
    authConfig.isError || publicOffer.isError ? (
      <Stack useFlexGap spacing="0.75rem" sx={{ mb: '1.25rem' }}>
        {authConfig.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(authConfig.error, t), retry: { label: t.common.retry, onRetry: () => void authConfig.refetch() } }} /> : null}
        {publicOffer.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(publicOffer.error, t), retry: { label: t.common.retry, onRetry: () => void publicOffer.refetch() } }} /> : null}
      </Stack>
    ) : null;

  const footerContact = (
    <>
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

  const footer = (
    <>
      {footerNotices}
      {showDemoAccount ? (
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
      {footerContact}
    </>
  );

  const compactFooter = (
    <>
      {footerNotices}
      {footerContact}
    </>
  );

  if (requestedMagicEmail) {
    return (
      <FocusCard brand={<BrandMark tenantAware={resolveTenantOffer} />} eyebrow={eyebrow} footer={footer}>
        <Stack useFlexGap spacing="1rem" data-testid="magic-link-sent">
          <Typography variant="h2" component="h2">{t.auth.magicLinkRequested}</Typography>
          <Typography variant="body1">
            {t.auth.magicLinkRequestedBody({ email: requestedMagicEmail })}
          </Typography>
          {magicLinkResent ? (
            <FinePrint variant="caption" component="p" role="status">
              {t.auth.magicLinkResent}
            </FinePrint>
          ) : null}
          <FinePrint variant="caption" component="p">
            <MuiLink
              component="button"
              type="button"
              data-testid="resend-magic-link"
              color={resendCooldown > 0 ? 'text.disabled' : undefined}
              disabled={resendCooldown > 0 || requestMagicLink.isPending}
              onClick={resendMagicLink}
            >
              {resendCooldown > 0
                ? t.auth.magicLinkResendCooldown({ seconds: resendCooldown })
                : t.auth.magicLinkResend}
            </MuiLink>
          </FinePrint>
          <FinePrint variant="caption" component="p">{changeIdentifierLink}</FinePrint>
          {requestMagicLink.isError ? (
            <Alert severity="error">{localizeError(requestMagicLink.error, t)}</Alert>
          ) : null}
          {devMagicLink.isLoading ? (
            <FinePrint variant="caption" component="p">
              {t.auth.magicLinkFetching}
            </FinePrint>
          ) : null}
          {devMagicLink.data?.magicLink ? (
            <Button
              component="a"
              href={devMagicLink.data.magicLink.url}
              variant="outlined"
              size="small"
              sx={{ alignSelf: 'flex-start' }}
            >
              {t.auth.openMagicLink}
            </Button>
          ) : null}
        </Stack>
      </FocusCard>
    );
  }

  if (twoFactorRequired) {
    return (
      <FocusCard brand={<BrandMark tenantAware={resolveTenantOffer} />} eyebrow={eyebrow} footer={compactFooter}>
        <Stack component="form" onSubmit={submitTwoFactor} useFlexGap spacing="1rem" data-testid="two-factor-challenge">
          <Typography variant="h2" component="h2">{t.auth.twoFactorTitle}</Typography>
          <Typography variant="body1">{t.auth.twoFactorIntro}</Typography>
          <FormControl fullWidth>
            <FormLabel htmlFor="two-factor-code">{t.auth.twoFactorCodeLabel}</FormLabel>
            <OutlinedInput
              id="two-factor-code"
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value)}
              autoComplete="one-time-code"
              autoFocus
              inputRef={twoFactorCodeRef}
              inputProps={{ 'data-testid': 'two-factor-code', autoCapitalize: 'off', spellCheck: false }}
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
            variant="text"
            size="small"
            sx={{ px: 0, alignSelf: 'flex-start', minHeight: 44 }}
            disabled={verifyTotp.isPending || verifyBackupCode.isPending}
            data-testid="verify-login-backup-code"
            onClick={() => {
              const code = twoFactorCode.trim();
              if (code.length === 0) {
                twoFactorCodeRef.current?.focus();
                return;
              }
              verifyBackupCode.mutate({ code });
            }}
          >
            {verifyBackupCode.isPending ? t.auth.twoFactorVerifying : t.auth.twoFactorUseBackupCode}
          </Button>
          {verifyTotp.isError ? <Alert severity="error">{localizeError(verifyTotp.error, t)}</Alert> : null}
          {verifyBackupCode.isError ? <Alert severity="error">{localizeError(verifyBackupCode.error, t)}</Alert> : null}
          <FinePrint variant="caption" component="p">
            <MuiLink
              component="button"
              type="button"
              data-testid="two-factor-cancel"
              onClick={cancelTwoFactor}
            >
              {t.auth.twoFactorBackToLogin}
            </MuiLink>
          </FinePrint>
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
        <Stack component="form" noValidate onSubmit={submitIdentifier} useFlexGap spacing="1rem">
          <FormControl fullWidth error={identifierInvalid}>
            <FormLabel htmlFor="login-email">{t.auth.emailLabel}</FormLabel>
            <OutlinedInput
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setIdentifierInvalid(false);
              }}
              autoComplete="email"
              autoFocus
              readOnly={resolveSignInMethods.isPending}
              aria-busy={resolveSignInMethods.isPending}
              aria-invalid={identifierInvalid}
              aria-describedby={identifierInvalid ? EMAIL_ERROR_ID : undefined}
              inputProps={{ 'data-testid': 'login-email' }}
              required
            />
            {identifierInvalid ? (
              <FormHelperText id={EMAIL_ERROR_ID}>{t.auth.emailInvalid}</FormHelperText>
            ) : null}
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            aria-busy={resolveSignInMethods.isPending}
            data-testid="login-continue"
            sx={{ mt: '0.4rem' }}
          >
            {resolveSignInMethods.isPending ? t.auth.identifierPending : t.auth.identifierContinue}
          </Button>
          <VisuallyHidden role="status" aria-live="polite">
            {resolveSignInMethods.isPending ? t.auth.identifierPending : ''}
          </VisuallyHidden>
        </Stack>
        <Stack useFlexGap spacing="0.6rem" sx={{ mt: '0.9rem' }}>
          <FinePrint variant="caption" component="p">
            {t.auth.passkeyPrompt}{' '}
            <MuiLink
              component="button"
              type="button"
              data-testid="signin-passkey"
              disabled={signInWithPasskey.isPending}
              onClick={() => signInWithPasskey.mutate()}
            >
              {signInWithPasskey.isPending ? t.auth.passkeyPending : t.auth.passkeyLink}
            </MuiLink>
          </FinePrint>
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

  return (
    <FocusCard brand={<BrandMark tenantAware={resolveTenantOffer} />} eyebrow={eyebrow} footer={footer}>
      {method === 'password' ? (
        <>
          <Box sx={{ mb: '1rem' }}>{signingInAs}</Box>
          <Stack component="form" onSubmit={submitPassword} useFlexGap spacing="1rem">
            <VisuallyHidden aria-hidden>
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={email}
                readOnly
                tabIndex={-1}
                data-testid="login-identity-email"
              />
            </VisuallyHidden>
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
          <FinePrint variant="caption" component="p">
            {t.auth.useMagicLinkPrompt}{' '}
            <MuiLink
              component="button"
              type="button"
              data-testid="use-magic-link"
              onClick={() => switchMethod('magic-link')}
            >
              {t.auth.useMagicLinkInstead}
            </MuiLink>
          </FinePrint>
        </>
      ) : (
        <>
          <Box sx={{ mb: '1rem' }}>{signingInAs}</Box>
          {resolveSignInMethods.isError ? (
            <Alert
              severity="warning"
              sx={{ mb: '1rem' }}
              data-testid="sign-in-methods-unavailable"
              action={
                <Button
                  size="small"
                  color="inherit"
                  data-testid="sign-in-methods-retry"
                  onClick={() => resolveSignInMethods.mutate({ email })}
                >
                  {t.common.retry}
                </Button>
              }
            >
              {t.auth.signInMethodsUnavailable}
            </Alert>
          ) : null}
          {magicLinkExpired ? (
            <Alert severity="info" sx={{ mb: '1rem' }} data-testid="magic-link-expired-step">
              {t.auth.magicLinkExpiredOnStep}
            </Alert>
          ) : null}
          <Stack component="form" onSubmit={submitMagicLink} useFlexGap spacing="1rem">
            <Typography variant="body1" id={MAGIC_LINK_BODY_ID}>{t.auth.magicLinkStepBody}</Typography>
            <Button
              type="submit"
              variant="contained"
              fullWidth
              autoFocus
              aria-describedby={`${IDENTITY_ID} ${MAGIC_LINK_BODY_ID}`}
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
          <FinePrint variant="caption" component="p" sx={{ mt: '1.4rem' }}>
            {t.auth.usePasswordPrompt}{' '}
            <MuiLink
              component="button"
              type="button"
              data-testid="use-password"
              onClick={() => switchMethod('password')}
            >
              {t.auth.usePasswordInstead}
            </MuiLink>
          </FinePrint>
        </>
      )}
    </FocusCard>
  );
};
