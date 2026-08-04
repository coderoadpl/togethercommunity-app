import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearch } from '@tanstack/react-router';

import type {
  EmailDeliveryStatus,
  EmailSendProjection,
  EmailSendStatus,
  TransactionalEmailTransport,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { formatDateTime } from '../../../lib/format.js';
import { EmailEventTimeline } from '../email/index.js';
import { deliveryStatusLabel, sendKindLabel, sendStatusLabel } from './EmailSendSummary.js';

const PAGE_SIZES = [10, 25, 50, 100];

export const validateSendsSearch = (search: Record<string, unknown>): { runId?: string } => {
  const runId = search['runId'];
  return typeof runId === 'string' && runId.trim().length > 0 ? { runId: runId.trim() } : {};
};

const statusColor = (status: EmailSendStatus): 'success' | 'warning' | 'error' | 'default' =>
  status === 'sent' ? 'success' : status === 'failed' ? 'error' : status === 'sending' ? 'warning' : 'default';

const deliveryColor = (status: EmailDeliveryStatus | null): 'success' | 'warning' | 'error' | 'default' =>
  status === 'delivered' ? 'success' : status === 'bounced' || status === 'complained' ? 'error' : 'default';

const isSendStatus = (value: string): value is EmailSendStatus =>
  ['queued', 'pending', 'sending', 'sent', 'failed', 'skipped'].includes(value);

const isDeliveryStatus = (value: string): value is EmailDeliveryStatus =>
  value === 'delivered' || value === 'bounced' || value === 'complained';

const isTransport = (value: string): value is TransactionalEmailTransport =>
  value === 'tenant-ses' || value === 'smtp' || value === 'resend' || value === 'platform';

const transportLabel = (transport: TransactionalEmailTransport, t: ReturnType<typeof useTranslations>) =>
  transport === 'tenant-ses'
    ? t.marketing.transportTenantSes
    : transport === 'smtp'
      ? t.marketing.transportSmtp
      : transport === 'resend'
        ? t.marketing.transportResend
        : t.marketing.transportPlatform;

const SendCampaign = ({ send }: { send: EmailSendProjection }) => {
  const t = useTranslations();
  if (send.campaignId === null) return <>{send.source}</>;
  return (
    <Link to="/panel/marketing/campaigns/$campaignId" params={{ campaignId: send.campaignId }}>
      {send.campaignName ?? t.marketing.campaignLabel}
    </Link>
  );
};

export const SendsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/panel/marketing/sends' });
  const { runId = '' } = useSearch({ from: '/panel/marketing/sends' });
  const campaigns = useQuery(actions.marketingCampaigns);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | EmailSendProjection['kind']>('all');
  const [status, setStatus] = useState<'all' | EmailSendStatus>('all');
  const [deliveryStatus, setDeliveryStatus] = useState<'all' | EmailDeliveryStatus>('all');
  const [transport, setTransport] = useState<'all' | TransactionalEmailTransport>('all');
  const [sourceApp, setSourceApp] = useState('');
  const [campaignId, setCampaignId] = useState('all');
  const [pageSize, setPageSize] = useState(25);
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);
  const debouncedSourceApp = useDebouncedValue(sourceApp);

  const filters = {
    ...(kind === 'all' ? {} : { kind }),
    ...(status === 'all' ? {} : { status }),
    ...(deliveryStatus === 'all' ? {} : { deliveryStatus }),
    ...(transport === 'all' ? {} : { transport }),
    ...(campaignId === 'all' ? {} : { campaignId }),
    ...(runId.length === 0 ? {} : { runId }),
    ...(debouncedSourceApp.length === 0 ? {} : { sourceApp: debouncedSourceApp }),
    ...(debouncedSearch.length === 0 ? {} : { search: debouncedSearch }),
  };
  const sends = useQuery(actions.emailSends({
    ...filters,
    ...(cursor === undefined ? {} : { cursor }),
    limit: pageSize,
  }));
  const filtered = Object.keys(filters).length > 0;

  const resetPagination = () => {
    setCursor(undefined);
    setPreviousCursors([]);
  };

  const download = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const file = await queryClient.fetchQuery(actions.emailSendsExport({ ...filters, format: 'csv' }));
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(localizeError(error, t));
    } finally {
      setExporting(false);
    }
  };

  const rows = sends.data?.sends ?? [];

  return (
    <PanelPage title={t.marketing.sendsTitle} description={t.marketing.sendsDescription}>
      {campaigns.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(campaigns.error, t), retry: { label: t.common.retry, onRetry: () => void campaigns.refetch() } }} /> : null}
      <ListSection
        data-testid="email-sends-list"
        isEmpty={sends.isSuccess && rows.length === 0 && !filtered && cursor === undefined}
        empty={<StatusView state={{ kind: 'empty', title: t.marketing.sendsEmpty }} />}
        noMatches={sends.isSuccess && rows.length === 0
          ? <StatusView state={{ kind: 'empty', title: t.marketing.sendsNoMatches }} />
          : undefined}
        toolbar={{
          search: (
            <SearchField
              value={search}
              onChange={(value) => {
                setSearch(value);
                resetPagination();
              }}
              label={t.marketing.sendsSearch}
              placeholder={t.marketing.sendsSearch}
              testId="email-sends-search"
            />
          ),
          filters: (
            <Stack direction={{ xs: 'column', md: 'row' }} useFlexGap spacing="0.5rem">
              <FormControl size="small" sx={{ minWidth: '8.5rem' }}>
                <InputLabel id="send-kind-label">{t.marketing.kind}</InputLabel>
                <Select
                  labelId="send-kind-label"
                  label={t.marketing.kind}
                  value={kind}
                  onChange={(event) => {
                    const value = event.target.value;
                    setKind(value === 'transactional' || value === 'marketing' ? value : 'all');
                    resetPagination();
                  }}
                >
                  <MenuItem value="all">{t.marketing.all}</MenuItem>
                  <MenuItem value="transactional">{t.marketing.kindTransactional}</MenuItem>
                  <MenuItem value="marketing">{t.marketing.kindMarketing}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: '8.5rem' }}>
                <InputLabel id="send-status-label">{t.marketing.statusLabel}</InputLabel>
                <Select
                  labelId="send-status-label"
                  label={t.marketing.statusLabel}
                  value={status}
                  onChange={(event) => {
                    setStatus(isSendStatus(event.target.value) ? event.target.value : 'all');
                    resetPagination();
                  }}
                >
                  <MenuItem value="all">{t.marketing.all}</MenuItem>
                  {(['queued', 'pending', 'sending', 'sent', 'failed', 'skipped'] as const).map((value) => (
                    <MenuItem key={value} value={value}>{sendStatusLabel(value, t)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: '9rem' }}>
                <InputLabel id="send-delivery-label">{t.marketing.deliveryStatusLabel}</InputLabel>
                <Select
                  labelId="send-delivery-label"
                  label={t.marketing.deliveryStatusLabel}
                  value={deliveryStatus}
                  onChange={(event) => {
                    setDeliveryStatus(isDeliveryStatus(event.target.value) ? event.target.value : 'all');
                    resetPagination();
                  }}
                >
                  <MenuItem value="all">{t.marketing.all}</MenuItem>
                  {(['delivered', 'bounced', 'complained'] as const).map((value) => (
                    <MenuItem key={value} value={value}>{deliveryStatusLabel(value, t)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: '10rem' }}>
                <InputLabel id="send-transport-label">{t.marketing.transportLabel}</InputLabel>
                <Select
                  labelId="send-transport-label"
                  label={t.marketing.transportLabel}
                  value={transport}
                  onChange={(event) => {
                    setTransport(isTransport(event.target.value) ? event.target.value : 'all');
                    resetPagination();
                  }}
                >
                  <MenuItem value="all">{t.marketing.all}</MenuItem>
                  {(['tenant-ses', 'smtp', 'resend', 'platform'] as const).map((value) => (
                    <MenuItem key={value} value={value}>{transportLabel(value, t)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: '10rem' }}>
                <InputLabel id="send-campaign-label">{t.marketing.campaignLabel}</InputLabel>
                <Select
                  labelId="send-campaign-label"
                  label={t.marketing.campaignLabel}
                  value={campaignId}
                  onChange={(event) => {
                    setCampaignId(event.target.value);
                    resetPagination();
                  }}
                >
                  <MenuItem value="all">{t.marketing.all}</MenuItem>
                  {(campaigns.data?.campaigns ?? []).map((campaign) => (
                    <MenuItem key={campaign.id} value={campaign.id}>{campaign.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                label={t.marketing.sourceApp}
                value={sourceApp}
                onChange={(event) => {
                  setSourceApp(event.target.value.trimStart());
                  resetPagination();
                }}
                sx={{ minWidth: '12rem' }}
              />
              <TextField
                size="small"
                label={t.marketing.runIdFilter}
                value={runId}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  void navigate({
                    search: value.length === 0 ? {} : { runId: value },
                    replace: true,
                  });
                  resetPagination();
                }}
                slotProps={{
                  input: runId.length === 0
                    ? {}
                    : {
                        endAdornment: (
                          <Button
                            size="small"
                            aria-label={t.marketing.clearRunFilter}
                            onClick={() => {
                              void navigate({ search: {}, replace: true });
                              resetPagination();
                            }}
                          >
                            ×
                          </Button>
                        ),
                      },
                }}
                sx={{ minWidth: '14rem' }}
              />
            </Stack>
          ),
          actions: (
            <Button variant="outlined" disabled={exporting} onClick={() => void download()}>
              {exporting ? t.marketing.exporting : t.marketing.exportCsv}
            </Button>
          ),
        }}
        pagination={(
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: { sm: 'center' }, justifyContent: 'flex-end' }}>
            <FormControl size="small" sx={{ minWidth: '7rem' }}>
              <InputLabel id="send-page-size-label">{t.pagination.rowsPerPage}</InputLabel>
              <Select
                labelId="send-page-size-label"
                label={t.pagination.rowsPerPage}
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  resetPagination();
                }}
              >
                {PAGE_SIZES.map((size) => <MenuItem key={size} value={size}>{size}</MenuItem>)}
              </Select>
            </FormControl>
            <Button
              disabled={previousCursors.length === 0}
              onClick={() => {
                const history = previousCursors.slice(0, -1);
                setCursor(previousCursors.at(-1));
                setPreviousCursors(history);
              }}
            >
              {t.pagination.previousPage}
            </Button>
            <Button
              disabled={sends.data?.nextCursor === null || sends.data?.nextCursor === undefined}
              onClick={() => {
                setPreviousCursors((history) => [...history, cursor]);
                setCursor(sends.data?.nextCursor ?? undefined);
              }}
            >
              {t.pagination.nextPage}
            </Button>
          </Stack>
        )}
      >
        {sends.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.marketing.sendsLoading }} />
        ) : sends.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(sends.error, t), retry: { label: t.common.retry, onRetry: () => void sends.refetch() } }} />
        ) : (
          <ResponsiveTable>
            <Table size="small" aria-label={t.marketing.sendsTitle}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.marketing.kind}</TableCell>
                  <TableCell>{t.marketing.recipient}</TableCell>
                  <TableCell>{t.marketing.subject}</TableCell>
                  <TableCell>{t.marketing.statusLabel}</TableCell>
                  <TableCell>{t.marketing.deliveryStatusLabel}</TableCell>
                  <TableCell>{t.marketing.transportLabel}</TableCell>
                  <TableCell>{t.marketing.source}</TableCell>
                  <TableCell>{t.marketing.sourceApp}</TableCell>
                  <TableCell>{t.marketing.sentTime}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((send) => (
                  <TableRow key={`${send.kind}:${send.id}`} data-testid="email-send-row">
                    <TableCell><Chip size="small" variant="outlined" label={sendKindLabel(send.kind, t)} /></TableCell>
                    <TableCell>{send.recipient}</TableCell>
                    <TableCell>{send.subject}</TableCell>
                    <TableCell>
                      <Stack useFlexGap spacing="0.25rem">
                        <Chip size="small" color={statusColor(send.status)} label={sendStatusLabel(send.status, t)} />
                        {send.failureCode === null ? null : (
                          <Typography variant="caption" color="error.main">
                            {send.failureCode}: {send.failureMessage}
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell><Chip size="small" variant="outlined" color={deliveryColor(send.deliveryStatus)} label={deliveryStatusLabel(send.deliveryStatus, t)} /></TableCell>
                    <TableCell>
                      <Stack direction="row" useFlexGap spacing="0.25rem" sx={{ flexWrap: 'wrap' }}>
                        <Chip size="small" variant="outlined" label={transportLabel(send.transport, t)} />
                        {send.transport === 'smtp' ? <Chip size="small" color="warning" label={t.marketing.limitedTracking} /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell><SendCampaign send={send} /></TableCell>
                    <TableCell>{send.sourceApp ?? '—'}</TableCell>
                    <TableCell>{send.sentAt === null ? t.marketing.notSent : formatDateTime(send.sentAt, language)}</TableCell>
                    <TableCell align="right">
                      <Button
                        component={Link}
                        size="small"
                        to={`/panel/marketing/sends/${encodeURIComponent(send.kind)}/${encodeURIComponent(send.id)}`}
                      >
                        {t.marketing.sendDetails}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>
        )}
      </ListSection>
      {exportError === null ? null : <Alert severity="error">{exportError}</Alert>}
    </PanelPage>
  );
};

export const SendDetailPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const params = useParams({ strict: false });
  const kind = params.kind === 'transactional' || params.kind === 'marketing' ? params.kind : null;
  const sendId = params.sendId;
  const detail = useQuery({
    ...actions.emailSend(kind ?? 'transactional', sendId ?? ''),
    enabled: kind !== null && sendId !== undefined,
  });

  if (kind === null || sendId === undefined) return <Navigate to="/panel/marketing/sends" />;
  if (detail.isPending) return <PanelPage title={t.marketing.sendDetails}><StatusView state={{ kind: 'loading', label: t.marketing.sendsLoading }} /></PanelPage>;
  if (detail.isError) return <PanelPage title={t.marketing.sendDetails}><StatusView state={{ kind: 'error', message: localizeError(detail.error, t), retry: { label: t.common.retry, onRetry: () => void detail.refetch() } }} /></PanelPage>;

  const send = detail.data.send;
  return (
    <PanelPage title={send.subject} backTo={<PanelBackLink to="/panel/marketing/sends">{t.marketing.allSends}</PanelBackLink>}>
      <SectionCard title={t.marketing.projection}>
        <Stack component="dl" useFlexGap spacing="0.75rem" sx={{ m: 0 }}>
          {[
            [t.marketing.kind, sendKindLabel(send.kind, t)],
            [t.marketing.recipient, send.recipient],
            [t.marketing.subject, send.subject],
            [t.marketing.statusLabel, sendStatusLabel(send.status, t)],
            [t.marketing.deliveryStatusLabel, deliveryStatusLabel(send.deliveryStatus, t)],
            [t.marketing.transportLabel, transportLabel(send.transport, t)],
            [t.marketing.source, send.campaignName ?? send.source],
            [t.marketing.sourceApp, send.sourceApp ?? '—'],
            [t.marketing.sentTime, send.sentAt === null ? t.marketing.notSent : formatDateTime(send.sentAt, language)],
            [t.marketing.createdTime, formatDateTime(send.createdAt, language)],
            [t.marketing.sesMessageId, send.sesMessageId ?? '—'],
            [t.marketing.skipReason, send.skipReason ?? '—'],
            [t.marketing.eventError, send.failureCode === null ? '—' : `${send.failureCode}: ${send.failureMessage ?? ''}`],
          ].map(([label, value]) => (
            <Stack key={label} direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.25rem">
              <Typography component="dt" variant="body2" color="text.secondary" sx={{ minWidth: { sm: '10rem' } }}>{label}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
            </Stack>
          ))}
        </Stack>
      </SectionCard>
      <SectionCard title={t.marketing.events}>
        <EmailEventTimeline events={detail.data.events} />
      </SectionCard>
    </PanelPage>
  );
};
