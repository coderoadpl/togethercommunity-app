import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { accentColorSchema } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { BrandSwatch, Eyebrow } from '../../../theme.js';
import { deriveBrandPalette } from '../../../theme-branding.js';
import { usePanelContext } from '../panel-context.js';

const BillingSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [url, setUrl] = useState<string | null>(null);

  const value = url ?? settings.data?.settings.billingPortalUrl ?? '';

  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateSettings.mutate({ billingPortalUrl: value.trim() === '' ? null : value.trim() });
  };

  return (
    <SectionCard title={t.billing.heading} description={t.billing.intro} onSubmit={submit}>
        <FormControl fullWidth>
          <FormLabel htmlFor="billing-portal-url">{t.billing.urlLabel}</FormLabel>
          {settings.isPending ? (
            <StatusView
              state={{ kind: 'loading', label: t.common.loading }}
              data-testid="billing-portal-url-loading"
            />
          ) : (
            <OutlinedInput
              id="billing-portal-url"
              type="url"
              value={value}
              disabled={!canEdit || !settings.isSuccess}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t.billing.placeholder}
              inputProps={{ 'data-testid': 'billing-portal-url' }}
            />
          )}
        </FormControl>
        {settings.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(settings.error, t) }} />
        ) : null}
        {canEdit ? (
          <Box>
            <Button
              type="submit"
              variant="outlined"
              data-testid="billing-portal-save"
              disabled={updateSettings.isPending || !settings.isSuccess}
            >
              {updateSettings.isPending ? t.billing.saving : t.billing.save}
            </Button>
          </Box>
        ) : null}
        {updateSettings.isSuccess ? (
          <Typography variant="caption" component="p" data-testid="billing-portal-saved">
            {t.billing.saved}
          </Typography>
        ) : null}
        {updateSettings.isError ? <Alert>{localizeError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const BrandingSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [accentError, setAccentError] = useState(false);

  const logoValue = logoUrl ?? settings.data?.settings.logoUrl ?? '';
  const accentValue = accentColor ?? settings.data?.settings.accentColor ?? '';
  const faviconValue = faviconUrl ?? settings.data?.settings.faviconUrl ?? '';
  const accentValid = accentColorSchema.safeParse(accentValue.trim()).success;
  const swatch = accentValid ? deriveBrandPalette(accentValue.trim()) : null;

  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const accent = accentValue.trim();
    if (accent !== '' && !accentValid) {
      setAccentError(true);
      return;
    }
    setAccentError(false);
    updateSettings.mutate({
      logoUrl: logoValue.trim() === '' ? null : logoValue.trim(),
      accentColor: accent === '' ? null : accent,
      faviconUrl: faviconValue.trim() === '' ? null : faviconValue.trim(),
    });
  };

  const disabled = !canEdit || !settings.isSuccess;

  return (
    <SectionCard title={t.branding.heading} description={t.branding.intro} onSubmit={submit}>
      {settings.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.common.loading }} data-testid="branding-loading" />
      ) : (
        <>
          <FormControl fullWidth>
            <FormLabel htmlFor="branding-logo-url">{t.branding.logoLabel}</FormLabel>
            <OutlinedInput
              id="branding-logo-url"
              value={logoValue}
              disabled={disabled}
              onChange={(event) => setLogoUrl(event.target.value)}
              placeholder={t.branding.logoPlaceholder}
              inputProps={{ 'data-testid': 'branding-logo-url' }}
            />
          </FormControl>
          <FormControl fullWidth error={accentError}>
            <FormLabel htmlFor="branding-accent-color">{t.branding.accentLabel}</FormLabel>
            <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.75rem' }}>
              <OutlinedInput
                id="branding-accent-color"
                value={accentValue}
                disabled={disabled}
                onChange={(event) => {
                  setAccentColor(event.target.value);
                  setAccentError(false);
                }}
                placeholder={t.branding.accentPlaceholder}
                inputProps={{ 'data-testid': 'branding-accent-color' }}
                sx={{ maxWidth: '11rem' }}
              />
              <BrandSwatch
                aria-hidden
                data-testid="branding-accent-swatch"
                swatchColor={swatch === null ? null : swatch.main}
              />
            </Stack>
            <Typography variant="caption" component="p" sx={{ mt: '0.35rem' }}>
              {accentError ? t.branding.accentInvalid : t.branding.previewHint}
            </Typography>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="branding-favicon-url">{t.branding.faviconLabel}</FormLabel>
            <OutlinedInput
              id="branding-favicon-url"
              value={faviconValue}
              disabled={disabled}
              onChange={(event) => setFaviconUrl(event.target.value)}
              placeholder={t.branding.faviconPlaceholder}
              inputProps={{ 'data-testid': 'branding-favicon-url' }}
            />
          </FormControl>
        </>
      )}
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizeError(settings.error, t) }} />
      ) : null}
      {canEdit ? (
        <Box>
          <Button
            type="submit"
            variant="outlined"
            data-testid="branding-save"
            disabled={updateSettings.isPending || !settings.isSuccess}
          >
            {updateSettings.isPending ? t.branding.saving : t.branding.save}
          </Button>
        </Box>
      ) : null}
      {updateSettings.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="branding-saved">
          {t.branding.saved}
        </Typography>
      ) : null}
      {updateSettings.isError ? <Alert>{localizeError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const SecurityPanel = () => {
  const t = useTranslations();
  const [passkeyName, setPasskeyName] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const registerPasskey = useMutation(actions.registerPasskey);
  const enableTwoFactor = useMutation(actions.enableTwoFactor);
  const verifyTotp = useMutation(actions.verifyTotp);

  const addPasskey = (event: FormEvent) => {
    event.preventDefault();
    registerPasskey.mutate({ name: passkeyName.trim() || t.security.defaultPasskeyName });
  };

  const enrollTwoFactor = (event: FormEvent) => {
    event.preventDefault();
    enableTwoFactor.mutate({ password });
  };

  const submitTotp = (event: FormEvent) => {
    event.preventDefault();
    verifyTotp.mutate({ code: totpCode.trim() });
  };

  return (
    <SectionCard title={t.security.heading}>
      <Stack useFlexGap spacing="1.75rem">
        <Box component="form" onSubmit={addPasskey} sx={{ display: 'grid', gap: '0.8rem' }}>
          <Eyebrow variant="overline" component="h3">
            {t.security.passkeys}
          </Eyebrow>
          <FormControl fullWidth>
            <FormLabel htmlFor="passkey-name">{t.security.passkeyNameLabel}</FormLabel>
            <OutlinedInput
              id="passkey-name"
              value={passkeyName}
              onChange={(event) => setPasskeyName(event.target.value)}
              inputProps={{ 'data-testid': 'passkey-name' }}
              placeholder={t.security.defaultPasskeyName}
            />
          </FormControl>
          <Button type="submit" variant="outlined" data-testid="add-passkey" disabled={registerPasskey.isPending}>
            {registerPasskey.isPending ? t.security.addingPasskey : t.security.addPasskey}
          </Button>
          {registerPasskey.isSuccess ? (
            <Typography variant="caption" component="p" data-testid="passkey-added">
              {t.security.passkeyAdded}
            </Typography>
          ) : null}
          {registerPasskey.isError ? <Alert>{localizeError(registerPasskey.error, t)}</Alert> : null}
        </Box>

        <Box component="form" onSubmit={enrollTwoFactor} sx={{ display: 'grid', gap: '0.8rem' }}>
          <Eyebrow variant="overline" component="h3">
            {t.security.twoFactor}
          </Eyebrow>
          <FormControl fullWidth>
            <FormLabel htmlFor="enable-2fa-password">{t.security.accountPasswordLabel}</FormLabel>
            <OutlinedInput
              id="enable-2fa-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              inputProps={{ 'data-testid': 'enable-2fa-password' }}
              autoComplete="current-password"
            />
          </FormControl>
          <Button type="submit" variant="outlined" data-testid="enable-2fa" disabled={enableTwoFactor.isPending}>
            {enableTwoFactor.isPending ? t.security.enabling : t.security.enableTwoFactor}
          </Button>
          {enableTwoFactor.isError ? <Alert>{localizeError(enableTwoFactor.error, t)}</Alert> : null}
        </Box>

        {enableTwoFactor.data ? (
          <Box sx={{ display: 'grid', gap: '0.8rem' }}>
            <Eyebrow variant="overline" component="h3">
              {t.security.scanOrCopyKey}
            </Eyebrow>
            <FormControl fullWidth>
              <FormLabel htmlFor="totp-uri">{t.security.otpauthUriLabel}</FormLabel>
              <OutlinedInput
                id="totp-uri"
                readOnly
                value={enableTwoFactor.data.totpURI}
                inputProps={{ 'data-testid': 'totp-uri' }}
              />
            </FormControl>
            <Box component="ul" sx={{ display: 'grid', gap: '0.2rem', pl: '1.2rem', m: 0 }}>
              {enableTwoFactor.data.backupCodes.map((code) => (
                <Typography key={code} component="li" variant="caption">
                  {code}
                </Typography>
              ))}
            </Box>
            <Box component="form" onSubmit={submitTotp} sx={{ display: 'grid', gap: '0.8rem' }}>
              <FormControl fullWidth>
                <FormLabel htmlFor="verify-totp-code">{t.security.authenticatorCodeLabel}</FormLabel>
                <OutlinedInput
                  id="verify-totp-code"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  inputProps={{ 'data-testid': 'verify-totp-code' }}
                  autoComplete="one-time-code"
                />
              </FormControl>
              <Button type="submit" variant="contained" data-testid="verify-totp" disabled={verifyTotp.isPending}>
                {verifyTotp.isPending ? t.security.verifying : t.security.verifyCode}
              </Button>
              {verifyTotp.isSuccess ? (
                <Typography variant="caption" component="p" data-testid="totp-verified">
                  {t.security.twoFactorOn}
                </Typography>
              ) : null}
              {verifyTotp.isError ? <Alert>{localizeError(verifyTotp.error, t)}</Alert> : null}
            </Box>
          </Box>
        ) : null}
      </Stack>
    </SectionCard>
  );
};

export const SettingsPanel = () => {
  const { tenant } = usePanelContext();
  const t = useTranslations();
  return (
    <PanelPage title={t.sections.settings}>
      <BillingSettingsPanel canEdit={tenant.staffRole === 'owner'} />
      <BrandingSettingsPanel canEdit={tenant.staffRole === 'owner'} />
      <SecurityPanel />
    </PanelPage>
  );
};
