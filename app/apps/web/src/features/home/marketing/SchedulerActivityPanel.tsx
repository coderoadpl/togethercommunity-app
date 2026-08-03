import { useState } from 'react';
import {
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
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from '@tanstack/react-router';

import type { SchedulerRunKind, SchedulerRunStatus } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { SchedulerActivitySummary, SchedulerRunStatusChip } from './SchedulerActivitySummary.js';

const PAGE_SIZES = [10, 25, 50, 100];

const isRunKind = (value: string): value is SchedulerRunKind =>
  value === 'marketing_tick' || value === 'outbox_dispatch' || value === 'consent_evidence_purge';

const isRunStatus = (value: string): value is SchedulerRunStatus =>
  value === 'running' || value === 'completed' || value === 'failed';

export const SchedulerActivityPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [kind, setKind] = useState<'all' | SchedulerRunKind>('all');
  const [status, setStatus] = useState<'all' | SchedulerRunStatus>('all');
  const [pageSize, setPageSize] = useState(25);
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
  const filters = {
    ...(kind === 'all' ? {} : { kind }),
    ...(status === 'all' ? {} : { status }),
  };
  const activity = useQuery(actions.schedulerRuns({
    ...filters,
    ...(cursor === undefined ? {} : { cursor }),
    limit: pageSize,
  }));
  const resetPagination = () => {
    setCursor(undefined);
    setPreviousCursors([]);
  };
  const items = activity.data?.items ?? [];
  const summary = activity.data?.summary;
  const lastRun = summary?.lastRun ?? null;

  return (
    <PanelPage title={t.marketing.activity.title} description={t.marketing.activity.description}>
      {summary === undefined ? null : (
        <SchedulerActivitySummary
          runs={{ label: t.marketing.activity.runsLast24Hours, value: String(summary.runsLast24Hours) }}
          sent={{ label: t.marketing.activity.sentLast24Hours, value: String(summary.sentLast24Hours) }}
          failed={{ label: t.marketing.activity.failedLast24Hours, value: String(summary.failedLast24Hours) }}
          lastRun={{
            label: t.marketing.activity.lastRun,
            value: lastRun === null ? t.marketing.activity.noLastRun : formatDateTime(lastRun.startedAt, language),
            ...(lastRun === null
              ? {}
              : { status: lastRun.status, statusLabel: t.marketing.activity.statuses[lastRun.status] }),
          }}
        />
      )}
      <ListSection
        data-testid="scheduler-activity-list"
        isEmpty={activity.isSuccess && items.length === 0 && kind === 'all' && status === 'all' && cursor === undefined}
        empty={<StatusView state={{ kind: 'empty', title: t.marketing.activity.empty }} />}
        noMatches={activity.isSuccess && items.length === 0
          ? <StatusView state={{ kind: 'empty', title: t.marketing.activity.noMatches }} />
          : undefined}
        toolbar={{
          filters: (
            <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem">
              <FormControl size="small" sx={{ minWidth: '11rem' }}>
                <InputLabel id="scheduler-kind-label">{t.marketing.activity.runKind}</InputLabel>
                <Select
                  labelId="scheduler-kind-label"
                  label={t.marketing.activity.runKind}
                  value={kind}
                  onChange={(event) => {
                    setKind(isRunKind(event.target.value) ? event.target.value : 'all');
                    resetPagination();
                  }}
                >
                  <MenuItem value="all">{t.marketing.all}</MenuItem>
                  {(['marketing_tick', 'outbox_dispatch', 'consent_evidence_purge'] as const).map((value) => (
                    <MenuItem key={value} value={value}>{t.marketing.activity.kinds[value]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: '10rem' }}>
                <InputLabel id="scheduler-status-label">{t.marketing.statusLabel}</InputLabel>
                <Select
                  labelId="scheduler-status-label"
                  label={t.marketing.statusLabel}
                  value={status}
                  onChange={(event) => {
                    setStatus(isRunStatus(event.target.value) ? event.target.value : 'all');
                    resetPagination();
                  }}
                >
                  <MenuItem value="all">{t.marketing.all}</MenuItem>
                  {(['running', 'completed', 'failed'] as const).map((value) => (
                    <MenuItem key={value} value={value}>{t.marketing.activity.statuses[value]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          ),
        }}
        pagination={(
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: { sm: 'center' }, justifyContent: 'flex-end' }}>
            <FormControl size="small" sx={{ minWidth: '7rem' }}>
              <InputLabel id="scheduler-page-size-label">{t.pagination.rowsPerPage}</InputLabel>
              <Select
                labelId="scheduler-page-size-label"
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
                setCursor(previousCursors.at(-1));
                setPreviousCursors(previousCursors.slice(0, -1));
              }}
            >
              {t.pagination.previousPage}
            </Button>
            <Button
              disabled={activity.data?.nextCursor === null || activity.data?.nextCursor === undefined}
              onClick={() => {
                setPreviousCursors((history) => [...history, cursor]);
                setCursor(activity.data?.nextCursor ?? undefined);
              }}
            >
              {t.pagination.nextPage}
            </Button>
          </Stack>
        )}
      >
        {activity.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.marketing.activity.loading }} />
        ) : activity.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(activity.error, t) }} />
        ) : (
          <ResponsiveTable>
            <Table size="small" aria-label={t.marketing.activity.title}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.marketing.activity.runKind}</TableCell>
                  <TableCell>{t.marketing.activity.trigger}</TableCell>
                  <TableCell>{t.marketing.activity.started}</TableCell>
                  <TableCell>{t.marketing.activity.duration}</TableCell>
                  <TableCell>{t.marketing.activity.tenantCounts}</TableCell>
                  <TableCell>{t.marketing.statusLabel}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map(({ run, tenant }) => (
                  <TableRow key={run.id} data-testid="scheduler-activity-row">
                    <TableCell><Chip size="small" variant="outlined" label={t.marketing.activity.kinds[run.kind]} /></TableCell>
                    <TableCell>{t.marketing.activity.triggers[run.trigger]}</TableCell>
                    <TableCell>{formatDateTime(run.startedAt, language)}</TableCell>
                    <TableCell>{run.durationMs === null ? '—' : t.marketing.activity.milliseconds({ value: run.durationMs })}</TableCell>
                    <TableCell>{run.kind === 'consent_evidence_purge'
                      ? t.marketing.activity.purgeCount({ purged: tenant.purged ?? 0 })
                      : t.marketing.activity.counts(tenant)}</TableCell>
                    <TableCell><SchedulerRunStatusChip status={run.status} label={t.marketing.activity.statuses[run.status]} /></TableCell>
                    <TableCell align="right">
                      <Button component="a" size="small" href={`/panel/marketing/activity/${encodeURIComponent(run.id)}`}>
                        {t.marketing.activity.details}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>
        )}
      </ListSection>
    </PanelPage>
  );
};

export const SchedulerActivityDetailPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const runId = useParams({ strict: false }).runId;
  const detail = useQuery({
    ...actions.schedulerRun(runId ?? ''),
    enabled: runId !== undefined,
  });

  if (runId === undefined) return <Navigate to="/panel/marketing/activity" />;
  if (detail.isPending) {
    return <PanelPage title={t.marketing.activity.details}><StatusView state={{ kind: 'loading', label: t.marketing.activity.loading }} /></PanelPage>;
  }
  if (detail.isError) {
    return <PanelPage title={t.marketing.activity.details}><StatusView state={{ kind: 'error', message: localizeError(detail.error, t) }} /></PanelPage>;
  }

  const { run, tenant } = detail.data;
  return (
    <PanelPage
      title={t.marketing.activity.kinds[run.kind]}
      backTo={{ label: t.marketing.activity.allRuns, href: '/panel/marketing/activity' }}
      action={<SchedulerRunStatusChip status={run.status} label={t.marketing.activity.statuses[run.status]} />}
    >
      <SectionCard title={t.marketing.activity.details}>
        <Stack component="dl" useFlexGap spacing="0.75rem" sx={{ m: 0 }}>
          {[
            [t.marketing.activity.runId, run.id],
            [t.marketing.activity.trigger, t.marketing.activity.triggers[run.trigger]],
            [t.marketing.activity.started, formatDateTime(run.startedAt, language)],
            [
              t.marketing.activity.finished,
              run.finishedAt === null ? '—' : formatDateTime(run.finishedAt, language),
            ],
            [t.marketing.activity.duration, run.durationMs === null ? '—' : t.marketing.activity.milliseconds({ value: run.durationMs })],
            ...(run.error === null ? [] : [[t.marketing.activity.runError, run.error]]),
          ].map(([label, value]) => (
            <Stack key={label} direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.25rem">
              <Typography component="dt" variant="body2" color="text.secondary" sx={{ minWidth: { sm: '11rem' } }}>{label}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>{value}</Typography>
            </Stack>
          ))}
        </Stack>
      </SectionCard>
      <SectionCard title={t.marketing.activity.breakdown}>
        <Stack component="dl" useFlexGap spacing="0.75rem" sx={{ m: 0 }}>
          {(run.kind === 'consent_evidence_purge'
            ? [[t.marketing.activity.evidencePurged, String(tenant.purged ?? 0)]]
            : [
                [t.marketing.activity.campaignsTouched, String(tenant.campaignsTouched)],
                [t.marketing.activity.batchSize, String(tenant.batchSize)],
                [t.marketing.activity.tenantCounts, t.marketing.activity.counts(tenant)],
                [t.marketing.activity.budget, t.marketing.activity.budgetUsage({ computed: tenant.budgetComputed, used: tenant.budgetUsed })],
              ]).map(([label, value]) => (
            <Stack key={label} direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.25rem">
              <Typography component="dt" variant="body2" color="text.secondary" sx={{ minWidth: { sm: '11rem' } }}>{label}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>{value}</Typography>
            </Stack>
          ))}
        </Stack>
        <Typography variant="h3" sx={{ mt: '1.25rem', mb: '0.5rem' }}>{t.marketing.activity.errors}</Typography>
        {tenant.errors.length === 0
          ? <Typography color="text.secondary">{t.marketing.activity.noErrors}</Typography>
          : (
            <Stack component="ul" useFlexGap spacing="0.35rem" sx={{ m: 0, pl: '1.25rem' }}>
              {tenant.errors.map((error, index) => <Typography component="li" key={`${String(index)}:${error}`}>{error}</Typography>)}
            </Stack>
          )}
      </SectionCard>
      {run.kind === 'consent_evidence_purge' ? null : (
        <Button component="a" variant="outlined" href={`/panel/marketing/sends?runId=${encodeURIComponent(run.id)}`}>
          {t.marketing.activity.viewSends}
        </Button>
      )}
    </PanelPage>
  );
};
