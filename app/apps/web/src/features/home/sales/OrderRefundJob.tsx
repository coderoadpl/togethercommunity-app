import { Alert, Chip, Stack, Typography } from '@mui/material';
import { SALES_LINK_TIME_ZONE, type OrderRefundJobView } from '#core/domain/index.js';

import { SectionCard } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

export const OrderRefundJob = ({ job }: { job: OrderRefundJobView }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const problem = job.status === 'failed' || job.status === 'blocked_permission';
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
      </Stack>
    </SectionCard>
  );
};
