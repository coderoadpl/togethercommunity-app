import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  Link as MuiLink,
  Stack,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { PASSWORD_MIN_LENGTH, passwordMeetsMinimumLength } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { TermsConsentField } from '../../components/ui/TermsConsentField.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { appBaseDomain, isConfiguredBaseDomainHost, isTenantHost } from '../../lib/tenant.js';
import { FinePrint } from '../../theme.js';
import { AuthInput, AuthLead, AuthTitle } from './auth-chrome.js';
import { AuthShell } from './AuthShell.js';

const baseDomainUrl = (): string => {
  const { protocol, port } = window.location;
  return `${protocol}//${appBaseDomain()}${port ? `:${port}` : ''}`;
};

export const RegisterPage = ({ hostname = window.location.hostname }: { hostname?: string } = {}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!passwordMeetsMinimumLength(password)) {
      setLocalError(t.auth.passwordTooShort({ min: PASSWORD_MIN_LENGTH }));
      return;
    }
    signUp.mutate({
      name,
      email,
      password,
      callbackURL: new URL('/login?verification=verified', window.location.origin).toString(),
      language,
      ...(consentRequired ? { termsAccepted } : {}),
    });
  };

  if (registeredOnTenant) {
    return (
      <AuthShell hostname={hostname}>
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
            <MuiLink component={Link} to="/login">{t.auth.registeredUseMagicLinkCta}</MuiLink>
          </Box>
        </Stack>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      hostname={hostname}
      footer={
        <FinePrint variant="caption" component="p" sx={{ mt: '1.75rem' }}>
          {t.auth.alreadyHaveAccount} <MuiLink component={Link} to="/login">{t.auth.signInLink}</MuiLink>
        </FinePrint>
      }
    >
      {offer.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(offer.error, t), retry: { label: t.common.retry, onRetry: () => void offer.refetch() } }} /> : null}
        <Box sx={{ mb: '1.5rem' }}>
          <AuthTitle variant="h1">{t.auth.createAccount}</AuthTitle>
          <AuthLead component="p">{t.auth.createAccountLead}</AuthLead>
        </Box>
        <Stack component="form" onSubmit={submit} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="register-name">{t.auth.nameLabel}</FormLabel>
            <AuthInput
              id="register-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="register-email">{t.auth.emailLabel}</FormLabel>
            <AuthInput
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
            <AuthInput
              id="register-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </FormControl>
          {consentRequired ? (
            <TermsConsentField legal={legal} checked={termsAccepted} onChange={setTermsAccepted} />
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
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
            {localizeError(signUp.error, t)}
          </Alert>
        ) : null}
        {localError ? <Alert severity="error" sx={{ mt: '0.6rem' }}>{localError}</Alert> : null}
    </AuthShell>
  );
};
