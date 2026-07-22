import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  OutlinedInput,
  Switch,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { MarketingReadiness } from './MarketingReadiness.js';

const CredentialsForm = ({ configured }: { configured: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [region, setRegion] = useState('');
  const save = useMutation(actions.setTenantSecret);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const values = [
      { key: 'ses.accessKeyId' as const, value: accessKeyId },
      { key: 'ses.secretAccessKey' as const, value: secretAccessKey },
      { key: 'ses.region' as const, value: region },
    ].filter((entry) => entry.value.trim() !== '');
    for (const value of values) await save.mutateAsync(value);
    setAccessKeyId('');
    setSecretAccessKey('');
    setRegion('');
    await queryClient.invalidateQueries(actions.marketingInvalidates());
    await queryClient.invalidateQueries(actions.tenantSecretsInvalidates());
  };
  return (
    <SectionCard
      title={t.marketing.credentials}
      description={t.marketing.credentialsHint}
      onSubmit={(event) => void submit(event)}
      actions={<Button type="submit" variant="contained" disabled={save.isPending || [accessKeyId, secretAccessKey, region].every((value) => value.trim() === '')}>{save.isPending ? t.marketing.saving : t.marketing.save}</Button>}
    >
      <Chip size="small" variant="outlined" color={configured ? 'success' : 'warning'} label={configured ? t.marketing.ready : t.marketing.blocked} />
      <Typography variant="body2">{t.marketing.writeOnlyHint}</Typography>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-ses-access-key">{t.marketing.accessKeyLabel}</FormLabel>
        <OutlinedInput id="marketing-ses-access-key" type="password" autoComplete="off" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-ses-secret-key">{t.marketing.secretKeyLabel}</FormLabel>
        <OutlinedInput id="marketing-ses-secret-key" type="password" autoComplete="off" value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-ses-region">{t.marketing.regionLabel}</FormLabel>
        <OutlinedInput id="marketing-ses-region" value={region} onChange={(event) => setRegion(event.target.value)} />
      </FormControl>
      {save.isError ? <Alert>{localizeError(save.error, t)}</Alert> : null}
    </SectionCard>
  );
};

export const MarketingSettingsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const result = useQuery(actions.marketingSesSettings);
  const settings = result.data?.settings ?? null;
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  const [fromName, setFromName] = useState<string | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [identityVerified, setIdentityVerified] = useState<boolean | null>(null);
  const [configurationSet, setConfigurationSet] = useState<string | null>(null);
  const [snsTopicArn, setSnsTopicArn] = useState<string | null>(null);
  const [footerLegalName, setFooterLegalName] = useState<string | null>(null);
  const [footerAddress, setFooterAddress] = useState<string | null>(null);

  const values = {
    fromAddress: fromAddress ?? settings?.fromAddress ?? '',
    fromName: fromName ?? settings?.fromName ?? '',
    identity: identity ?? settings?.identity ?? '',
    identityVerified: identityVerified ?? (settings?.identityVerifiedAt !== null && settings?.identityVerifiedAt !== undefined),
    configurationSet: configurationSet ?? settings?.configurationSet ?? '',
    snsTopicArn: snsTopicArn ?? settings?.snsTopicArn ?? '',
    footerLegalName: footerLegalName ?? settings?.footerLegalName ?? '',
    footerAddress: footerAddress ?? settings?.footerAddress ?? '',
  };
  const update = useMutation({
    ...actions.updateMarketingSesSettings,
    onSuccess: async () => queryClient.invalidateQueries(actions.marketingInvalidates()),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      ...values,
      configurationSet: values.configurationSet.trim() === '' ? null : values.configurationSet,
      snsTopicArn: values.snsTopicArn.trim() === '' ? null : values.snsTopicArn,
    });
  };

  if (result.isPending) return <PanelPage title={t.marketing.settingsTitle} state={{ kind: 'loading', label: t.marketing.settingsLoading }} />;
  if (result.isError) return <PanelPage title={t.marketing.settingsTitle} state={{ kind: 'error', message: localizeError(result.error, t) }} />;

  const credentialsConfigured = result.data.credentialsConfigured;
  const footerConfigured = settings !== null
    && settings.footerLegalName.trim() !== ''
    && settings.footerAddress.trim() !== '';
  const verified = settings?.identityVerifiedAt !== null && settings?.identityVerifiedAt !== undefined;
  const webhookVerified = settings?.webhookVerifiedAt !== null && settings?.webhookVerifiedAt !== undefined;
  const enabled = settings?.broadcastsEnabled ?? false;

  return (
    <PanelPage title={t.marketing.settingsTitle} description={t.marketing.settingsDescription}>
      <MarketingReadiness
        title={t.marketing.onboarding}
        readyLabel={t.marketing.ready}
        blockedLabel={t.marketing.blocked}
        enabled={enabled}
        enabledMessage={t.marketing.broadcastsEnabled}
        disabledMessage={t.marketing.broadcastsDisabled}
        items={[
          { label: t.marketing.credentialsConfigured, ready: credentialsConfigured },
          { label: t.marketing.identityVerified, ready: verified },
          { label: t.marketing.webhookVerified, ready: webhookVerified },
          { label: t.marketing.footerConfigured, ready: footerConfigured },
        ]}
      />
      <CredentialsForm configured={credentialsConfigured} />
      <SectionCard title={t.marketing.sender} onSubmit={submit} actions={<Button type="submit" variant="contained" disabled={update.isPending}>{update.isPending ? t.marketing.saving : t.marketing.save}</Button>}>
        <Alert severity="info">{t.marketing.identityAuthenticationHint}</Alert>
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-from-address">{t.marketing.fromAddressLabel}</FormLabel>
          <OutlinedInput id="marketing-from-address" type="email" value={values.fromAddress} onChange={(event) => setFromAddress(event.target.value)} required />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-from-name">{t.marketing.fromNameLabel}</FormLabel>
          <OutlinedInput id="marketing-from-name" value={values.fromName} onChange={(event) => setFromName(event.target.value)} required />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-identity">{t.marketing.identityLabel}</FormLabel>
          <OutlinedInput id="marketing-identity" value={values.identity} onChange={(event) => setIdentity(event.target.value)} required />
        </FormControl>
        <FormControlLabel control={<Switch checked={values.identityVerified} onChange={(event) => setIdentityVerified(event.target.checked)} />} label={t.marketing.identityVerifiedLabel} />
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-configuration-set">{t.marketing.configurationSetLabel}</FormLabel>
          <OutlinedInput id="marketing-configuration-set" value={values.configurationSet} onChange={(event) => setConfigurationSet(event.target.value)} />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-sns-topic">{t.marketing.snsTopicLabel}</FormLabel>
          <OutlinedInput id="marketing-sns-topic" value={values.snsTopicArn} onChange={(event) => setSnsTopicArn(event.target.value)} />
        </FormControl>
        {update.isError ? <Alert>{localizeError(update.error, t)}</Alert> : null}
      </SectionCard>
      <SectionCard title={t.marketing.footer} description={t.marketing.footerRequiredHint} onSubmit={submit} actions={<Button type="submit" variant="contained" disabled={update.isPending}>{update.isPending ? t.marketing.saving : t.marketing.save}</Button>}>
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-footer-name">{t.marketing.footerLegalNameLabel}</FormLabel>
          <OutlinedInput id="marketing-footer-name" value={values.footerLegalName} onChange={(event) => setFooterLegalName(event.target.value)} />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-footer-address">{t.marketing.footerAddressLabel}</FormLabel>
          <OutlinedInput id="marketing-footer-address" value={values.footerAddress} onChange={(event) => setFooterAddress(event.target.value)} multiline minRows={2} />
        </FormControl>
      </SectionCard>
      <SectionCard title={t.marketing.webhookUrl} description={t.marketing.webhookHint}>
        <Typography variant="body2" data-testid="marketing-webhook-url">{result.data.webhookUrl ?? t.marketing.blocked}</Typography>
      </SectionCard>
      <SectionCard title={t.marketing.quota}>
        <Typography variant="body2">
          {settings === null || settings.quotaRefreshedAt === null
            ? t.marketing.quotaUnknown
            : t.marketing.rateQuota({ rate: settings.quotaRatePerSec, daily: settings.quotaDaily })}
        </Typography>
        {settings?.quotaRefreshedAt === null || settings?.quotaRefreshedAt === undefined ? null : <Typography variant="caption">{formatDateTime(settings.quotaRefreshedAt, language)}</Typography>}
        {settings?.inSandbox === true ? <Alert severity="warning">{t.marketing.sandboxWarning}</Alert> : null}
      </SectionCard>
    </PanelPage>
  );
};
