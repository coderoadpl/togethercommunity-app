import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  Link,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { TermsConsentField } from '../../components/ui/TermsConsentField.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { appBaseDomain, hostHasTenantSubdomain } from '../../lib/tenant.js';
import { FinePrint } from '../../theme.js';

const baseDomainUrl = (): string => {
  const { protocol, port } = window.location;
  return `${protocol}//${appBaseDomain()}${port ? `:${port}` : ''}`;
};

export const RegisterPage = ({ hostname }: { hostname?: string } = {}) => {
  const t = useTranslations();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [registeredOnTenant, setRegisteredOnTenant] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const onTenantHost = hostHasTenantSubdomain(hostname ?? window.location.hostname);
  const offer = useQuery({ ...actions.publicOffer, enabled: onTenantHost });
  const legal = onTenantHost ? offer.data?.tenant.legal ?? null : null;
  const consentRequired = legal !== null && (legal.termsUrl !== null || legal.privacyUrl !== null);
  const recordConsent = useMutation(actions.recordTermsConsent);

  const signUp = useMutation({
    ...actions.signUp,
    onSuccess: async () => {
      if (consentRequired) {
        await recordConsent.mutateAsync().catch(() => undefined);
      }
      await queryClient.invalidateQueries();
      if (onTenantHost) {
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
      <FocusCard eyebrow={t.auth.registeredTitle}>
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
      </FocusCard>
    );
  }

  return (
    <FocusCard
      eyebrow={t.auth.createAccountEyebrow({ host: window.location.hostname })}
      onSubmit={submit}
      footer={
        <FinePrint variant="caption" component="p">
          {t.auth.alreadyHaveAccount} <Link href="/login">{t.auth.signInLink}</Link>
        </FinePrint>
      }
    >
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
          {consentRequired ? (
            <TermsConsentField legal={legal} checked={termsAccepted} onChange={setTermsAccepted} />
          ) : null}
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
    </FocusCard>
  );
};
