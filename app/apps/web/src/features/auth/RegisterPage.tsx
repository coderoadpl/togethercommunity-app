import { useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Stack,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';

import { PASSWORD_MIN_LENGTH, passwordMeetsMinimumLength } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { TermsConsentField } from '../../components/ui/TermsConsentField.js';
import { useToast } from '../../components/ui/Toast.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../i18n/index.js';
import { loginCallbackUrl, returnToFromSearch } from '../../lib/auth-return.js';
import { appBaseDomain, isConfiguredBaseDomainHost, isTenantHost } from '../../lib/tenant.js';
import { AuthAccentLink, AuthHelp, AuthInput, AuthLead, AuthSecondaryAction, AuthTitle } from './auth-chrome.js';
import { describedBy, isEmailAddress } from './auth-fields.js';
import { AuthPasswordInput } from './auth-password-input.js';
import { useRedirectSignedInWithTenant } from './auth-redirect.js';
import { AuthShell } from './AuthShell.js';

const PASSWORD_HINT_ID = 'register-password-minimum';
const REGISTER_FIELDS = ['name', 'email', 'password', 'terms'] as const;
type RegisterField = (typeof REGISTER_FIELDS)[number];
type RegisterFieldError =
  | 'nameRequired'
  | 'emailRequired'
  | 'emailInvalid'
  | 'passwordRequired'
  | 'passwordTooShort'
  | 'termsRequired';
type RegisterFieldErrors = Record<RegisterField, RegisterFieldError | null>;
const fieldErrorMessage = (error: RegisterFieldError, t: Messages): string => {
  switch (error) {
    case 'nameRequired': return t.auth.nameRequired;
    case 'emailRequired': return t.auth.emailRequired;
    case 'emailInvalid': return t.auth.emailInvalid;
    case 'passwordRequired': return t.auth.passwordRequired;
    case 'passwordTooShort': return t.auth.passwordTooShort({ min: PASSWORD_MIN_LENGTH });
    case 'termsRequired': return t.consent.required;
  }
};
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
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const returnTo = returnToFromSearch(search);
  const landing = returnTo ?? '/';
  useRedirectSignedInWithTenant(landing);
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
  const [registeredOnTenantAs, setRegisteredOnTenantAs] = useState<string | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const resolveTenantOffer = !isConfiguredBaseDomainHost(hostname);
  const offer = useQuery({ ...actions.publicOffer, enabled: resolveTenantOffer });
  const onOtherTenantHost = isTenantHost(hostname);
  const legal = offer.data?.tenant.legal ?? null;
  const consentRequired = legal !== null && (legal.termsUrl !== null || legal.privacyUrl !== null);

  const signUp = useMutation({
    ...actions.signUp,
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries();
      if (onOtherTenantHost) {
        setRegisteredOnTenantAs(variables.email);
        return;
      }
      toast.info(t.auth.signUpConfirmationSent({ email: variables.email }));
      await navigate({ href: landing });
    },
  });

  const clearFieldError = (field: RegisterField) =>
    setFieldErrors((current) => (current[field] === null ? current : { ...current, [field]: null }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signUp.reset();
    const normalizedEmail = email.trim();
    const errors: RegisterFieldErrors = {
      name: name.trim() === '' ? 'nameRequired' : null,
      email: normalizedEmail === ''
        ? 'emailRequired'
        : isEmailAddress(normalizedEmail) ? null : 'emailInvalid',
      password: password === ''
        ? 'passwordRequired'
        : passwordMeetsMinimumLength(password) ? null : 'passwordTooShort',
      terms: consentRequired && !termsAccepted ? 'termsRequired' : null,
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

  if (registeredOnTenantAs !== null) {
    return (
      <AuthShell title={t.auth.registeredTitle} hostname={hostname}>
        <Box sx={{ mb: '1.5rem' }}>
          <AuthTitle variant="h1">{t.auth.registeredTitle}</AuthTitle>
          <AuthLead component="p">
            {t.auth.registeredOnTenantBody({ workspace: offer.data?.tenant.name ?? hostname })}
          </AuthLead>
          <AuthLead component="p" data-testid="register-confirmation-sent">
            {t.auth.signUpConfirmationSent({ email: registeredOnTenantAs })}
          </AuthLead>
        </Box>
        <Stack useFlexGap spacing="0.9rem">
          <AuthHelp component="p">{t.auth.registeredBoughtHint}</AuthHelp>
          <Button
            variant="contained"
            fullWidth
            component={Link}
            to={returnTo === null ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`}
            data-testid="register-use-sign-in-link"
          >
            {t.auth.registeredUseMagicLinkCta}
          </Button>
        </Stack>
        <AuthSecondaryAction component="p">
          <AuthAccentLink standalone href={baseDomainUrl()} data-testid="register-create-own-workspace">
            {t.auth.registeredCreateOwnCta}
          </AuthAccentLink>
        </AuthSecondaryAction>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t.auth.createAccount}
      hostname={hostname}
      footer={
        <AuthSecondaryAction component="p">
          {t.auth.alreadyHaveAccount}{' '}
          <AuthAccentLink standalone component={Link} to={returnTo === null ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`}>
            {t.auth.signInLink}
          </AuthAccentLink>
        </AuthSecondaryAction>
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
              <FormHelperText id={fieldErrorId('name')}>{fieldErrorMessage(fieldErrors.name, t)}</FormHelperText>
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
              <FormHelperText id={fieldErrorId('email')}>{fieldErrorMessage(fieldErrors.email, t)}</FormHelperText>
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
              <FormHelperText id={fieldErrorId('password')}>{fieldErrorMessage(fieldErrors.password, t)}</FormHelperText>
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
              error={fieldErrors.terms === null ? null : fieldErrorMessage(fieldErrors.terms, t)}
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
