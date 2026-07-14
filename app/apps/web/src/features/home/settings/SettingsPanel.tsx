import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { Eyebrow } from '../../../theme.js';
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
    <Paper elevation={1} sx={{ p: '1.5rem' }}>
      <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.8rem' }}>
        <Typography variant="h2" component="h2">
          {t.billing.heading}
        </Typography>
        <Typography variant="body2">{t.billing.intro}</Typography>
        <FormControl fullWidth>
          <FormLabel htmlFor="billing-portal-url">{t.billing.urlLabel}</FormLabel>
          <OutlinedInput
            id="billing-portal-url"
            type="url"
            value={value}
            disabled={!canEdit || settings.isPending}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t.billing.placeholder}
            inputProps={{ 'data-testid': 'billing-portal-url' }}
          />
        </FormControl>
        {canEdit ? (
          <Box>
            <Button
              type="submit"
              variant="outlined"
              data-testid="billing-portal-save"
              disabled={updateSettings.isPending}
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
      </Box>
    </Paper>
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
    <Paper elevation={1} sx={{ p: '1.5rem' }}>
      <Stack useFlexGap spacing="1.75rem">
        <Typography variant="h2" component="h2">
          {t.security.heading}
        </Typography>

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
    </Paper>
  );
};

export const SettingsPanel = () => {
  const { tenant } = usePanelContext();
  return (
    <Stack useFlexGap spacing="1.5rem">
      <BillingSettingsPanel canEdit={tenant.staffRole === 'owner'} />
      <SecurityPanel />
    </Stack>
  );
};
