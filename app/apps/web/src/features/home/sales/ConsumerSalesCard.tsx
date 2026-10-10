import { useState } from 'react';
import { Alert, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { consumerSalesQuerySchema, SALES_LINK_TIME_ZONE } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatPrice } from '../../../lib/format.js';

const previousMonth = () => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: SALES_LINK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const first = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  first.setUTCDate(0);
  const to = first.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 7)}-01`, to };
};

export const ConsumerSalesCard = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [range, setRange] = useState(previousMonth);
  const [downloading, setDownloading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const valid = consumerSalesQuerySchema.safeParse(range).success;
  const summary = useQuery({ ...actions.consumerSalesSummary(range), enabled: valid });
  const download = async () => {
    setDownloading(true);
    setExportError(null);
    try {
      const file = await queryClient.fetchQuery(actions.consumerSalesExport(range));
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(localizePanelError(error, t));
    } finally {
      setDownloading(false);
    }
  };
  const data = summary.data;
  return <SectionCard title={t.sales.consumerSalesTitle} data-testid="consumer-sales-card">
    <Stack spacing={2}>
      <Typography>{t.sales.consumerSalesHint}</Typography>
      <Typography variant="caption">{t.salesLinks.timezone}: {SALES_LINK_TIME_ZONE}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField type="date" label={t.sales.consumerSalesFrom} value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField type="date" label={t.sales.consumerSalesTo} value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        <Button disabled={!valid || summary.isPending || summary.isError || downloading} onClick={() => void download()}>{t.sales.consumerSalesDownload}</Button>
      </Stack>
      {!valid ? <Alert severity="error">{t.coupons.invalidDateRange}</Alert> : summary.isPending ? <StatusView state={{ kind: 'loading', label: t.sales.loading }} /> : summary.isError ? <StatusView state={{ kind: 'error', message: localizePanelError(summary.error, t), retry: { label: t.common.retry, onRetry: () => void summary.refetch() } }} /> : null}
      {valid && data !== undefined ? <ResponsiveTable><Table aria-label={t.sales.consumerSalesTitle}>
        <TableHead><TableRow>{[t.sales.consumerSalesRate, t.sales.consumerSalesOrders, t.sales.consumerSalesLines, t.sales.consumerSalesNet, t.sales.consumerSalesVat, t.sales.consumerSalesGross].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
        <TableBody>{[...data.rates.map((row) => ({ ...row, label: row.rate === 'exempt' ? t.sales.consumerSalesExempt : `${row.rate}%` })), { ...data.totals, label: t.sales.consumerSalesTotal }].map((row) => <TableRow key={row.label}>
          <TableCell>{row.label}</TableCell><TableCell>{row.orderCount}</TableCell><TableCell>{row.lineCount}</TableCell><TableCell>{formatPrice(row.netCents, data.currency, language)}</TableCell><TableCell>{formatPrice(row.vatCents, data.currency, language)}</TableCell><TableCell>{formatPrice(row.grossCents, data.currency, language)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></ResponsiveTable> : null}
      {exportError === null ? null : <Alert severity="error">{exportError}</Alert>}
    </Stack>
  </SectionCard>;
};
