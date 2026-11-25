import { ConsumerSalesCard } from './ConsumerSalesCard.js';
import { OrderCancelledChip } from './OrderCancelledChip.js';
import { OrderBillingState, OrderInvoiceState } from './OrderInvoiceCells.js';
import { OrderMemberIdentity, orderMemberTitle } from './OrderMemberIdentity.js';
import { OrderProductSummary } from './OrderProductSummary.js';
import { RejectedPaymentsSection } from './RejectedPaymentsSection.js';
import { RefundStatusChip } from './OrderRefundJob.js';
import { ChevronIcon } from './refund-icons.js';
import { hasOrderFilters, ORDER_FILTER_KEYS, ORDER_FILTER_VALIDATORS, orderListFilters, validateOrdersSearch, type OrderFilterKey, type OrderFilters, type OrderSort } from './order-filters.js';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Checkbox,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TablePagination,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';

import type { FulfilmentStatus, ListLayout, OrderExportFile, OrderExportFormat, OrderListItem } from '#core/domain/index.js';
import { SALES_LINK_TIME_ZONE } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { GridColumnsDialog } from '../../../components/ui/data-grid/GridColumnsDialog.js';
import { GridFilterBar, type GridFilterChip } from '../../../components/ui/data-grid/GridFilterBar.js';
import { GRID_PAGE_SIZE_OPTIONS, StudioDataGrid, type StudioGridColumn } from '../../../components/ui/data-grid/StudioDataGrid.js';
import { validGridFilters, type GridLayoutSchema } from '../../../components/ui/data-grid/grid-layout.js';
import { useSavedGridLayout } from '../data-grid/use-saved-grid-layout.js';
import { ListSection, PanelPage, StatusView } from '../../../components/layout/index.js';
import { SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeInvoiceError, localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate, formatDateTime, formatPrice, formatTime } from '../../../lib/format.js';
import { SalesCardAmount, SalesCardControl, SalesCardOrderLink, SalesDateLink, SalesDateTime, SalesGridMember, SalesOrderCard, SalesOrderCardList, STUDIO_GRID_CONTROL_CLASS, StudioGridCellStack, StudioGridChipRow, StudioGridEllipsis, StudioGridNoWrap, VisuallyHidden } from '../../../theme.js';
import { usePanelContext } from '../panel-context.js';

const ORDER_COLUMNS = ['date', 'member', 'product', 'kind', 'amount', 'coupon', 'source', 'status', 'fulfilment', 'invoice', 'billing'] as const;
type OrderColumn = (typeof ORDER_COLUMNS)[number];
const NARROW_HIDDEN: readonly OrderColumn[] = ['kind', 'coupon', 'source'];
const SORT_FIELDS = { date: 'createdAt', amount: 'amountCents' } as const;

const ordersLayoutSchema = (narrow: boolean): GridLayoutSchema => ({
  columns: ORDER_COLUMNS.map((field) => ({ field, visible: !(narrow && NARROW_HIDDEN.includes(field)) })),
  sortFields: Object.keys(SORT_FIELDS),
  filters: ORDER_FILTER_VALIDATORS,
});

const orderSort = (layout: ListLayout): OrderSort | null => {
  const sort = layout.sort;
  if (sort === null) return null;
  return sort.field === 'date' || sort.field === 'amount' ? { field: SORT_FIELDS[sort.field], direction: sort.direction } : null;
};

const saveFile = (file: OrderExportFile) => {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const SalesPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { tenant, email, impersonating = false } = usePanelContext();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const narrow = useMediaQuery(theme.breakpoints.down('xl'), { noSsr: true });
  const canWriteInvoice = tenant.staffRole === 'owner' || tenant.staffRole === 'admin';
  const urlSearch = validateOrdersSearch(useSearch({ strict: false }));
  const schema = ordersLayoutSchema(narrow);
  const saved = useSavedGridLayout({ tenantId: tenant.id, viewer: email, listId: 'orders', schema, readOnly: impersonating });
  const layout = saved.layout;
  const [selected, setSelected] = useState<string[]>([]);
  const [sendingSelected, setSendingSelected] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const products = useQuery(actions.products);
  const coupons = useQuery(actions.couponOptions);
  const [search, setSearch] = useState(urlSearch.search ?? '');
  const [packing, setPacking] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState<OrderExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const filters: OrderFilters = hasOrderFilters(urlSearch)
    ? Object.fromEntries(ORDER_FILTER_KEYS.flatMap((key) => (urlSearch[key] === undefined ? [] : [[key, urlSearch[key]]])))
    : validGridFilters(layout.filters, schema);
  const sort = orderSort(layout);
  const listFilters = orderListFilters(filters, debouncedSearch, sort);
  const orders = useQuery({ ...actions.orders({ ...listFilters, page: page + 1, pageSize }), placeholderData: keepPreviousData });
  const reconciliation = useQuery(actions.orderReconciliation);

  const resetPage = () => { setPage(0); setSelected([]); };
  const writeUrl = (nextFilters: OrderFilters, nextSearch: string) => {
    void navigate({
      to: '/panel/sales',
      search: { ...nextFilters, ...(nextSearch.trim().length === 0 ? {} : { search: nextSearch.trim() }) },
      replace: true,
    });
  };
  const changeLayout = (next: ListLayout) => {
    if (orderSort(next)?.field !== sort?.field || orderSort(next)?.direction !== sort?.direction) resetPage();
    saved.change({ ...next, filters });
  };
  const setFilters = (next: OrderFilters) => {
    const clean = validGridFilters(next, schema);
    writeUrl(clean, search);
    saved.change({ ...layout, filters: clean });
    resetPage();
  };
  const setFilter = (key: OrderFilterKey, value: string) => {
    const rest = Object.fromEntries(Object.entries(filters).filter(([candidate]) => candidate !== key));
    setFilters(value === '' ? rest : { ...rest, [key]: value });
  };

  const sendInvoice = useMutation({
    ...actions.sendInvoice,
    onSuccess: async (_invoice, orderId) => {
      setSelected((current) => current.filter((id) => id !== orderId));
      await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });
  const sendSelected = async (orderIds: string[]) => {
    setSendingSelected(true);
    try {
      for (const orderId of orderIds) {
        await sendInvoice.mutateAsync(orderId);
      }
    } catch {
      return;
    } finally {
      setSendingSelected(false);
    }
  };
  const rows = orders.data?.orders ?? [];
  const selectedHeld = rows
    .filter((order) => order.invoice?.ksef?.state === 'held' && selected.includes(order.id))
    .map((order) => order.id);
  const sending = sendInvoice.isPending || sendingSelected;
  const download = async (format: OrderExportFormat) => {
    setExporting(format);
    setExportError(null);
    try {
      saveFile(await queryClient.fetchQuery(actions.ordersExport({ format, ...listFilters })));
    } catch (error) {
      setExportError(localizePanelError(error, t));
    } finally {
      setExporting(null);
    }
  };

  const downloadPackingList = async (fulfilmentStatus: FulfilmentStatus) => {
    setPacking(true);
    setExportError(null);
    try {
      saveFile(await queryClient.fetchQuery(actions.packingList({ format: 'csv', fulfilmentStatus, mode: listFilters.mode ?? 'live' })));
    } catch (error) {
      setExportError(localizePanelError(error, t));
    } finally {
      setPacking(false);
    }
  };

  const statusLabels = {
    paid: t.sales.paid,
    pending: t.sales.pending,
    failed: t.sales.failed,
    refunded: t.sales.refunded,
    partially_refunded: t.sales.partially_refunded,
  } as const;

  const statusColors = {
    paid: 'success',
    pending: 'warning',
    failed: 'error',
    refunded: 'default',
    partially_refunded: 'default',
  } as const;

  const filterLabels: Record<OrderFilterKey, string> = {
    mode: t.sales.mode,
    status: t.sales.status,
    productId: t.sales.product,
    kind: t.sales.kind,
    couponId: t.sales.coupon,
    source: t.sales.source,
    fulfilmentStatus: t.shipping.fulfilmentFilter,
    invoice: t.sales.invoiceColumn,
    billing: t.sales.invoiceData,
  };
  const filterOptions = (key: OrderFilterKey): { value: string; label: string }[] => {
    switch (key) {
      case 'mode': return [{ value: 'live', label: t.integrations.stripeLiveMode }, { value: 'test', label: t.integrations.stripeTestMode }];
      case 'status': return Object.entries(statusLabels).map(([value, label]) => ({ value, label }));
      case 'productId': return (products.data?.products ?? []).map((product) => ({ value: product.id, label: product.title }));
      case 'kind': return [{ value: 'one_time', label: t.sales.oneTime }, { value: 'recurring', label: t.sales.recurring }];
      case 'couponId': return (coupons.data?.coupons ?? []).map((coupon) => ({ value: coupon.id, label: coupon.code }));
      case 'source': return [{ value: 'none', label: t.sales.noSource }, ...(orders.data?.sources ?? []).map((value) => ({ value: `value:${value}`, label: value }))];
      case 'fulfilmentStatus': return [{ value: 'to_pack', label: t.shipping.fulfilmentStatuses.to_pack }, { value: 'shipped', label: t.shipping.fulfilmentStatuses.shipped }];
      case 'invoice': return [{ value: 'with', label: t.sales.invoiceWith }, { value: 'without', label: t.sales.invoiceWithout }];
      case 'billing': return [
        { value: 'requested', label: t.sales.billingRequested },
        { value: 'company', label: t.sales.billings.company },
        { value: 'private', label: t.sales.billings.private },
        { value: 'none', label: t.sales.billings.none },
      ];
    }
  };
  const filterValueLabel = (key: OrderFilterKey, value: string): string =>
    filterOptions(key).find((option) => option.value === value)?.label ?? (key === 'source' && value.startsWith('value:') ? value.slice(6) : value);
  const isFilterKey = (key: string): key is OrderFilterKey => ORDER_FILTER_KEYS.some((candidate) => candidate === key);
  const renderFilters = (keys: readonly string[]) => keys.filter(isFilterKey).map((key) => {
    const value = filters[key] ?? '';
    const options = filterOptions(key);
    const labelId = `sales-filter-${key}-label`;
    return (
      <FormControl key={key} size="small" fullWidth>
        <InputLabel id={labelId} shrink>{filterLabels[key]}</InputLabel>
        <Select labelId={labelId} label={filterLabels[key]} displayEmpty notched value={options.some((option) => option.value === value) || value === '' ? value : ''}
          onChange={(event) => setFilter(key, event.target.value)} data-testid={`sales-filter-${key}`}>
          <MenuItem value="">{key === 'fulfilmentStatus' ? t.shipping.fulfilmentAll : key === 'invoice' ? t.sales.invoiceAny : t.sales.all}</MenuItem>
          {options.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
        </Select>
      </FormControl>
    );
  });
  const chips: GridFilterChip[] = ORDER_FILTER_KEYS.flatMap((key) => {
    const value = filters[key];
    return value === undefined ? [] : [{
      key,
      label: t.dataGrid.filterChip({ label: filterLabels[key], value: filterValueLabel(key, value) }),
      onRemove: () => setFilter(key, ''),
    }];
  });
  const boughtWithInvoice = filters.billing === 'requested';

  const orderLink = (order: OrderListItem) => (
    <SalesDateLink component={Link} to={`/panel/sales/${encodeURIComponent(order.id)}`} aria-label={formatDateTime(order.createdAt, language, SALES_LINK_TIME_ZONE)} data-testid="sales-order-link">
      <StudioGridNoWrap>{formatDate(order.createdAt, language, SALES_LINK_TIME_ZONE)}</StudioGridNoWrap>
      <SalesDateTime>{formatTime(order.createdAt, language, SALES_LINK_TIME_ZONE)}</SalesDateTime>
    </SalesDateLink>
  );
  const orderSource = (order: OrderListItem) => [order.attribution?.utmSource, order.attribution?.utmMedium].filter(Boolean).join(' / ');
  const staffRefundChipLabel = (order: OrderListItem, state: string) => order.staffRefundAmountCents === undefined
    ? t.sales.staffRefund.stateChip({ state })
    : t.sales.staffRefund.listChip({ amount: formatPrice(order.staffRefundAmountCents, order.currency, language), state });
  const statusChips = (order: OrderListItem) => (
    <>
      <Chip size="small" color={statusColors[order.status]} label={statusLabels[order.status]} />
      <OrderCancelledChip cancelReason={order.cancelReason} refundJobStatus={order.refundJobStatus} />
      {order.cancelReason != null || order.staffRefundStatus === undefined ? null : (
        <RefundStatusChip
          status={order.staffRefundStatus}
          label={staffRefundChipLabel(order, t.sales.staffRefund.states[order.staffRefundStatus])}
          data-testid="sales-staff-refund-chip"
        />
      )}
    </>
  );
  const fulfilmentChip = (order: OrderListItem) => order.fulfilmentStatus == null ? null : (
    <Chip size="small" variant="outlined" color={order.fulfilmentStatus === 'to_pack' ? 'warning' : 'success'}
      label={t.shipping.fulfilmentStatuses[order.fulfilmentStatus]} data-testid="sales-fulfilment-chip" />
  );
  const selectBox = (order: OrderListItem) => order.invoice?.ksef?.state === 'held' ? (
    <SalesCardControl data-testid="sales-ksef-control">
      <Checkbox checked={selected.includes(order.id)} disabled={sending}
        slotProps={{ input: { 'aria-label': `${t.sales.sendSelectedToKsef}: ${order.id}` } }}
        onChange={(event) => setSelected((current) => event.target.checked
          ? [...current, order.id] : current.filter((id) => id !== order.id))} />
    </SalesCardControl>
  ) : null;
  const invoiceCell = (order: OrderListItem) => (
    <StudioGridCellStack>
      <OrderInvoiceState order={order} />
      {order.invoice != null && order.mode === 'test' ? <Chip size="small" label={t.sales.testChip} /> : null}
      {canWriteInvoice && order.invoice?.ksef?.state === 'held' ? (
        <SalesCardControl data-testid="sales-ksef-control">
          <Button size="small" disabled={sending} onClick={() => sendInvoice.mutate(order.id)}>
            {t.sales.sendToKsef}
          </Button>
        </SalesCardControl>
      ) : null}
    </StudioGridCellStack>
  );
  const sourceVisible = layout.columns.some((column) => column.field === 'source' && column.visible);

  const columnLabels: Record<OrderColumn, string> = {
    date: t.sales.date,
    member: t.sales.member,
    product: t.sales.product,
    kind: t.sales.kind,
    amount: t.sales.amount,
    coupon: t.sales.coupon,
    source: t.sales.source,
    status: t.sales.status,
    fulfilment: t.shipping.fulfilmentColumn,
    invoice: t.sales.invoiceColumn,
    billing: t.sales.invoiceData,
  };
  const column = (field: OrderColumn, definition: Omit<StudioGridColumn<OrderListItem>, 'field' | 'headerName'>): StudioGridColumn<OrderListItem> =>
    ({ field, headerName: columnLabels[field], sortable: false, ...definition });
  const columns: StudioGridColumn<OrderListItem>[] = [
    column('date', { width: 104, sortable: true, renderCell: ({ row }) => orderLink(row) }),
    column('member', { flex: 1.5, minWidth: 96, maxWidth: 288, renderCell: ({ row }) => (
      <SalesGridMember title={orderMemberTitle(row, t.deletedContent.member)}><OrderMemberIdentity order={row} /></SalesGridMember>
    ) }),
    column('product', { flex: 4, minWidth: 134, filterKeys: ['productId'], renderCell: ({ row }) => (
      <Box sx={{ minWidth: 0, width: '100%' }}>
        <OrderProductSummary order={row} />
        {!sourceVisible && orderSource(row) !== '' ? <Typography variant="caption" color="textSecondary" sx={{ display: 'block' }} data-testid="sales-row-source">{t.sales.source}: {orderSource(row)}</Typography> : null}
      </Box>
    ) }),
    column('kind', { width: 108, filterKeys: ['kind'], renderCell: ({ row }) => <StudioGridNoWrap>{row.kind === 'one_time' ? t.sales.oneTime : t.sales.recurring}</StudioGridNoWrap> }),
    column('amount', { width: 104, sortable: true, filterKeys: ['mode'], renderCell: ({ row }) => <StudioGridNoWrap>{formatPrice(row.amountCents, row.currency, language)}</StudioGridNoWrap> }),
    column('coupon', { flex: 0.6, minWidth: 104, maxWidth: 180, filterKeys: ['couponId'], renderCell: ({ row }) => <StudioGridEllipsis title={row.couponCode ?? undefined} data-testid="sales-row-coupon">{row.couponCode ?? '—'}</StudioGridEllipsis> }),
    column('source', { flex: 0.6, minWidth: 112, maxWidth: 200, filterKeys: ['source'], renderCell: ({ row }) => <StudioGridEllipsis title={orderSource(row) || undefined}>{orderSource(row) || '—'}</StudioGridEllipsis> }),
    column('status', { width: 160, filterKeys: ['status'], renderCell: ({ row }) => <StudioGridChipRow>{statusChips(row)}</StudioGridChipRow> }),
    column('fulfilment', { width: 126, filterKeys: ['fulfilmentStatus'], renderCell: ({ row }) => fulfilmentChip(row) ?? '—' }),
    column('invoice', { flex: 1.5, minWidth: 120, maxWidth: 220, filterKeys: ['invoice'], renderCell: ({ row }) => invoiceCell(row) }),
    column('billing', { flex: 1.2, minWidth: 92, maxWidth: 150, filterKeys: ['billing'], renderCell: ({ row }) => <OrderBillingState order={row} /> }),
  ];
  const leadingColumns: GridColDef<OrderListItem>[] = canWriteInvoice ? [{
    field: '__ksef',
    headerName: t.sales.sendSelectedToKsef,
    width: 44,
    minWidth: 44,
    cellClassName: STUDIO_GRID_CONTROL_CLASS,
    headerClassName: STUDIO_GRID_CONTROL_CLASS,
    sortable: false,
    resizable: false,
    hideable: false,
    disableColumnMenu: true,
    renderHeader: () => <VisuallyHidden>{t.sales.sendSelectedToKsef}</VisuallyHidden>,
    renderCell: ({ row }) => selectBox(row),
  }] : [];

  const filterKeysWithoutMode = ORDER_FILTER_KEYS.filter((key) => key !== 'mode');
  const isEmpty = orders.isSuccess && orders.data.total === 0 && filterKeysWithoutMode.every((key) => filters[key] === undefined) && debouncedSearch.length === 0;
  const fulfilment = filters.fulfilmentStatus === 'to_pack' ? 'to_pack' : null;

  return (
    <PanelPage title={t.sections.sales} width="detail" action={<Button href="/panel/orders/verify" variant="outlined">{t.orderVerification.title}</Button>}>
      {products.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(products.error, t), retry: { label: t.common.retry, onRetry: () => void products.refetch() } }} /> : null}
      {coupons.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(coupons.error, t), retry: { label: t.common.retry, onRetry: () => void coupons.refetch() } }} /> : null}
      {reconciliation.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(reconciliation.error, t), retry: { label: t.common.retry, onRetry: () => void reconciliation.refetch() } }} /> : null}
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
      {canWriteInvoice ? <RejectedPaymentsSection /> : null}
      <ConsumerSalesCard />
      <ListSection
        data-testid="sales-list"
        toolbar={{
          search: (
            <SearchField
              value={search}
              onChange={(value) => {
                setSearch(value);
                writeUrl(filters, value);
                resetPage();
              }}
              label={t.sales.searchPlaceholder}
              placeholder={t.sales.searchPlaceholder}
              testId="sales-search"
            />
          ),
          actions: (
            <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
              {canWriteInvoice ? (
                <Button variant="contained" disabled={sending || selectedHeld.length === 0}
                  onClick={() => void sendSelected(selectedHeld)}>
                  {t.sales.sendSelectedToKsef}
                </Button>
              ) : null}
              {fulfilment === 'to_pack' ? (
                <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button variant="outlined" disabled={packing} onClick={() => void downloadPackingList(fulfilment)} data-testid="sales-packing-list">
                    {packing ? t.shipping.packingListDownloading : t.shipping.packingListDownload}
                  </Button>
                  {listFilters.mode === undefined ? (
                    <Typography variant="caption" color="text.secondary" data-testid="sales-packing-list-live-only">{t.shipping.packingListLiveOnly}</Typography>
                  ) : null}
                </Stack>
              ) : null}
              <Button variant="outlined" disabled={exporting !== null || listFilters.mode === 'test'} onClick={() => void download('csv')} data-testid="sales-export-csv">
                {exporting === 'csv' ? t.sales.exporting : t.sales.exportCsv}
              </Button>
              <Button variant="outlined" disabled={exporting !== null || listFilters.mode === 'test'} onClick={() => void download('json')} data-testid="sales-export-json">
                {exporting === 'json' ? t.sales.exporting : t.sales.exportJson}
              </Button>
            </Stack>
          ),
        }}
        pagination={
          phone && orders.isSuccess && orders.data.total > 0 ? (
            <TablePagination
              component="div"
              sx={{ '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', justifyContent: 'flex-end', px: '0.5rem' }, '& .MuiTablePagination-spacer': { display: 'none' } }}
              count={orders.data.total}
              page={page}
              rowsPerPage={pageSize}
              rowsPerPageOptions={GRID_PAGE_SIZE_OPTIONS}
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
        isEmpty={isEmpty}
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
      >
        <GridFilterBar
          count={orders.isSuccess ? t.sales.orderCount({ count: orders.data.total }) : null}
          chips={chips}
          onClearAll={() => setFilters({})}
          quickActions={(
            <Chip
              label={t.sales.boughtWithInvoice}
              color={boughtWithInvoice ? 'primary' : 'default'}
              variant={boughtWithInvoice ? 'filled' : 'outlined'}
              aria-pressed={boughtWithInvoice}
              onClick={() => setFilter('billing', boughtWithInvoice ? '' : 'requested')}
              data-testid="sales-quick-invoice"
            />
          )}
          renderAllFilters={() => renderFilters(ORDER_FILTER_KEYS)}
          {...(phone ? {} : { onOpenColumns: () => setColumnsOpen(true) })}
        />
        {orders.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.sales.loading }} />
        ) : orders.isError ? (
          <StatusView state={{ kind: 'error', message: localizePanelError(orders.error, t), retry: { label: t.common.retry, onRetry: () => void orders.refetch() } }} />
        ) : orders.data.total === 0 ? (
          <Typography>{t.sales.noMatches}</Typography>
        ) : phone ? (
          <SalesOrderCardList data-testid="sales-cards">
            {orders.data.orders.map((order) => (
              <SalesOrderCard key={order.id} data-testid="sales-row">
                <Stack direction="row" useFlexGap spacing="0.75rem" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <SalesCardControl><OrderMemberIdentity order={order} underline="always" /></SalesCardControl>
                  </Box>
                  <SalesCardAmount>{formatPrice(order.amountCents, order.currency, language)}</SalesCardAmount>
                </Stack>
                <Typography variant="body2" component="div"><OrderProductSummary order={order} /></Typography>
                <SalesCardOrderLink component={Link} to={`/panel/sales/${encodeURIComponent(order.id)}`} variant="body2" underline="none" data-testid="sales-card-order-link">
                  {formatDateTime(order.createdAt, language, SALES_LINK_TIME_ZONE)}
                  <ChevronIcon />
                </SalesCardOrderLink>
                <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.35rem', mt: '0.15rem' }}>
                  {statusChips(order)}
                  {fulfilmentChip(order)}
                </Stack>
                <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  {canWriteInvoice ? selectBox(order) : null}
                  <SalesCardControl>{invoiceCell(order)}</SalesCardControl>
                  <SalesCardControl><OrderBillingState order={order} /></SalesCardControl>
                </Stack>
              </SalesOrderCard>
            ))}
          </SalesOrderCardList>
        ) : (
          <StudioDataGrid
            data-testid="sales-grid"
            rowTestId="sales-row"
            label={t.sections.sales}
            rows={orders.data.orders}
            getRowId={(order) => order.id}
            leadingColumns={leadingColumns}
            columns={columns}
            layout={layout}
            onLayoutChange={changeLayout}
            rowCount={orders.data.total}
            paginationModel={{ page, pageSize }}
            onPaginationModelChange={(model) => {
              if (model.pageSize !== pageSize) { setPageSize(model.pageSize); setPage(0); } else setPage(model.page);
            }}
            loading={orders.isPlaceholderData}
            onOpenColumns={() => setColumnsOpen(true)}
            renderFilters={renderFilters}
          />
        )}
      </ListSection>
      <GridColumnsDialog
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        labels={columnLabels}
        layout={layout}
        onChange={changeLayout}
        onReset={() => { saved.reset(); writeUrl({}, search); resetPage(); }}
      />
      {saved.saveError === null ? null : <Alert severity="warning">{t.dataGrid.layoutSaveFailed({ message: localizePanelError(saved.saveError, t) })}</Alert>}
      {sendInvoice.isError ? <Alert severity="error">{localizeInvoiceError(sendInvoice.error, t)}</Alert> : null}
      {exportError === null ? null : <Alert severity="error">{exportError}</Alert>}
    </PanelPage>
  );
};
