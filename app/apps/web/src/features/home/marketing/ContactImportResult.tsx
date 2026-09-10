import { useEffect, useState } from 'react';
import { Alert, Button, Chip, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { MarketingContactImport, MarketingImportCounts, MarketingImportRowReceipt } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { usePanelContext } from '../panel-context.js';
import { DirectoryActions, DirectoryError } from './DirectoryFields.js';

type ImportStatus = MarketingContactImport['status'];

const importStatusColor = (status: ImportStatus): 'default' | 'primary' | 'info' | 'success' | 'warning' | 'error' => {
  switch (status) {
    case 'draft':
    case 'ready':
      return 'default';
    case 'queued':
      return 'primary';
    case 'processing':
      return 'info';
    case 'completed':
      return 'success';
    case 'completed_with_errors':
      return 'warning';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'default';
  }
};

export const importErrorCsv = (rows: MarketingImportRowReceipt[]): string => {
  const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  return ['row,email,errors,warnings', ...rows.filter((row) => row.errors.length > 0).map((row) => [String(row.rowNumber), row.normalizedPayload?.email ?? (typeof row.stagedPayload?.['email'] === 'string' ? row.stagedPayload['email'] : ''), row.errors.join('; '), row.warnings.join('; ')].map(cell).join(','))].join('\r\n');
};

const ImportCounts = ({ counts }: { counts: MarketingImportCounts }) => {
  const t = useTranslations();
  const order = ['created', 'updated', 'unchanged', 'duplicateRows', 'rejectedRows', 'linkedMembers', 'membershipsAdded', 'listsCreated', 'consentsRecorded', 'consentsPreserved', 'consentBlockedBySuppression', 'consentBlockedByWithdrawal', 'suppressionsCreated', 'suppressionsExisting'] as const;
  return <Stack useFlexGap spacing="0.5rem">{order.filter((key) => counts[key] > 0).map((key) => <Typography key={key}>{t.directory[key]}: {counts[key]}</Typography>)}</Stack>;
};

const ImportErrorsDownload = ({ importId }: { importId: string }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const cache = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const download = async () => {
    setLoading(true); setError(null);
    try {
      const rows: MarketingImportRowReceipt[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page: { rows: MarketingImportRowReceipt[]; nextOffset: number | null } = await cache.fetchQuery(actions.directory.importRows(tenant.id, { importId, offset, limit: 200 }));
        rows.push(...page.rows); offset = page.nextOffset;
      }
      const url = URL.createObjectURL(new Blob([importErrorCsv(rows)], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `import-${importId}-errors.csv`;
      document.body.append(anchor);
      anchor.click();
      setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 0);
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  };
  return <><Button disabled={loading} onClick={() => void download()}>{t.directory.downloadErrors}</Button><DirectoryError error={error} /></>;
};

export const ContactImportResult = ({ importId }: { importId: string }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const cache = useQueryClient();
  const batch = useQuery({ ...actions.directory.import(tenant.id, { importId }), refetchInterval: (query) => query.state.data && ['queued', 'processing'].includes(query.state.data.import.status) ? 2000 : false });
  const onSuccess = async () => cache.invalidateQueries(actions.directory.invalidates(tenant.id));
  const retry = useMutation({ ...actions.directory.retryMarketingContactImport, onSuccess });
  const cancel = useMutation({ ...actions.directory.cancelMarketingContactImport, onSuccess });
  const data: MarketingContactImport | undefined = batch.data?.import;
  const status = data?.status;
  useEffect(() => { if (status && ['completed', 'completed_with_errors'].includes(status)) void cache.invalidateQueries(actions.directory.invalidates(tenant.id)); }, [cache, status, tenant.id]);
  const isProcessing = data?.status === 'queued' || data?.status === 'processing';
  const hasRejectedRows = data !== undefined && data.resultCounts.rejectedRows > 0;
  const canDownloadErrors = data !== undefined && hasRejectedRows && data.stagedDataPurgedAt === null;
  return <SectionCard title={t.directory.result}>
    <DirectoryError error={batch.error ?? retry.error ?? cancel.error} />{batch.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : null}
    {data ? <Stack useFlexGap spacing="0.75rem">
      <Chip role="status" color={importStatusColor(data.status)} label={t.directory[data.status]} size="small" sx={{ alignSelf: 'flex-start' }} />
      <Typography>{data.fileName} · {t.directory.totalRows}: {data.rowCount}</Typography>
      <Typography>{t.directory.statusGuidance[data.status]}</Typography>
      {isProcessing ? <Alert severity="info">{t.directory.processingHint}</Alert> : null}
      {data.lastError ? <Alert severity="error">{data.lastError}</Alert> : null}
      <ImportCounts counts={data.resultCounts} />
      {canDownloadErrors ? <ImportErrorsDownload importId={data.id} /> : null}
      {hasRejectedRows && data.stagedDataPurgedAt !== null ? <Typography color="text.secondary">{t.directory.errorsPurged}</Typography> : null}
      <DirectoryActions>{data.status === 'failed' ? <Button disabled={retry.isPending} onClick={() => retry.mutate({ importId })}>{t.directory.retryImport}</Button> : null}{['draft', 'ready', 'queued', 'processing', 'failed'].includes(data.status) ? <Button disabled={cancel.isPending} onClick={() => cancel.mutate({ importId })}>{t.directory.cancelImport}</Button> : null}<Button component={Link} to="/panel/marketing/contacts">{t.directory.contactsTitle}</Button></DirectoryActions>
      <Typography variant="caption" color="text.secondary">{t.directory.batchId}: {data.id}</Typography>
    </Stack> : null}
  </SectionCard>;
};
