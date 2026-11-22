import { useRef, useState, type FormEvent, type RefObject } from 'react';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';

import { PASSWORD_MIN_LENGTH, passwordMeetsMinimumLength } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { TermsConsentField } from '../../components/ui/TermsConsentField.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { loginCallbackUrl, returnToFromSearch } from '../../lib/auth-return.js';
import { appBaseDomain, isConfiguredBaseDomainHost, isTenantHost } from '../../lib/tenant.js';
import { FinePrint } from '../../theme.js';
import { AuthInput, AuthLead, AuthTitle } from './auth-chrome.js';
import { describedBy, EMAIL_PATTERN } from './auth-fields.js';
import { AuthPasswordInput } from './auth-password-input.js';
import { useRedirectSignedInWithTenant } from './auth-redirect.js';
import { AuthShell } from './AuthShell.js';

const PASSWORD_HINT_ID = 'register-password-minimum';
const REGISTER_FIELDS = ['name', 'email', 'password', 'terms'] as const;
type RegisterField = (typeof REGISTER_FIELDS)[number];
type RegisterFieldErrors = Record<RegisterField, string | null>;
const NO_FIELD_ERRORS: RegisterFieldErrors = { name: null, email: null, password: null, terms: null };
const fieldErrorId = (field: RegisterField): string => `register-${field}-error`;
const errorIdOf = (field: RegisterField, errors: RegisterFieldErrors): string | null =>
  errors[field] === null ? null : fieldErrorId(field);

const baseDomainUrl = (): string => {
  const { protocol, port } = window.location;
  return `${protocol}//${appBaseDomain()}${port ? `:${port}` : ''}`;
};

export const RegisterPage = ({ hostname = window.location.hostname }: { hostname?: string } = {}) => {
  const t = useTranslations();
  const { explicitLanguage } = useLanguage();
  useRedirectSignedInWithTenant();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const returnTo = returnToFromSearch(search);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>(NO_FIELD_ERRORS);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<RegisterField, RefObject<HTMLInputElement | null>> = {
    name: nameRef,
    email: emailRef,
    password: passwordRef,
    terms: termsRef,
  };
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [registeredOnTenant, setRegisteredOnTenant] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const resolveTenantOffer = !isConfiguredBaseDomainHost(hostname);
  const offer = useQuery({ ...actions.publicOffer, enabled: resolveTenantOffer });
  const onOtherTenantHost = isTenantHost(hostname);
  const legal = offer.data?.tenant.legal ?? null;
  const consentRequired = legal !== null && (legal.termsUrl !== null || legal.privacyUrl !== null);

  const signUp = useMutation({
    ...actions.signUp,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      if (onOtherTenantHost) {
        setRegisteredOnTenant(true);
        return;
      }
      await navigate({ to: '/' });
    },
  });

  const clearFieldError = (field: RegisterField) =>
    setFieldErrors((current) => (current[field] === null ? current : { ...current, [field]: null }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signUp.reset();
    const normalizedEmail = email.trim();
    const errors: RegisterFieldErrors = {
      name: name.trim() === '' ? t.auth.nameRequired : null,
      email: normalizedEmail === ''
        ? t.auth.emailRequired
        : EMAIL_PATTERN.test(normalizedEmail) ? null : t.auth.emailInvalid,
      password: password === ''
        ? t.auth.passwordRequired
        : passwordMeetsMinimumLength(password) ? null : t.auth.passwordTooShort({ min: PASSWORD_MIN_LENGTH }),
      terms: consentRequired && !termsAccepted ? t.consent.required : null,
    };
    setFieldErrors(errors);
    const firstInvalid = REGISTER_FIELDS.find((field) => errors[field] !== null);
    if (firstInvalid !== undefined) {
      fieldRefs[firstInvalid].current?.focus();
      return;
    }
    signUp.mutate({
      name,
      email: normalizedEmail,
      password,
      callbackURL: loginCallbackUrl(returnTo),
      ...(explicitLanguage === undefined ? {} : { language: explicitLanguage }),
      ...(consentRequired ? { termsAccepted } : {}),
    });
  };

  if (registeredOnTenant) {
    return (
      <AuthShell title={t.auth.registeredTitle} hostname={hostname}>
        <Box sx={{ mb: '1.5rem' }}>
          <AuthTitle variant="h1">{t.auth.registeredTitle}</AuthTitle>
          <AuthLead component="p">{t.auth.registeredOnTenantBody({ host: hostname })}</AuthLead>
        </Box>
        <Stack useFlexGap spacing="0.9rem">
          <Button variant="contained" fullWidth component="a" href={baseDomainUrl()}>
            {t.auth.registeredCreateOwnCta}
          </Button>
          <Box>
            <FinePrint variant="caption" component="p" sx={{ mb: '0.4rem' }}>
              {t.auth.registeredBoughtHint}
            </FinePrint>
            <MuiLink component={Link} to={returnTo === null ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`}>{t.auth.registeredUseMagicLinkCta}</MuiLink>
          </Box>
        </Stack>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t.auth.createAccount}
      hostname={hostname}
      footer={
        <FinePrint variant="caption" component="p" sx={{ mt: '1.75rem' }}>
          {t.auth.alreadyHaveAccount} <MuiLink component={Link} to={returnTo === null ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`}>{t.auth.signInLink}</MuiLink>
        </FinePrint>
      }
    >
      {offer.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(offer.error, t), retry: { label: t.common.retry, onRetry: () => void offer.refetch() } }} /> : null}
        <Box sx={{ mb: '1.5rem' }}>
          <AuthTitle variant="h1">{t.auth.createAccount}</AuthTitle>
          <AuthLead component="p">{t.auth.createAccountLead}</AuthLead>
        </Box>
        <Stack component="form" noValidate onSubmit={submit} useFlexGap spacing="1rem">
          <FormControl fullWidth error={fieldErrors.name !== null}>
            <FormLabel htmlFor="register-name">{t.auth.nameLabel}</FormLabel>
            <AuthInput
              id="register-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                clearFieldError('name');
              }}
              autoComplete="name"
              inputRef={nameRef}
              {...describedBy(errorIdOf('name', fieldErrors))}
              required
            />
            {fieldErrors.name === null ? null : (
              <FormHelperText id={fieldErrorId('name')}>{fieldErrors.name}</FormHelperText>
            )}
          </FormControl>
          <FormControl fullWidth error={fieldErrors.email !== null}>
            <FormLabel htmlFor="register-email">{t.auth.emailLabel}</FormLabel>
            <AuthInput
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                clearFieldError('email');
              }}
              autoComplete="email"
              inputRef={emailRef}
              {...describedBy(errorIdOf('email', fieldErrors))}
              required
            />
            {fieldErrors.email === null ? null : (
              <FormHelperText id={fieldErrorId('email')}>{fieldErrors.email}</FormHelperText>
            )}
          </FormControl>
          <FormControl fullWidth error={fieldErrors.password !== null}>
            <FormLabel htmlFor="register-password">{t.auth.passwordLabel}</FormLabel>
            <AuthPasswordInput
              id="register-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearFieldError('password');
              }}
              autoComplete="new-password"
              inputRef={passwordRef}
              {...describedBy(errorIdOf('password', fieldErrors), PASSWORD_HINT_ID)}
              required
            />
            {fieldErrors.password === null ? null : (
              <FormHelperText id={fieldErrorId('password')}>{fieldErrors.password}</FormHelperText>
            )}
            <FormHelperText id={PASSWORD_HINT_ID} error={false}>{t.changePassword.minimumHint({ min: PASSWORD_MIN_LENGTH })}</FormHelperText>
          </FormControl>
          {consentRequired ? (
            <TermsConsentField
              legal={legal}
              checked={termsAccepted}
              onChange={(checked) => {
                setTermsAccepted(checked);
                clearFieldError('terms');
              }}
              error={fieldErrors.terms}
              inputRef={termsRef}
            />
          ) : null}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={signUp.isPending || (resolveTenantOffer && offer.isPending)}
          >
            {signUp.isPending ? t.auth.creatingAccount : t.auth.createAccount}
          </Button>
        </Stack>
        {signUp.isError ? (
          <Alert severity="error" sx={{ mt: '0.6rem' }} data-testid="register-error">
            {localizeError(signUp.error, t)}
          </Alert>
        ) : null}
    </AuthShell>
  );
};
