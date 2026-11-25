import { Alert, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { SALES_LINK_TIME_ZONE } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ResponsiveTable, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

export const RejectedPaymentsSection = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const rejections = useQuery(actions.paymentEventRejections);
  if (rejections.isError) {
    return <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(rejections.error, t), retry: { label: t.common.retry, onRetry: () => void rejections.refetch() } }} />;
  }
  const rows = rejections.data?.rejections ?? [];
  if (rows.length === 0) return null;
  return (
    <Alert severity="error" data-testid="rejected-payments">
      <Typography variant="subtitle2" component="h2">{t.sales.rejectedPaymentsHeading}</Typography>
      <Typography variant="body2">{t.sales.rejectedPaymentsHint}</Typography>
      <ResponsiveTable>
        <Table size="small" aria-label={t.sales.rejectedPaymentsHeading}>
          <TableHead>
            <TableRow>
              <TableCell>{t.sales.rejectedPaymentsReason}</TableCell>
              <TableCell>{t.sales.rejectedPaymentsFirstSeen}</TableCell>
              <TableCell>{t.sales.rejectedPaymentsLastSeen}</TableCell>
              <TableCell>{t.sales.rejectedPaymentsAttempts}</TableCell>
              <TableCell>{t.sales.rejectedPaymentsEvent}</TableCell>
              <TableCell>{t.sales.rejectedPaymentsSession}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.eventId} data-testid="rejected-payment-row">
                <TableCell>{row.reasonCode}: {row.reasonMessage}</TableCell>
                <TableCell>{formatDateTime(row.firstSeenAt, language, SALES_LINK_TIME_ZONE)}</TableCell>
                <TableCell>{formatDateTime(row.lastSeenAt, language, SALES_LINK_TIME_ZONE)}</TableCell>
                <TableCell>{row.attempts}</TableCell>
                <TableCell>{row.eventId}</TableCell>
                <TableCell>{row.checkoutSessionId ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ResponsiveTable>
    </Alert>
  );
};
