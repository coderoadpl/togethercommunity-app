import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  InputLabel,
  Link as MuiLink,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { OrderExportFormat, OrderStatus, PriceKind } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, ResponsiveTable, StatusView } from '../../../components/layout/index.js';
import { SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatPrice } from '../../../lib/format.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const SalesPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const products = useQuery(actions.products);
  const coupons = useQuery(actions.couponOptions);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [productId, setProductId] = useState('all');
  const [kind, setKind] = useState<PriceKind | 'all'>('all');
  const [couponId, setCouponId] = useState('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState<OrderExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const filters = {
    ...(status === 'all' ? {} : { status }),
    ...(productId === 'all' ? {} : { productId }),
    ...(kind === 'all' ? {} : { kind }),
    ...(couponId === 'all' ? {} : { couponId }),
    ...(debouncedSearch.length === 0 ? {} : { search: debouncedSearch }),
  };
  const orders = useQuery(actions.orders({ ...filters, page: page + 1, pageSize }));
  const reconciliation = useQuery(actions.orderReconciliation);

  const resetPage = () => setPage(0);
  const download = async (format: OrderExportFormat) => {
    setExporting(format);
    setExportError(null);
    try {
      const file = await queryClient.fetchQuery(actions.ordersExport({ format, ...filters }));
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(localizeError(error, t));
    } finally {
      setExporting(null);
    }
  };

  const statusLabels = {
    paid: t.sales.paid,
    pending: t.sales.pending,
    failed: t.sales.failed,
    refunded: t.sales.refunded,
  } as const;

  const statusColors = {
    paid: 'success',
    pending: 'warning',
    failed: 'error',
    refunded: 'default',
  } as const;

  return (
    <PanelPage title={t.sections.sales}>
      {reconciliation.data !== undefined && reconciliation.data.rows.length > 0 ? (
        <Alert severity="warning" data-testid="order-reconciliation">
          <Typography variant="subtitle2">{t.sales.reconciliationHeading}</Typography>
          <Typography variant="body2">{t.sales.reconciliationHint}</Typography>
          {reconciliation.data.rows.map((row) => (
            <Typography key={row.orderId} variant="body2">
              {row.orderId.slice(0, 8)} · {row.memberEmail} · {row.productTitle} ·{' '}
              {formatPrice(row.amountCents, row.currency, language)} ·{' '}
              {t.sales.reconciliationAge({ date: formatDateTime(row.createdAt, language) })} ·{' '}
              {JSON.stringify(row.providerObjectIds)}
            </Typography>
          ))}
        </Alert>
      ) : null}
      <ListSection
        data-testid="sales-list"
        toolbar={{
          search: (
            <SearchField
              value={search}
              onChange={(value) => {
                setSearch(value);
                resetPage();
              }}
              placeholder={t.sales.searchPlaceholder}
              testId="sales-search"
            />
          ),
          filters: (
            <Stack direction={{ xs: 'column', md: 'row' }} useFlexGap spacing="0.5rem">
              <FormControl size="small" sx={{ minWidth: '8rem' }}>
                <InputLabel id="sales-status-label">{t.sales.status}</InputLabel>
                <Select
                  labelId="sales-status-label"
                  label={t.sales.status}
                  value={status}
                  onChange={(event) => {
                    const value = event.target.value;
                    setStatus(value === 'paid' || value === 'pending' || value === 'failed' || value === 'refunded' ? value : 'all');
                    resetPage();
                  }}
                  data-testid="sales-status-filter"
                >
                  <MenuItem value="all">{t.sales.all}</MenuItem>
                  <MenuItem value="paid">{t.sales.paid}</MenuItem>
                  <MenuItem value="pending">{t.sales.pending}</MenuItem>
                  <MenuItem value="failed">{t.sales.failed}</MenuItem>
                  <MenuItem value="refunded">{t.sales.refunded}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: '9rem' }}>
                <InputLabel id="sales-coupon-label">{t.sales.coupon}</InputLabel>
                <Select
                  labelId="sales-coupon-label"
                  label={t.sales.coupon}
                  value={couponId}
                  onChange={(event) => {
                    setCouponId(event.target.value);
                    resetPage();
                  }}
                  data-testid="sales-coupon-filter"
                >
                  <MenuItem value="all">{t.sales.all}</MenuItem>
                  {(coupons.data?.coupons ?? []).map((coupon) => (
                    <MenuItem key={coupon.id} value={coupon.id}>
                      {coupon.code}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: '9rem' }}>
                <InputLabel id="sales-product-label">{t.sales.product}</InputLabel>
                <Select
                  labelId="sales-product-label"
                  label={t.sales.product}
                  value={productId}
                  onChange={(event) => {
                    setProductId(event.target.value);
                    resetPage();
                  }}
                  data-testid="sales-product-filter"
                >
                  <MenuItem value="all">{t.sales.all}</MenuItem>
                  {(products.data?.products ?? []).map((product) => (
                    <MenuItem key={product.id} value={product.id}>{product.title}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: '8rem' }}>
                <InputLabel id="sales-kind-label">{t.sales.kind}</InputLabel>
                <Select
                  labelId="sales-kind-label"
                  label={t.sales.kind}
                  value={kind}
                  onChange={(event) => {
                    const value = event.target.value;
                    setKind(value === 'one_time' || value === 'recurring' ? value : 'all');
                    resetPage();
                  }}
                  data-testid="sales-kind-filter"
                >
                  <MenuItem value="all">{t.sales.all}</MenuItem>
                  <MenuItem value="one_time">{t.sales.oneTime}</MenuItem>
                  <MenuItem value="recurring">{t.sales.recurring}</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          ),
          actions: (
            <Stack direction="row" useFlexGap spacing="0.5rem">
              <Button variant="outlined" disabled={exporting !== null} onClick={() => void download('csv')} data-testid="sales-export-csv">
                {exporting === 'csv' ? t.sales.exporting : t.sales.exportCsv}
              </Button>
              <Button variant="outlined" disabled={exporting !== null} onClick={() => void download('json')} data-testid="sales-export-json">
                {exporting === 'json' ? t.sales.exporting : t.sales.exportJson}
              </Button>
            </Stack>
          ),
        }}
        pagination={
          orders.isSuccess && orders.data.total > 0 ? (
            <TablePagination
              component="div"
              count={orders.data.total}
              page={page}
              rowsPerPage={pageSize}
              rowsPerPageOptions={PAGE_SIZE_OPTIONS}
              onPageChange={(_event, nextPage) => setPage(nextPage)}
              onRowsPerPageChange={(event) => {
                setPageSize(Number.parseInt(event.target.value, 10));
                setPage(0);
              }}
              labelRowsPerPage={t.pagination.rowsPerPage}
              labelDisplayedRows={({ from, to, count }) => t.pagination.displayedRows({ from, to, count })}
            />
          ) : undefined
        }
        isEmpty={orders.isSuccess && orders.data.total === 0 && status === 'all' && productId === 'all' && kind === 'all' && couponId === 'all' && debouncedSearch.length === 0}
        empty={
          <StatusView
            state={{
              kind: 'empty',
              title: t.sales.empty,
              body: t.sales.emptyBody,
              action: <Button component={Link} to="/panel/products">{t.sales.checkoutLinks}</Button>,
            }}
          />
        }
        noMatches={orders.isSuccess && orders.data.total === 0 ? <Typography>{t.sales.noMatches}</Typography> : undefined}
      >
        {orders.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.sales.loading }} />
        ) : orders.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(orders.error, t) }} />
        ) : (
          <ResponsiveTable>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t.sales.date}</TableCell>
                  <TableCell>{t.sales.member}</TableCell>
                  <TableCell>{t.sales.product}</TableCell>
                  <TableCell>{t.sales.kind}</TableCell>
                  <TableCell>{t.sales.amount}</TableCell>
                  <TableCell>{t.sales.coupon}</TableCell>
                  <TableCell>{t.sales.status}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.data.orders.map((order) => (
                  <TableRow key={order.id} data-testid="sales-row">
                    <TableCell>
                      <MuiLink href={`/panel/sales/${order.id}`}>
                        {formatDateTime(order.createdAt, language)}
                      </MuiLink>
                    </TableCell>
                    <TableCell>{order.memberName ?? order.memberEmail}</TableCell>
                    <TableCell>{order.productTitle}</TableCell>
                    <TableCell>{order.kind === 'one_time' ? t.sales.oneTime : t.sales.recurring}</TableCell>
                    <TableCell>{formatPrice(order.amountCents, order.currency, language)}</TableCell>
                    <TableCell>{order.couponCode ?? '—'}</TableCell>
                    <TableCell><Chip size="small" color={statusColors[order.status]} label={statusLabels[order.status]} /></TableCell>
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
