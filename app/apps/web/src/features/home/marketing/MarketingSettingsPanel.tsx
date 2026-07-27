import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link,
  List,
  ListItem,
  ListItemText,
  OutlinedInput,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { MarketingReadiness } from './MarketingReadiness.js';
import { ReputationSummary } from './ReputationSummary.js';

interface LiveSesChecklist {
  credentials: boolean;
  identity: boolean;
  configurationSet: boolean;
  snsSubscription: boolean;
  webhook: boolean;
  footer: boolean;
  productionAccess: boolean;
}

const SesOnboardingWizard = ({
  enabled,
  onChecklist,
}: {
  enabled: boolean;
  onChecklist(checklist: LiveSesChecklist): void;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const identity = useMutation(actions.startMarketingSesIdentity);
  const provision = useMutation(actions.provisionMarketingSes);
  const poll = useMutation(actions.pollMarketingSesOnboarding);
  const simulator = useMutation(actions.testMarketingSesSimulator);
  const refresh = async () => {
    await queryClient.invalidateQueries(actions.marketingInvalidates());
  };
  const records = identity.data?.records ?? poll.data?.records ?? [];
  const pending = identity.isPending || provision.isPending || poll.isPending || simulator.isPending;
  const error = identity.error ?? provision.error ?? poll.error ?? simulator.error;

  return (
    <SectionCard title={t.marketing.wizardTitle} description={t.marketing.wizardDescription}>
      <Typography variant="body2">{t.marketing.wizardIdentityHint}</Typography>
      <Stack direction="row" useFlexGap sx={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <Button
          type="button"
          variant="contained"
          disabled={!enabled || pending}
          onClick={() => identity.mutate({ kind: 'domain' })}
        >
          {t.marketing.wizardDomainIdentity}
        </Button>
        <Button
          type="button"
          variant="outlined"
          disabled={!enabled || pending}
          onClick={() => identity.mutate({ kind: 'email' })}
        >
          {t.marketing.wizardEmailIdentity}
        </Button>
      </Stack>
      {records.length === 0 ? null : (
        <>
          <Typography variant="h3">{t.marketing.wizardDkimRecords}</Typography>
          <List disablePadding>
            {records.map((record) => (
              <ListItem
                key={record.name}
                disableGutters
                secondaryAction={(
                  <Button
                    type="button"
                    size="small"
                    onClick={() => void navigator.clipboard.writeText(`${record.name}\t${record.value}`)}
                  >
                    {t.marketing.wizardCopy}
                  </Button>
                )}
              >
                <ListItemText
                  primary={`${t.marketing.wizardDkimName}: ${record.name}`}
                  secondary={`${t.marketing.wizardDkimValue}: ${record.value}`}
                  slotProps={{
                    primary: { sx: { overflowWrap: 'anywhere' } },
                    secondary: { sx: { overflowWrap: 'anywhere' } },
                  }}
                />
              </ListItem>
            ))}
          </List>
        </>
      )}
      <Typography variant="body2">{t.marketing.wizardProvisionHint}</Typography>
      <Stack direction="row" useFlexGap sx={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <Button
          type="button"
          variant="contained"
          disabled={!enabled || pending}
          onClick={() => provision.mutate(undefined, { onSuccess: () => void refresh() })}
        >
          {t.marketing.wizardProvision}
        </Button>
        <Button
          type="button"
          variant="outlined"
          disabled={!enabled || pending}
          onClick={() => poll.mutate(undefined, {
            onSuccess: (status) => {
              onChecklist(status.checklist);
              void refresh();
            },
          })}
        >
          {t.marketing.wizardPoll}
        </Button>
      </Stack>
      {poll.data?.identityRegressed === true ? <Alert severity="error">{t.marketing.wizardRegression}</Alert> : null}
      {poll.data?.feedbackForwardingDisabled === true ? <Alert severity="success">{t.marketing.wizardFeedbackDisabled}</Alert> : null}
      <Typography variant="body2">{t.marketing.wizardSimulatorHint}</Typography>
      <Button
        type="button"
        variant="outlined"
        disabled={!enabled || pending}
        onClick={() => simulator.mutate(undefined, { onSuccess: () => void refresh() })}
      >
        {t.marketing.wizardSimulator}
      </Button>
      {simulator.data?.waitingForWebhook === true ? <Alert severity="info">{t.marketing.wizardWaitingWebhook}</Alert> : null}
      {error === null || error === undefined ? null : <Alert severity="error">{localizeError(error, t)}</Alert>}
      <Link
        href="https://github.com/coderoadpl/together/blob/main/docs/ses-onboarding.md"
        target="_blank"
        rel="noreferrer"
      >
        {t.marketing.wizardDocs}
      </Link>
    </SectionCard>
  );
};

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

const SmtpForm = ({ configured }: { configured: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);
  const save = useMutation(actions.setTenantSecret);
  const test = useMutation(actions.testMarketingSmtp);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const values = [
      { key: 'smtp.host' as const, value: host },
      { key: 'smtp.port' as const, value: port },
      { key: 'smtp.user' as const, value: user },
      { key: 'smtp.password' as const, value: password },
      { key: 'smtp.secure' as const, value: String(secure) },
    ].filter((entry) => entry.value.trim() !== '');
    for (const value of values) await save.mutateAsync(value);
    setHost('');
    setPort('');
    setUser('');
    setPassword('');
    await queryClient.invalidateQueries(actions.marketingInvalidates());
    await queryClient.invalidateQueries(actions.tenantSecretsInvalidates());
  };
  return (
    <SectionCard
      title={t.marketing.smtpTitle}
      description={t.marketing.smtpHint}
      onSubmit={(event) => void submit(event)}
      actions={(
        <>
          <Button type="submit" variant="contained" disabled={save.isPending}>{save.isPending ? t.marketing.saving : t.marketing.save}</Button>
          <Button type="button" variant="outlined" disabled={!configured || test.isPending} onClick={() => test.mutate(undefined)}>
            {test.isPending ? t.marketing.testing : t.marketing.testSend}
          </Button>
        </>
      )}
    >
      <Chip size="small" variant="outlined" color={configured ? 'success' : 'warning'} label={configured ? t.marketing.ready : t.marketing.blocked} />
      <Alert severity="info">{t.marketing.smtpTrackingNote}</Alert>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-smtp-host">{t.marketing.smtpHostLabel}</FormLabel>
        <OutlinedInput id="marketing-smtp-host" value={host} onChange={(event) => setHost(event.target.value)} />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-smtp-port">{t.marketing.smtpPortLabel}</FormLabel>
        <OutlinedInput id="marketing-smtp-port" inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-smtp-user">{t.marketing.smtpUserLabel}</FormLabel>
        <OutlinedInput id="marketing-smtp-user" value={user} onChange={(event) => setUser(event.target.value)} />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-smtp-password">{t.marketing.smtpPasswordLabel}</FormLabel>
        <OutlinedInput id="marketing-smtp-password" type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} />
      </FormControl>
      <FormControlLabel control={<Switch checked={secure} onChange={(event) => setSecure(event.target.checked)} />} label={t.marketing.smtpSecureLabel} />
      {save.isError ? <Alert severity="error">{localizeError(save.error, t)}</Alert> : null}
      {test.isError ? <Alert severity="error">{localizeError(test.error, t)}</Alert> : null}
      {test.isSuccess ? <Alert severity="success">{t.marketing.ready}</Alert> : null}
    </SectionCard>
  );
};

export const MarketingSettingsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const result = useQuery(actions.marketingSesSettings);
  const reputation = useQuery(actions.marketingReputation);
  const settings = result.data?.settings ?? null;
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  const [fromName, setFromName] = useState<string | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState<boolean | null>(null);
  const [autoPauseOnCritical, setAutoPauseOnCritical] = useState<boolean | null>(null);
  const [footerLegalName, setFooterLegalName] = useState<string | null>(null);
  const [footerAddress, setFooterAddress] = useState<string | null>(null);
  const [liveChecklist, setLiveChecklist] = useState<LiveSesChecklist | null>(null);

  const values = {
    fromAddress: fromAddress ?? settings?.fromAddress ?? '',
    fromName: fromName ?? settings?.fromName ?? '',
    identity: identity ?? settings?.identity ?? '',
    identityVerified: settings?.identityVerifiedAt !== null && settings?.identityVerifiedAt !== undefined,
    configurationSet: settings?.configurationSet ?? '',
    snsTopicArn: settings?.snsTopicArn ?? '',
    trackingEnabled: trackingEnabled ?? settings?.trackingEnabled ?? false,
    autoPauseOnCritical: autoPauseOnCritical ?? settings?.autoPauseOnCritical ?? false,
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
  const pool = result.data.platformPool;

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
          { label: t.marketing.identityVerified, ready: liveChecklist?.identity ?? verified },
          { label: t.marketing.configurationSetConfigured, ready: liveChecklist?.configurationSet ?? false },
          { label: t.marketing.wizardSubscription, ready: liveChecklist?.snsSubscription ?? false },
          { label: t.marketing.webhookVerified, ready: liveChecklist?.webhook ?? webhookVerified },
          { label: t.marketing.footerConfigured, ready: liveChecklist?.footer ?? footerConfigured },
          { label: t.marketing.wizardProductionAccess, ready: liveChecklist?.productionAccess ?? (settings?.quotaRefreshedAt !== null && settings?.quotaRefreshedAt !== undefined && settings?.inSandbox === false) },
          {
            label: `${t.marketing.platformPoolChecklist}: ${pool.used}/${pool.limit}`,
            ready: pool.used < pool.limit || credentialsConfigured || result.data.smtpConfigured,
          },
        ]}
      />
      <SectionCard title={t.marketing.platformPool({ used: pool.used, limit: pool.limit })}>
        {pool.used >= 800 ? <Alert severity="warning">{t.marketing.platformPoolNudge}</Alert> : null}
      </SectionCard>
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
        <FormControlLabel
          control={<Switch checked={values.trackingEnabled} onChange={(event) => setTrackingEnabled(event.target.checked)} />}
          label={t.marketing.trackingEnabledLabel}
        />
        <Alert severity="info">
          {t.marketing.trackingPrivacyNote}{' '}
          <Link
            href="https://github.com/coderoadpl/together/blob/main/docs/marketing-automation-api.md#open-and-click-events"
            target="_blank"
            rel="noreferrer"
          >
            {t.marketing.trackingDocsLink}
          </Link>
        </Alert>
        {update.isError ? <Alert>{localizeError(update.error, t)}</Alert> : null}
      </SectionCard>
      <SesOnboardingWizard enabled={credentialsConfigured && settings !== null} onChecklist={setLiveChecklist} />
      <SmtpForm configured={result.data.smtpConfigured} />
      <SectionCard
        title={t.marketing.reputationTitle}
        description={t.marketing.reputationDescription}
        onSubmit={submit}
        actions={<Button type="submit" variant="contained" disabled={settings === null || update.isPending}>{update.isPending ? t.marketing.saving : t.marketing.save}</Button>}
      >
        {reputation.isPending ? <Typography variant="body2">{t.marketing.reputationLoading}</Typography> : null}
        {reputation.isError ? <Alert>{localizeError(reputation.error, t)}</Alert> : null}
        {reputation.isSuccess ? <ReputationSummary reputation={reputation.data} /> : null}
        <FormControlLabel
          control={<Switch checked={values.autoPauseOnCritical} disabled={settings === null} onChange={(event) => setAutoPauseOnCritical(event.target.checked)} />}
          label={t.marketing.autoPauseOnCriticalLabel}
        />
        <Typography variant="body2">{t.marketing.autoPauseOnCriticalHint}</Typography>
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
