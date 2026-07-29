import { useState } from 'react';
import { Alert, Button, Card, Chip, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PostReportStatus } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, PanelPage } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';

type PendingAction = { reportId: string; action: 'dismiss' | 'delete-post' };

const STATUSES: PostReportStatus[] = ['open', 'dismissed', 'resolved'];

export const ReportsPanel = () => {
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
    return <PanelPage title={t.reports.heading} state={{ kind: 'loading', label: t.reports.loading }} />;
  }
  if (reports.isError) {
    return <PanelPage title={t.reports.heading} state={{ kind: 'error', message: localizeError(reports.error, t) }} />;
  }

  const statusLabel = (value: PostReportStatus): string =>
    value === 'open'
      ? t.reports.statusOpen
      : value === 'dismissed'
        ? t.reports.statusDismissed
        : t.reports.statusResolved;

  return (
    <PanelPage title={t.reports.heading}>
      <Alert severity="info">{t.reports.heuristicInfo}</Alert>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        {STATUSES.map((value) => (
          <Chip
            key={value}
            data-testid={`reports-status-${value}`}
            label={statusLabel(value)}
            color={status === value ? 'primary' : 'default'}
            onClick={() => setStatus(value)}
          />
        ))}
      </Stack>
      {reports.data.items.length === 0 ? <Alert severity="info">{t.reports.empty}</Alert> : null}
      {reports.data.items.map(({ report, post, spaceName, openReportsForPost }) => (
        <Card key={report.id} data-testid="report-row" variant="outlined" sx={{ p: '1rem' }}>
          <Stack useFlexGap sx={{ gap: '0.75rem' }}>
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <Chip size="small" label={report.reason} />
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
      {resolve.isError ? <Alert severity="error">{localizeError(resolve.error, t)}</Alert> : null}
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
    </PanelPage>
  );
};
