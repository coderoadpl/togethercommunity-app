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
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  STORAGE_PROBE_ERROR_CODES,
  type StorageConfiguration,
  type StorageProbeErrorCode,
  type StorageProviderKind,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { localizeError, providerCodeOf, useTranslations, type Messages } from '../../../i18n/index.js';

type WizardStep = 'provider' | 'connection' | 'probe';

const PROVIDERS: StorageProviderKind[] = [
  'aws_s3',
  'cloudflare_r2',
  'backblaze_b2',
  'minio',
];

const HELP_URLS: Record<StorageProviderKind, string> = {
  aws_s3: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
  cloudflare_r2: 'https://developers.cloudflare.com/r2/get-started/s3/',
  backblaze_b2: 'https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys',
  minio: 'https://min.io/docs/minio/linux/administration/identity-access-management.html',
};

const providerLabel = (provider: StorageProviderKind, t: Messages): string => {
  if (provider === 'aws_s3') return t.integrations.storageProviderAws;
  if (provider === 'cloudflare_r2') return t.integrations.storageProviderR2;
  if (provider === 'backblaze_b2') return t.integrations.storageProviderB2;
  return t.integrations.storageProviderMinio;
};

const providerInstructions = (provider: StorageProviderKind, t: Messages): string => {
  if (provider === 'aws_s3') return t.integrations.storageInstructionAws;
  if (provider === 'cloudflare_r2') return t.integrations.storageInstructionR2;
  if (provider === 'backblaze_b2') return t.integrations.storageInstructionB2;
  return t.integrations.storageInstructionMinio;
};

const defaultsFor = (provider: StorageProviderKind) => {
  if (provider === 'aws_s3') return { endpoint: 'https://s3.eu-central-1.amazonaws.com', region: 'eu-central-1' };
  if (provider === 'cloudflare_r2') return { endpoint: '', region: 'auto' };
  if (provider === 'backblaze_b2') return { endpoint: '', region: '' };
  return { endpoint: 'http://localhost:9000', region: 'us-east-1' };
};

const isProbeErrorCode = (value: string): value is StorageProbeErrorCode =>
  STORAGE_PROBE_ERROR_CODES.some((candidate) => candidate === value);

const localizedProbeError = (error: unknown, t: Messages): string => {
  const messages: Record<StorageProbeErrorCode, string> = {
    'storage.wrong_region': t.integrations.storageProbeWrongRegion,
    'storage.credentials': t.integrations.storageProbeCredentials,
    'storage.bucket': t.integrations.storageProbeBucket,
    'storage.cors': t.integrations.storageProbeCors,
    'storage.unavailable': t.integrations.storageProbeUnavailable,
  };
  const code = providerCodeOf(error);
  return code !== null && isProbeErrorCode(code) ? messages[code] : localizeError(error, t);
};

export const StorageWizard = ({ configured }: { configured: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>('provider');
  const [provider, setProvider] = useState<StorageProviderKind | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');

  const probe = useMutation(actions.probeStorage);
  const configure = useMutation({
    ...actions.configureStorage,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSecretsInvalidates());
    },
  });

  const configuration = (): StorageConfiguration | null =>
    provider === null
      ? null
      : { provider, endpoint, region, bucket, accessKeyId, secretAccessKey };

  const chooseProvider = (selected: StorageProviderKind) => {
    const defaults = defaultsFor(selected);
    setProvider(selected);
    setEndpoint(defaults.endpoint);
    setRegion(defaults.region);
    setBucket('');
    setAccessKeyId('');
    setSecretAccessKey('');
    probe.reset();
  };

  const updateField = (update: (value: string) => void, value: string) => {
    update(value);
    if (!probe.isIdle) probe.reset();
    if (!configure.isIdle) configure.reset();
  };

  const showConnection = () => {
    if (provider !== null) setStep('connection');
  };

  const showProbe = (event: FormEvent) => {
    event.preventDefault();
    if (configuration() !== null) setStep('probe');
  };

  const runProbe = () => {
    const input = configuration();
    if (input !== null) probe.mutate(input);
  };

  const save = () => {
    const input = configuration();
    if (input !== null && probe.isSuccess) configure.mutate(input);
  };

  const activeStep = step === 'provider' ? 0 : step === 'connection' ? 1 : 2;

  return (
    <Stack useFlexGap spacing="1.25rem" data-testid="storage-wizard">
      {configured ? <Alert severity="info">{t.integrations.storageConfigured}</Alert> : null}
      <Stepper activeStep={activeStep} alternativeLabel>
        <Step><StepLabel>{t.integrations.storageProviderStep}</StepLabel></Step>
        <Step><StepLabel>{t.integrations.storageConnectionStep}</StepLabel></Step>
        <Step><StepLabel>{t.integrations.storageProbeStep}</StepLabel></Step>
      </Stepper>

      {step === 'provider' ? (
        <Stack useFlexGap spacing="1rem" data-testid="storage-provider-step">
          <Typography variant="subtitle2">{t.integrations.storageProviderLabel}</Typography>
          <Box sx={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            {PROVIDERS.map((candidate) => (
              <Button
                key={candidate}
                type="button"
                variant={provider === candidate ? 'contained' : 'outlined'}
                data-testid={`storage-provider-${candidate}`}
                onClick={() => chooseProvider(candidate)}
              >
                {providerLabel(candidate, t)}
              </Button>
            ))}
          </Box>
          <Button
            type="button"
            variant="contained"
            disabled={provider === null}
            onClick={showConnection}
            data-testid="storage-provider-continue"
            sx={{ alignSelf: 'start' }}
          >
            {t.integrations.storageContinue}
          </Button>
        </Stack>
      ) : null}

      {step === 'connection' && provider !== null ? (
        <Box component="form" onSubmit={showProbe} data-testid="storage-connection-step">
          <Stack useFlexGap spacing="1rem">
            <Alert severity="info">
              <Typography variant="subtitle2" component="p">{t.integrations.storageInstructionsHeading}</Typography>
              <Typography variant="body2" component="p" sx={{ my: '0.35rem' }}>
                {providerInstructions(provider, t)}
              </Typography>
              <Link href={HELP_URLS[provider]} target="_blank" rel="noreferrer">
                {t.integrations.storageInstructionLink}
              </Link>
            </Alert>
            <FormControl fullWidth required>
              <FormLabel htmlFor="storage-endpoint">{t.integrations.storageEndpointLabel}</FormLabel>
              <OutlinedInput
                id="storage-endpoint"
                value={endpoint}
                onChange={(event) => updateField(setEndpoint, event.target.value)}
                inputProps={{ 'data-testid': 'storage-endpoint' }}
              />
            </FormControl>
            <FormControl fullWidth required>
              <FormLabel htmlFor="storage-region">{t.integrations.storageRegionLabel}</FormLabel>
              <OutlinedInput
                id="storage-region"
                value={region}
                onChange={(event) => updateField(setRegion, event.target.value)}
                inputProps={{ 'data-testid': 'storage-region' }}
              />
            </FormControl>
            <FormControl fullWidth required>
              <FormLabel htmlFor="storage-bucket">{t.integrations.storageBucketLabel}</FormLabel>
              <OutlinedInput
                id="storage-bucket"
                value={bucket}
                onChange={(event) => updateField(setBucket, event.target.value)}
                inputProps={{ 'data-testid': 'storage-bucket' }}
              />
            </FormControl>
            <FormControl fullWidth required>
              <FormLabel htmlFor="storage-access-key">{t.integrations.s3AccessKeyIdLabel}</FormLabel>
              <OutlinedInput
                id="storage-access-key"
                value={accessKeyId}
                onChange={(event) => updateField(setAccessKeyId, event.target.value)}
                inputProps={{ 'data-testid': 'storage-access-key' }}
              />
            </FormControl>
            <FormControl fullWidth required>
              <FormLabel htmlFor="storage-secret-key">{t.integrations.s3SecretAccessKeyLabel}</FormLabel>
              <OutlinedInput
                id="storage-secret-key"
                type="password"
                value={secretAccessKey}
                onChange={(event) => updateField(setSecretAccessKey, event.target.value)}
                inputProps={{ 'data-testid': 'storage-secret-key' }}
              />
            </FormControl>
            <Stack direction="row" useFlexGap spacing="0.75rem">
              <Button type="button" variant="outlined" onClick={() => setStep('provider')}>
                {t.integrations.storageBack}
              </Button>
              <Button type="submit" variant="contained" data-testid="storage-connection-continue">
                {t.integrations.storageContinue}
              </Button>
            </Stack>
          </Stack>
        </Box>
      ) : null}

      {step === 'probe' ? (
        <Stack useFlexGap spacing="1rem" data-testid="storage-probe-step">
          <Typography variant="body2">{t.integrations.storageProbeDescription}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem">
            <Button type="button" variant="outlined" onClick={() => setStep('connection')}>
              {t.integrations.storageBack}
            </Button>
            <Button
              type="button"
              variant="contained"
              onClick={runProbe}
              disabled={probe.isPending || configure.isPending}
              data-testid="storage-probe"
            >
              {probe.isPending ? t.integrations.testing : t.integrations.storageProbeStart}
            </Button>
          </Stack>
          {probe.isError ? (
            <Alert severity="error" data-testid="storage-probe-error">
              {localizedProbeError(probe.error, t)}
            </Alert>
          ) : null}
          {probe.isSuccess ? (
            <Alert severity="success" data-testid="storage-probe-success">
              {t.integrations.storageProbeSuccess}
            </Alert>
          ) : null}
          {probe.isSuccess ? (
            <Button
              type="button"
              variant="contained"
              onClick={save}
              disabled={configure.isPending}
              data-testid="storage-save"
              sx={{ alignSelf: 'start' }}
            >
              {configure.isPending ? t.integrations.storageSaving : t.integrations.storageSave}
            </Button>
          ) : null}
          {configure.isError ? (
            <Alert severity="error" data-testid="storage-save-error">
              {localizedProbeError(configure.error, t)}
            </Alert>
          ) : null}
          {configure.isSuccess ? (
            <Alert severity="success" data-testid="storage-save-success">
              {t.integrations.storageSaved}
            </Alert>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
};
