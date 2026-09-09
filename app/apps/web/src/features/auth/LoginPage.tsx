import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Link as MuiLink,
  Stack,
  SvgIcon,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import type { SignInMethod } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { BuildStamp } from '../../components/ui/BuildStamp.js';
import { EmailVerificationResult } from '../../components/ui/EmailVerificationStatus.js';
import { errorCodeOf, localizeError, retryAfterSecondsOf, useLanguage, useTranslations } from '../../i18n/index.js';
import { rememberedLoginIdentifier, rememberLoginIdentifier } from '../../lib/login-identifier.js';
import { isConfiguredBaseDomainHost, usesPlatformAuthSurface } from '../../lib/tenant.js';
import { DemoValue, FinePrint, VisuallyHidden } from '../../theme.js';
import {
  AuthDivider,
  AuthHelp,
  AuthIdentityAvatar,
  AuthIdentityChip,
  AuthIdentityEmail,
  AuthInput,
  AuthLead,
  AuthMethodBody,
  AuthMethodButton,
  AuthMethodCard,
  AuthMethodChevron,
  AuthMethodHead,
  AuthMethodIcon,
  AuthMethodList,
  AuthMethodPanel,
  AuthMethodTitle,
  AuthPasskeyLink,
  AuthTitle,
} from './auth-chrome.js';
import { useRedirectSignedInWithTenant } from './auth-redirect.js';
import { PasskeyOutlineIcon } from './auth-icons.js';
import { AuthShell } from './AuthShell.js';

const IDENTITY_ID = 'login-identity';
const EMAIL_ERROR_ID = 'login-email-error';
const EMAIL_HELPER_ID = 'login-email-helper';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const RESEND_COOLDOWN_SECONDS = 30;

const invalidTokenFromLocation = (): boolean =>
  new URLSearchParams(window.location.search).get('error') === 'INVALID_TOKEN';

const MailIcon = () => (
  <SvgIcon aria-hidden>
    <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v.4l8 5 8-5V7H4Zm16 10V9.7l-8 5-8-5V17h16Z" />
  </SvgIcon>
);

const LockIcon = () => (
  <SvgIcon aria-hidden>
    <path d="M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm3 8V7a3 3 0 1 0-6 0v3h6Z" />
  </SvgIcon>
);

const PasskeyIcon = () => (
  <SvgIcon aria-hidden>
    <path d="M10 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 10c.7 0 1.37.07 2 .2A5.5 5.5 0 0 0 11.2 21H3a1 1 0 0 1-1-1v-1c0-3.31 3.58-6 8-6Zm7.5 1a3.5 3.5 0 0 1 1.5 6.66V22l-1.5 1-1.5-1v-2.34A3.5 3.5 0 0 1 17.5 14Zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
  </SvgIcon>
);

const ChevronIcon = () => (
  <SvgIcon aria-hidden fontSize="small">
    <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.42 1.41l4.58-4.58a1 1 0 0 0 0-1.42L10.71 6.71a1 1 0 0 0-1.42 0Z" />
  </SvgIcon>
);

const initialsOf = (email: string): string =>
  (email.match(/[a-z0-9]/giu)?.slice(0, 2).join('') ?? '?').toUpperCase();
const demoAccountEmail = 'creator@together.dev';
const demoAccountPassword = 'demo-password-15';

const MethodCard = ({
  featured = false,
  icon,
  title,
  body,
  testId,
  disabled = false,
  onClick,
  panel,
}: {
  featured?: boolean;
  icon: ReactNode;
  title: string;
  body: string;
  testId: string;
  disabled?: boolean;
  onClick?: () => void;
  panel?: ReactNode;
}) => {
  const label = (
    <>
      <AuthMethodIcon>{icon}</AuthMethodIcon>
      <span>
        <AuthMethodTitle>{title}</AuthMethodTitle>
        <AuthMethodBody>{body}</AuthMethodBody>
      </span>
    </>
  );
  return (
    <AuthMethodCard featured={featured}>
      {onClick === undefined ? (
        <AuthMethodHead data-testid={testId}>{label}</AuthMethodHead>
      ) : (
        <AuthMethodButton type="button" data-testid={testId} disabled={disabled} onClick={onClick}>
          {label}
          <AuthMethodChevron>
            <ChevronIcon />
          </AuthMethodChevron>
        </AuthMethodButton>
      )}
      {panel === undefined ? null : <AuthMethodPanel>{panel}</AuthMethodPanel>}
    </AuthMethodCard>
  );
};

export const LoginPage = ({ hostname = window.location.hostname }: { hostname?: string } = {}) => {
  const t = useTranslations();
  const { explicitLanguage } = useLanguage();
  const me = useRedirectSignedInWithTenant();
  const magicLinkExpired = invalidTokenFromLocation();
  const [email, setEmail] = useState(rememberedLoginIdentifier);
  const [identifierInvalid, setIdentifierInvalid] = useState(false);
  const [method, setMethod] = useState<SignInMethod | null>(null);
  const [passwordKnownFor, setPasswordKnownFor] = useState<string | null>(null);
  const [resolveFailure, setResolveFailure] = useState<Error | null>(null);
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
  const platformSurface = usesPlatformAuthSurface(hostname);
  const tenantName = publicOffer.data?.tenant.name ?? null;
  const tenantNamePending = resolveTenantOffer && publicOffer.isPending;

  useEffect(() => {
    if (resendCooldown === 0) return undefined;
    const timer = window.setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const resolveSignInMethods = useMutation({
    ...actions.resolveSignInMethods,
    onSuccess: (result, variables) => {
      const hasPassword = result.methods.includes('password');
      setPasswordKnownFor(hasPassword ? variables.email : null);
      setResolveFailure(null);
      setMethod(hasPassword && !magicLinkExpired ? 'password' : 'magic-link');
    },
    onError: (error, variables) => {
      if (passwordKnownFor === variables.email && !magicLinkExpired) {
        setMethod('password');
        return;
      }
      setResolveFailure(error);
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
  const { mutate: promptGoogleOneTap } = useMutation(actions.promptGoogleOneTap);

  useEffect(() => {
    const clientId = authConfig.data?.googleClientId;
    if (clientId === null || clientId === undefined || me.isPending || me.data !== undefined) return;
    promptGoogleOneTap({ clientId, callbackURL: window.location.origin });
  }, [authConfig.data?.googleClientId, me.data, me.isPending, promptGoogleOneTap]);

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
    setResolveFailure(null);
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
    setResolveFailure(null);
    setPassword('');
    setMethod(next);
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    signIn.mutate({ email, password });
  };

  const sendMagicLink = () => {
    setRequestedMagicEmail('');
    setMagicLinkResent(false);
    requestMagicLink.mutate({
      email,
      callbackURL: `${window.location.origin}/my`,
      ...(explicitLanguage === undefined ? {} : { language: explicitLanguage }),
    });
  };

  const resendMagicLink = () => {
    setMagicLinkResent(false);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    requestMagicLink.mutate(
      {
        email: requestedMagicEmail,
        callbackURL: `${window.location.origin}/my`,
        ...(explicitLanguage === undefined ? {} : { language: explicitLanguage }),
      },
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

  const changeIdentifierLink = (label: string) => (
    <MuiLink
      component="button"
      type="button"
      underline="always"
      data-testid="login-change-email"
      aria-label={t.auth.changeIdentifier}
      onClick={editIdentifier}
      sx={{
        textUnderlineOffset: '0.15em',
        minHeight: 44,
        minWidth: 44,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {label}
    </MuiLink>
  );

  const identityChip = (
    <AuthIdentityChip
      data-testid={IDENTITY_ID}
      role="group"
      aria-label={t.auth.signingInAs({ email })}
    >
      <AuthIdentityAvatar aria-hidden>{initialsOf(email)}</AuthIdentityAvatar>
      <AuthIdentityEmail>{email}</AuthIdentityEmail>
      {changeIdentifierLink(t.auth.changeIdentifierShort)}
    </AuthIdentityChip>
  );

  const resolveRetryAfterSeconds = retryAfterSecondsOf(resolveFailure);
  const resolveFailureMessage =
    errorCodeOf(resolveFailure) === 'rate_limited'
      ? resolveRetryAfterSeconds === null
        ? t.auth.signInMethodsRateLimited
        : t.auth.signInMethodsRateLimitedRetryAfter({ seconds: resolveRetryAfterSeconds })
      : t.auth.signInMethodsUnavailable;

  const showDemoAccount =
    authConfig.data?.exposeMagicLinks === true &&
    platformSurface &&
    method === null &&
    !twoFactorRequired &&
    requestedMagicEmail === '';

  const accessPrompt = platformSurface ? (
    <FinePrint key="access" variant="caption" component="p" data-testid="login-register-prompt">
      {t.auth.registerPrompt} <MuiLink component={Link} to="/register">{t.auth.registerLink}</MuiLink>
    </FinePrint>
  ) : null;

  const notices =
    authConfig.isError || publicOffer.isError ? (
      <Stack useFlexGap spacing="0.75rem" sx={{ mb: '1.25rem' }}>
        {authConfig.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(authConfig.error, t), retry: { label: t.common.retry, onRetry: () => void authConfig.refetch() } }} /> : null}
        {publicOffer.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(publicOffer.error, t), retry: { label: t.common.retry, onRetry: () => void publicOffer.refetch() } }} /> : null}
      </Stack>
    ) : null;

  const previewLessons = publicOffer.data?.previewLessons ?? [];

  const footerItems = [
    showDemoAccount ? (
      <FinePrint key="demo" variant="caption" component="p">
        {t.auth.demoAccount} <DemoValue>{demoAccountEmail}</DemoValue> /{' '}
        <DemoValue>{demoAccountPassword}</DemoValue>
      </FinePrint>
    ) : null,
    accessPrompt,
    previewLessons.length === 0 ? null : (
      <Box key="preview">
        <FinePrint variant="caption" component="p" sx={{ mb: '0.35em' }}>
          {t.auth.previewLessons}
        </FinePrint>
        <Stack useFlexGap spacing="0.25em">
          {previewLessons.map((lesson) => (
            <MuiLink key={`${lesson.courseId}:${lesson.id}`} component={Link} to={`/my/courses/${encodeURIComponent(lesson.courseId)}/lessons/${encodeURIComponent(lesson.id)}`}>
              {lesson.name}
            </MuiLink>
          ))}
        </Stack>
      </Box>
    ),
    platformSurface ? (
      <Box key="build" sx={{ display: 'flex', justifyContent: 'flex-start' }}>
        <BuildStamp />
      </Box>
    ) : null,
  ].filter((item) => item !== null);

  const footer =
    footerItems.length === 0 ? null : (
      <Stack useFlexGap spacing="0.6rem" sx={{ mt: '1.75rem' }}>
        {footerItems}
      </Stack>
    );

  const shell = (children: ReactNode, pageFooter: ReactNode = footer) => (
    <AuthShell hostname={hostname} footer={pageFooter}>
      {notices}
      {children}
    </AuthShell>
  );

  if (requestedMagicEmail) {
    return shell(
      <Stack useFlexGap spacing="1rem" data-testid="magic-link-sent">
        <Box>
          <AuthTitle variant="h1">{t.auth.checkInboxTitle}</AuthTitle>
          <AuthLead component="p">
            {t.auth.magicLinkRequestedBody({ email: requestedMagicEmail })}
          </AuthLead>
        </Box>
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
        <FinePrint variant="caption" component="p">
          {changeIdentifierLink(t.auth.changeIdentifier)}
        </FinePrint>
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
      </Stack>,
    );
  }

  if (twoFactorRequired) {
    return shell(
      <Stack component="form" onSubmit={submitTwoFactor} useFlexGap spacing="1rem" data-testid="two-factor-challenge">
        <Box>
          <AuthTitle variant="h1">{t.auth.twoFactorTitle}</AuthTitle>
          <AuthLead component="p">{t.auth.twoFactorIntro}</AuthLead>
        </Box>
        <FormControl fullWidth>
          <FormLabel htmlFor="two-factor-code">{t.auth.twoFactorCodeLabel}</FormLabel>
          <AuthInput
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
      </Stack>,
      null,
    );
  }

  if (method === null && resolveFailure !== null) {
    return shell(
      <>
        {identityChip}
        <Alert
          severity="error"
          role="alert"
          sx={{ mb: '1rem' }}
          data-testid="sign-in-methods-unavailable"
        >
          <Stack useFlexGap spacing="0.75rem" sx={{ width: '100%' }}>
            <Typography variant="body2">{resolveFailureMessage}</Typography>
            <Button
              variant="outlined"
              color="inherit"
              fullWidth
              data-testid="sign-in-methods-retry"
              disabled={resolveSignInMethods.isPending}
              onClick={() => resolveSignInMethods.mutate({ email })}
              sx={{ minHeight: '44px' }}
            >
              {t.common.retry}
            </Button>
          </Stack>
        </Alert>
        <Stack useFlexGap spacing="0.75rem">
          <Typography variant="body1">{t.auth.signInMethodsChoosePrompt}</Typography>
          <Button
            variant="outlined"
            fullWidth
            data-testid="choose-magic-link"
            onClick={() => switchMethod('magic-link')}
          >
            {t.auth.signInMethodsChooseMagicLink}
          </Button>
          <Button
            variant="outlined"
            fullWidth
            data-testid="choose-password"
            onClick={() => switchMethod('password')}
          >
            {t.auth.signInMethodsChoosePassword}
          </Button>
        </Stack>
      </>,
      null,
    );
  }

  if (method === null) {
    return shell(
      <>
        {magicLinkExpired ? (
          <Alert severity="error" sx={{ mb: '1rem' }}>
            {t.auth.magicLinkExpired}
          </Alert>
        ) : (
          <EmailVerificationResult />
        )}
        <Box sx={{ mb: '1.5rem' }}>
          {tenantNamePending ? (
            <AuthTitle aria-hidden sx={{ visibility: 'hidden' }}>
              {t.auth.signInTitle}
            </AuthTitle>
          ) : (
            <AuthTitle variant="h1">
              {tenantName === null
                ? t.auth.signInTitle
                : t.auth.signInToTenant({ tenant: tenantName })}
            </AuthTitle>
          )}
          <AuthLead component="p">{t.auth.signInLead}</AuthLead>
        </Box>
        <Stack component="form" noValidate onSubmit={submitIdentifier} useFlexGap spacing="1rem">
          <FormControl fullWidth error={identifierInvalid}>
            <FormLabel htmlFor="login-email">{t.auth.emailLabel}</FormLabel>
            <AuthInput
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setIdentifierInvalid(false);
              }}
              placeholder={t.auth.emailPlaceholder}
              autoComplete="email"
              autoFocus
              readOnly={resolveSignInMethods.isPending}
              aria-busy={resolveSignInMethods.isPending}
              aria-invalid={identifierInvalid}
              aria-describedby={identifierInvalid ? EMAIL_ERROR_ID : EMAIL_HELPER_ID}
              inputProps={{ 'data-testid': 'login-email', inputMode: 'email' }}
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
          >
            {resolveSignInMethods.isPending ? t.auth.identifierPending : t.auth.identifierContinue}
          </Button>
          <AuthHelp component="p" id={EMAIL_HELPER_ID} data-testid="login-email-helper">
            {t.auth.emailHelper}
          </AuthHelp>
          <VisuallyHidden role="status" aria-live="polite">
            {resolveSignInMethods.isPending ? t.auth.identifierPending : ''}
          </VisuallyHidden>
        </Stack>
        <AuthDivider aria-hidden>{t.auth.orSeparator}</AuthDivider>
        <Stack useFlexGap spacing="0.6rem">
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
          <AuthPasskeyLink
            variant="text"
            fullWidth
            data-testid="signin-passkey"
            disabled={signInWithPasskey.isPending}
            onClick={() => signInWithPasskey.mutate()}
          >
            <PasskeyOutlineIcon />
            {signInWithPasskey.isPending ? t.auth.passkeyPending : t.auth.passkeyLink}
          </AuthPasskeyLink>
          {signInWithGoogle.isError ? <Alert severity="error">{localizeError(signInWithGoogle.error, t)}</Alert> : null}
          {signInWithPasskey.isError ? (
            <Alert severity="error">{localizeError(signInWithPasskey.error, t)}</Alert>
          ) : null}
        </Stack>
      </>,
    );
  }

  return shell(
    <>
      {identityChip}
      <Box sx={{ mb: '1.5rem' }}>
        <AuthTitle variant="h1">{t.auth.methodTitle}</AuthTitle>
        <AuthLead component="p">{t.auth.methodLead}</AuthLead>
      </Box>
      {magicLinkExpired ? (
        <Alert severity="info" sx={{ mb: '1rem' }} data-testid="magic-link-expired-step">
          {t.auth.magicLinkExpiredOnStep}
        </Alert>
      ) : null}
      {signIn.isError ? (
        <Alert severity="error" role="alert" sx={{ mb: '1rem' }} data-testid="signin-error">
          {localizeError(signIn.error, t)}
        </Alert>
      ) : null}
      {requestMagicLink.isError ? (
        <Alert severity="error" role="alert" sx={{ mb: '1rem' }}>
          {localizeError(requestMagicLink.error, t)}
        </Alert>
      ) : null}
      <AuthMethodList>
        <MethodCard
          featured
          icon={<MailIcon />}
          title={t.auth.methodMagicLinkTitle}
          body={requestMagicLink.isPending ? t.auth.magicLinkPending : t.auth.methodMagicLinkBody}
          testId="send-magic-link"
          disabled={requestMagicLink.isPending}
          onClick={sendMagicLink}
        />
        <MethodCard
          icon={<LockIcon />}
          title={t.auth.methodPasswordTitle}
          body={t.auth.methodPasswordBody}
          testId="use-password"
          {...(method === 'password'
            ? {}
            : { onClick: () => switchMethod('password') })}
          {...(method === 'password'
            ? {
                panel: (
                  <>
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
                        <AuthInput
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
                      >
                        {signIn.isPending ? t.auth.signInPending : t.auth.signInIdle}
                      </Button>
                    </Stack>
                    <FinePrint variant="caption" component="p" sx={{ mt: '0.75rem' }}>
                      <MuiLink component={Link} to="/forgot-password" data-testid="forgot-password">
                        {t.auth.forgotPassword}
                      </MuiLink>
                    </FinePrint>
                  </>
                ),
              }
            : {})}
        />
        <MethodCard
          icon={<PasskeyIcon />}
          title={t.auth.methodPasskeyTitle}
          body={signInWithPasskey.isPending ? t.auth.passkeyPending : t.auth.methodPasskeyBody}
          testId="signin-passkey"
          disabled={signInWithPasskey.isPending}
          onClick={() => signInWithPasskey.mutate()}
        />
        {authConfig.data?.googleEnabled ? (
          <AuthMethodCard>
            <Button
              data-testid="continue-google"
              variant="text"
              fullWidth
              disabled={signInWithGoogle.isPending}
              onClick={() => signInWithGoogle.mutate()}
              sx={{ minHeight: 64 }}
            >
              {t.auth.continueWithGoogle}
            </Button>
          </AuthMethodCard>
        ) : null}
      </AuthMethodList>
      {signInWithPasskey.isError ? (
        <Alert severity="error" sx={{ mt: '1rem' }}>{localizeError(signInWithPasskey.error, t)}</Alert>
      ) : null}
      {signInWithGoogle.isError ? (
        <Alert severity="error" sx={{ mt: '1rem' }}>{localizeError(signInWithGoogle.error, t)}</Alert>
      ) : null}
    </>,
  );
};
