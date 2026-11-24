import { Alert, Chip, Stack, Typography } from '@mui/material';
import { SALES_LINK_TIME_ZONE, type OrderRefundJobView } from '#core/domain/index.js';

import { SectionCard } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

type RefundStatus = OrderRefundJobView['status'];

const refundStatusColor = (status: RefundStatus): 'error' | 'warning' | 'info' | 'success' | 'default' => {
  if (status === 'failed' || status === 'unconfirmed') return 'error';
  if (status === 'blocked_permission') return 'warning';
  if (status === 'running' || status === 'submitted') return 'info';
  if (status === 'succeeded' || status === 'skipped_refunded' || status === 'resolved_externally') return 'success';
  return 'default';
};

export const RefundStatusChip = ({ status, label, 'data-testid': testId }: { status: RefundStatus; label: string; 'data-testid'?: string }) => {
  const color = refundStatusColor(status);
  return <Chip size="small" color={color} variant={color === 'warning' || color === 'default' ? 'filled' : 'outlined'} label={label} data-testid={testId} />;
};

export const OrderRefundJob = ({ job }: { job: OrderRefundJobView }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const problem = job.status === 'failed' || job.status === 'blocked_permission' || job.status === 'unconfirmed';
  const rows = [
    [t.sales.refundJobAttempts, String(job.attempts)],
    [t.sales.refundJobNextAttempt, job.nextAttemptAt === null ? '—' : formatDateTime(job.nextAttemptAt, language, SALES_LINK_TIME_ZONE)],
    [t.sales.refundJobProviderRefund, job.providerRefundId === null ? '—' : `${job.providerRefundId} (${job.providerRefundStatus ?? '—'})`],
    [t.sales.refundJobLastError, job.lastError ?? '—'],
  ];
  return (
    <SectionCard title={t.sales.refundJobTitle} data-testid="order-refund-job">
      <Stack useFlexGap spacing="0.75rem">
        <Stack direction="row" useFlexGap spacing="0.5rem">
          <Typography color="text.secondary">{t.sales.status}</Typography>
          <Chip size="small" color={problem ? 'error' : job.status === 'succeeded' ? 'success' : 'default'} label={t.sales.refundJobStatuses[job.status]} />
        </Stack>
        {rows.map(([label, value]) => (
          <Stack key={label} direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem" sx={{ justifyContent: 'space-between' }}>
            <Typography color="text.secondary">{label}</Typography>
            <Typography sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
          </Stack>
        ))}
        {job.status === 'blocked_permission' ? <Alert severity="error">{t.sales.refundJobBlockedHelp}</Alert> : null}
        {job.status === 'failed' ? <Alert severity="error">{t.sales.refundJobFailedHelp}</Alert> : null}
        {job.status === 'unconfirmed' ? <Alert severity="error">{t.sales.refundJobUnconfirmedHelp}</Alert> : null}
      </Stack>
    </SectionCard>
  );
};
