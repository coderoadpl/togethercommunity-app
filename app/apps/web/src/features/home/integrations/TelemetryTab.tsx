import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, FormControl, FormLabel, OutlinedInput, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TelemetryStoreView } from '#core/domain/telemetry.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatFileSize } from '../../../lib/format.js';

export const TelemetryUnavailable = () => {
  const t = useTranslations();
  return <Alert severity="info" data-testid="telemetry-statistics-unavailable">{t.telemetryStore.unavailable}</Alert>;
};

export const TelemetryStoreForm = ({ view, pending, failed, onConnect, onProbe, onDisconnect }: {
  view: TelemetryStoreView; pending: boolean; failed: boolean;
  onConnect: (input: { connectionString: string; region: string }) => void;
  onProbe: () => void; onDisconnect: () => void;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const copy = t.telemetryStore;
  const [connectionString, setConnectionString] = useState('');
  const [region, setRegion] = useState('');
  const [confirming, setConfirming] = useState(false);
  const connected = view.settings.provider !== null;
  const submit = (event: FormEvent) => { event.preventDefault(); onConnect({ connectionString, region }); setConnectionString(''); };
  return <SectionCard title={copy.title}>
    <Stack spacing="1rem" data-testid="telemetry-store">
      <Typography>{copy.intro}</Typography>
      <Typography>{connected ? copy.connected : copy.disconnected}</Typography>
      <Alert severity="info" data-testid={`telemetry-egress-${view.egress.mode}`}>
        {copy[view.egress.mode]}{view.egress.mode === 'stable' ? ` ${view.egress.ip ?? ''}` : ''}
      </Alert>
      <Typography variant="body2">{copy.privacy}</Typography>
      {pending ? <Alert severity="info" role="status">{copy.probing}</Alert> : null}
      {failed || view.settings.lastProbeResult === 'error' ? <Alert severity="error">{copy.error}</Alert> : null}
      {view.settings.lastProbeResult === 'ok' ? <Alert severity="success">{copy.success}</Alert> : null}
      {connected && view.sync.admissionPaused ? <Alert severity="warning" data-testid="telemetry-admission-paused">{copy.pause}</Alert> : null}
      {connected ? <>
        <Typography>{view.settings.region}</Typography>
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '0.5rem', m: 0, '& dd': { m: 0, overflowWrap: 'anywhere' } }}>
          <dt>{copy.lastAck}</dt><dd>{view.sync.lastAcknowledgedSequence}</dd>
          <dt>{copy.lastSync}</dt><dd>{view.sync.lastAcknowledgedAt === null ? copy.never : formatDateTime(view.sync.lastAcknowledgedAt, language)}</dd>
          <dt>{copy.pending}</dt><dd>{view.sync.pendingBytes === 0 ? copy.empty : formatFileSize(view.sync.pendingBytes, language)}</dd>
          <dt>{copy.oldest}</dt><dd>{view.sync.oldestPendingAt === null ? copy.never : formatDateTime(view.sync.oldestPendingAt, language)}</dd>
          <dt>{copy.gaps}</dt><dd>{view.sync.gapCount}</dd>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing="0.5rem">
          <Button variant="outlined" disabled={pending} onClick={onProbe}>{copy.probe}</Button>
          <Button color="error" disabled={pending} onClick={() => setConfirming(true)}>{copy.disconnect}</Button>
        </Stack>
        {confirming ? <Alert severity="warning" action={<Button color="inherit" disabled={pending} onClick={onDisconnect}>{copy.confirmDisconnect}</Button>}>{copy.disconnectWarning}</Alert> : null}
      </> : <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '1rem' }}>
        <FormControl fullWidth><FormLabel htmlFor="telemetry-connection">{copy.connection}</FormLabel><OutlinedInput id="telemetry-connection" type="password" autoComplete="off" value={connectionString} onChange={(event) => setConnectionString(event.target.value)} required disabled={pending} /></FormControl>
        <FormControl fullWidth><FormLabel htmlFor="telemetry-region">{copy.region}</FormLabel><OutlinedInput id="telemetry-region" value={region} onChange={(event) => setRegion(event.target.value)} required disabled={pending} /></FormControl>
        <Button type="submit" variant="contained" disabled={pending}>{copy.connect}</Button>
      </Box>}
    </Stack>
  </SectionCard>;
};

export const TelemetryTab = () => {
  const t = useTranslations();
  const client = useQueryClient();
  const query = useQuery(actions.telemetryStore);
  const onSuccess = async () => { await client.invalidateQueries(actions.telemetryStoreInvalidates()); await client.invalidateQueries(actions.marketingInvalidates()); };
  const connect = useMutation({ ...actions.connectTelemetry, onSuccess });
  const probe = useMutation({ ...actions.probeTelemetry, onSuccess });
  const disconnect = useMutation({ ...actions.disconnectTelemetry, onSuccess });
  if (query.isPending) return <StatusView state={{ kind: 'loading', label: t.telemetryStore.probing }} />;
  if (query.isError) return <StatusView state={{ kind: 'error', message: t.telemetryStore.error, retry: { label: t.common.retry, onRetry: () => void query.refetch() } }} />;
  return <TelemetryStoreForm view={query.data} pending={connect.isPending || probe.isPending || disconnect.isPending} failed={connect.isError || probe.isError || disconnect.isError} onConnect={(input) => connect.mutate(input)} onProbe={() => probe.mutate(undefined)} onDisconnect={() => disconnect.mutate(undefined)} />;
};
