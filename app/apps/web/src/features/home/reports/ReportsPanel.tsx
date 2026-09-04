import { useState } from 'react';
import { Alert, Button, Card, Chip, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  DmReportReason,
  DmReportStatus,
  PostReportReason,
  PostReportStatus,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { PostBody } from '../../../theme.js';

type PendingAction = { reportId: string; action: 'dismiss' | 'delete-post' };

const STATUSES: PostReportStatus[] = ['open', 'dismissed', 'resolved'];

const DM_STATUSES: DmReportStatus[] = ['open', 'resolved'];

const DM_REPORTS_PAGE_SIZE = 20;
const DM_REPORTS_MAX_LIMIT = 100;

const DmReportsSection = () => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DmReportStatus>('open');
  const [pending, setPending] = useState<string | null>(null);
  const [limit, setLimit] = useState(DM_REPORTS_PAGE_SIZE);
  const { language } = useLanguage();
  const reports = useQuery(actions.dmReports({ status, limit }));
  const resolve = useMutation({
    ...actions.resolveDmReport,
    onSuccess: async () => {
      setPending(null);
      await queryClient.invalidateQueries(actions.dmReportsInvalidates());
    },
  });

  const reasonLabel = (value: DmReportReason): string => {
    switch (value) {
      case 'spam':
        return t.community.reportReasonSpam;
      case 'harassment':
        return t.community.reportReasonHarassment;
      case 'illegal':
        return t.community.reportReasonIllegal;
      case 'other':
        return t.community.reportReasonOther;
    }
  };

  return (
    <SectionCard title={t.dmReports.heading} description={t.dmReports.intro}>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        {DM_STATUSES.map((value) => (
          <Chip
            key={value}
            data-testid={`dm-reports-status-${value}`}
            label={value === 'open' ? t.reports.statusOpen : t.reports.statusResolved}
            color={status === value ? 'primary' : 'default'}
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setLimit(DM_REPORTS_PAGE_SIZE);
            }}
          />
        ))}
      </Stack>
      {reports.isPending ? <Typography variant="body2">{t.reports.loading}</Typography> : null}
      {reports.isError ? <Alert severity="error">{localizePanelError(reports.error, t)}</Alert> : null}
      {reports.isSuccess && reports.data.reports.length === 0 ? (
        <Alert severity="info">{t.dmReports.empty}</Alert>
      ) : null}
      {(reports.data?.reports ?? []).map((report) => (
        <Card key={report.id} data-testid="dm-report-row" variant="outlined" sx={{ p: '1rem' }}>
          <Stack useFlexGap sx={{ gap: '0.75rem' }}>
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <Chip size="small" label={reasonLabel(report.reason)} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t.dmReports.parties({ reporter: report.reporterDisplay, reported: report.reportedDisplay })}
            </Typography>
            <Stack useFlexGap sx={{ gap: '0.35rem' }} data-testid={`dm-report-snapshot-${report.id}`}>
              {report.snapshot.length === 0 ? (
                <Typography variant="body2">{t.dmReports.emptySnapshot}</Typography>
              ) : (
                report.snapshot.map((message) => (
                  <PostBody key={message.id} variant="body2" component="p">
                    {`${message.senderDisplay} · ${formatDateTime(message.createdAt, language)}: ${message.body}`}
                  </PostBody>
                ))
              )}
            </Stack>
            {status === 'open' ? (
              <Stack direction="row" useFlexGap sx={{ gap: '0.5rem' }}>
                <Button data-testid={`dm-report-resolve-${report.id}`} onClick={() => setPending(report.id)}>
                  {t.dmReports.resolve}
                </Button>
              </Stack>
            ) : null}
          </Stack>
        </Card>
      ))}
      {(reports.data?.nextCursor ?? null) === null || limit >= DM_REPORTS_MAX_LIMIT ? null : (
        <Button
          variant="outlined"
          data-testid="dm-reports-load-more"
          disabled={reports.isFetching}
          onClick={() => setLimit((previous) => Math.min(previous + DM_REPORTS_PAGE_SIZE, DM_REPORTS_MAX_LIMIT))}
        >
          {t.dmReports.loadMore}
        </Button>
      )}
      {resolve.isError ? <Alert severity="error">{localizePanelError(resolve.error, t)}</Alert> : null}
      <ConfirmDialog
        open={pending !== null}
        title={t.dmReports.resolve}
        body={t.dmReports.resolveConfirm}
        confirmLabel={t.dmReports.resolve}
        cancelLabel={t.common.cancel}
        pending={resolve.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) resolve.mutate({ reportId: pending });
        }}
      />
    </SectionCard>
  );
};

const PostReportsSection = () => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PostReportStatus>('open');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const reports = useQuery(actions.reports({ status }));
  const resolve = useMutation({
    ...actions.resolveReport,
    onSuccess: async () => {
      setPending(null);
      await queryClient.invalidateQueries(actions.reportsInvalidates());
    },
  });

  if (reports.isPending) {
    return <StatusView state={{ kind: 'loading', label: t.reports.loading }} />;
  }
  if (reports.isError) {
    return <StatusView state={{ kind: 'error', message: localizePanelError(reports.error, t), retry: { label: t.common.retry, onRetry: () => void reports.refetch() } }} />;
  }

  const statusLabel = (value: PostReportStatus): string =>
    value === 'open'
      ? t.reports.statusOpen
      : value === 'dismissed'
        ? t.reports.statusDismissed
        : t.reports.statusResolved;
  const reasonLabel = (value: PostReportReason): string => {
    switch (value) {
      case 'spam':
        return t.community.reportReasonSpam;
      case 'harassment':
        return t.community.reportReasonHarassment;
      case 'off-topic':
        return t.community.reportReasonOffTopic;
      case 'illegal':
        return t.community.reportReasonIllegal;
      case 'other':
        return t.community.reportReasonOther;
    }
  };

  return (
    <>
      <Alert severity="info">{t.reports.heuristicInfo}</Alert>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        {STATUSES.map((value) => (
          <Chip
            key={value}
            data-testid={`reports-status-${value}`}
            label={statusLabel(value)}
            color={status === value ? 'primary' : 'default'}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          />
        ))}
      </Stack>
      {reports.data.items.length === 0 ? <Alert severity="info">{t.reports.empty}</Alert> : null}
      {reports.data.items.map(({ report, post, spaceName, openReportsForPost }) => (
        <Card key={report.id} data-testid="report-row" variant="outlined" sx={{ p: '1rem' }}>
          <Stack useFlexGap sx={{ gap: '0.75rem' }}>
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <Chip size="small" label={reasonLabel(report.reason)} />
              <Chip
                size="small"
                label={report.source === 'member' ? t.reports.sourceMember : t.reports.sourceHeuristic}
              />
              {report.signals?.map((signal) => (
                <Chip
                  key={signal}
                  size="small"
                  label={signal === 'link-flood' ? t.reports.signalLinkFlood : t.reports.signalDuplicateBody}
                />
              ))}
            </Stack>
            <Typography>{post.body}</Typography>
            <Typography variant="body2" color="text.secondary">
              {post.authorDisplay}{spaceName === null ? '' : ` · ${spaceName}`}
            </Typography>
            {report.note === null ? null : <Typography variant="body2">{report.note}</Typography>}
            <Typography variant="body2" color="text.secondary">
              {report.reporterDisplay === null ? '' : t.reports.reportedBy({ name: report.reporterDisplay })}
              {' · '}{t.reports.otherReports({ count: openReportsForPost })}
            </Typography>
            {status === 'open' ? (
              <Stack direction="row" useFlexGap sx={{ gap: '0.5rem' }}>
                <Button
                  data-testid={`report-dismiss-${report.id}`}
                  onClick={() => setPending({ reportId: report.id, action: 'dismiss' })}
                >
                  {t.reports.dismiss}
                </Button>
                <Button
                  color="error"
                  data-testid={`report-delete-${report.id}`}
                  onClick={() => setPending({ reportId: report.id, action: 'delete-post' })}
                >
                  {t.reports.deletePost}
                </Button>
              </Stack>
            ) : null}
          </Stack>
        </Card>
      ))}
      {resolve.isError ? <Alert severity="error">{localizePanelError(resolve.error, t)}</Alert> : null}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.action === 'delete-post' ? t.reports.deletePost : t.reports.dismiss}
        body={pending?.action === 'delete-post' ? t.reports.deletePostConfirm : t.reports.dismissConfirm}
        confirmLabel={pending?.action === 'delete-post' ? t.reports.deletePost : t.reports.dismiss}
        cancelLabel={t.common.cancel}
        pending={resolve.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) resolve.mutate(pending);
        }}
      />
    </>
  );
};

export const ReportsPanel = () => {
  const t = useTranslations();
  return (
    <PanelPage title={t.reports.heading}>
      <PostReportsSection />
      <DmReportsSection />
    </PanelPage>
  );
};
