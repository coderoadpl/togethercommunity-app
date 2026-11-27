import { OfferLines } from '../../../components/ui/OfferLines.js';
import { DownloadCopies } from '../downloads/DownloadCopies.js';
import { Alert, AlertTitle, Box, Button, Chip, Link, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  SALES_LINK_TIME_ZONE,
  SHIPX_STATUS_CANCELED,
  capabilitiesForPrincipal,
  isActiveStaffRefundStatus,
  orderFulfilmentDisplay,
  orderLabel,
  orderLineLabel,
  staffRefundPreviewReadable,
  type OrderLine,
  type ParcelTemplate,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizeInvoiceError, localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatPrice } from '../../../lib/format.js';
import { OrderDetailValue } from '../../../theme.js';
import { usePanelContext } from '../panel-context.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { OrderMemberIdentity } from './OrderMemberIdentity.js';
import { OrderShipment } from './OrderShipment.js';
import { OrderRefundJob, RefundStatusChip } from './OrderRefundJob.js';
import { OrderCancelledChip } from './OrderCancelledChip.js';
import { OrderShipx } from './OrderShipx.js';
import { OrderPersonalization } from './OrderPersonalization.js';
import { OffPackingListNote, OrderPaymentCard, OrderStaffRefundHistory, type RefundActionState } from './OrderStaffRefunds.js';
import { StaffRefundDialog, newRefundRequestKey } from './StaffRefundDialog.js';

const columnSx = { display: { xs: 'contents', lg: 'flex' }, flexDirection: 'column', gap: '1.5rem', minWidth: 0 } as const;

const Slot = ({ order, children }: { order: number; children: ReactNode }) => (
  <Box sx={{ order: { xs: order, lg: 0 }, minWidth: 0 }}>{children}</Box>
);

const saveLabel = (file: { filename: string; contentType: string; bytes: Uint8Array }) => {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(file.bytes)], { type: file.contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const OrderDetailPage = ({ orderId }: { orderId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { tenant, emailVerified, impersonating = false } = usePanelContext();
  const theme = useTheme();
  const detailsInRail = useMediaQuery(theme.breakpoints.only('lg'), { noSsr: true });
  const queryClient = useQueryClient();
  const canWriteInvoice = tenant.staffRole === 'owner' || tenant.staffRole === 'admin';
  const detail = useQuery(actions.order(orderId));
  const issueInvoice = useMutation({
    ...actions.issueInvoice,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });
  const sendInvoice = useMutation({
    ...actions.sendInvoice,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });
  const shipOrder = useMutation({
    ...actions.shipOrder,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });
  const canShip = capabilitiesForPrincipal(tenant.staffRole ?? 'member').includes('order:write');
  const canRefund = tenant.staffRole !== null && capabilitiesForPrincipal(tenant.staffRole).includes('order:refund') && emailVerified && !impersonating;
  const refundPreviewShown = canRefund && detail.data !== undefined && staffRefundPreviewReadable(detail.data.order);
  const refundPreview = useQuery({ ...actions.orderRefundPreview(orderId), enabled: refundPreviewShown });
  const [refundDialog, setRefundDialog] = useState({ open: false, requestKey: '' });
  const shipAnyway = useMutation({
    ...actions.shipOrderAnyway,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });
  const correctPersonalization = useMutation({
    ...actions.correctOrderPersonalization,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });
  const inpostOrder = detail.data?.order.shipping?.carrier === 'inpost';
  const shipx = useQuery({ ...actions[canShip ? 'shipxRefreshedShipment' : 'shipxShipment'](orderId), enabled: inpostOrder });
  const shipxShipment = shipx.data?.shipment;
  const queriedLabel = orderLabel(shipxShipment);
  const detailLabel = detail.data?.order.label;
  const discoveredTracking = detail.data !== undefined && detailLabel == null ? queriedLabel?.trackingNumber : undefined;
  const lastInvalidatedLabel = useRef<string | null>(null);
  useEffect(() => {
    if (discoveredTracking === undefined) return;
    const labelKey = `${orderId}:${discoveredTracking}`;
    if (lastInvalidatedLabel.current === labelKey) return;
    lastInvalidatedLabel.current = labelKey;
    void queryClient.invalidateQueries(actions.ordersInvalidates('list'));
  }, [discoveredTracking, orderId, queryClient]);
  const createShipment = useMutation({
    ...actions.shipxCreate,
    onSettled: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });
  const createShipmentWith = (parcelTemplate: ParcelTemplate | undefined, markShipped = false) => {
    createShipment.mutate({ orderId, markShipped, ...(parcelTemplate === undefined ? {} : { parcelTemplate }) });
  };
  const recreateTemplate = useRef<ParcelTemplate | undefined>(undefined);
  const discardShipment = useMutation({
    ...actions.shipxDiscard,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.shipxShipmentInvalidates(orderId));
      createShipmentWith(recreateTemplate.current);
    },
  });
  const downloadLabel = useMutation({
    ...actions.shipxLabel,
    onSuccess: (file) => {
      saveLabel(file);
    },
  });
  const refreshInvoice = useMutation({
    ...actions.refreshInvoice,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });
  const statusLabels = {
    paid: t.sales.paid,
    pending: t.sales.pending,
    failed: t.sales.failed,
    refunded: t.sales.refunded,
    partially_refunded: t.sales.partially_refunded,
  };

  if (detail.isPending) {
    return <PanelPage title={t.sections.sales} state={{ kind: 'loading', label: t.sales.loading }} />;
  }
  if (detail.isError) {
    return (
      <PanelPage
        title={t.sections.sales}
        state={{ kind: 'error', message: localizePanelError(detail.error, t), retry: { label: t.common.retry, onRetry: () => void detail.refetch() } }}
      />
    );
  }

  const order = { ...detail.data.order, label: shipxShipment?.status === SHIPX_STATUS_CANCELED ? null : queriedLabel ?? detailLabel };
  const fulfilmentDisplay = orderFulfilmentDisplay(order);
  const attributionRows = [
    [t.sales.utmSource, order.attribution?.utmSource],
    [t.sales.utmMedium, order.attribution?.utmMedium],
    [t.sales.utmCampaign, order.attribution?.utmCampaign],
    [t.sales.utmContent, order.attribution?.utmContent],
    [t.sales.utmTerm, order.attribution?.utmTerm],
    [t.sales.fbclid, order.attribution?.fbclid],
    [t.sales.gclid, order.attribution?.gclid],
  ].filter(([, value]) => value !== undefined);
  const paidAt = order.paidAt ?? (order.status === 'paid' ? order.createdAt : null);
  const rows: Array<[string, ReactNode]> = [
    [t.sales.placed, formatDateTime(order.createdAt, language, SALES_LINK_TIME_ZONE)],
    [t.sales.paid, paidAt === null ? '—' : formatDateTime(paidAt, language, SALES_LINK_TIME_ZONE)],
    [t.sales.member, <OrderMemberIdentity order={order} />],
    [t.sales.product, order.productTitle],
    [t.salesLinks.salesLink, order.salesLinkTitle ?? order.salesLinkId ?? '—'],
    [t.sales.kind, order.kind === 'one_time' ? t.sales.oneTime : t.sales.recurring],
    [t.sales.coupon, order.couponCode ?? '—'],
    [t.sales.provider, order.provider],
  ];

  const linePersonalization = (line: OrderLine) => line.personalization === undefined ? null : (
    <OrderPersonalization
      personalization={line.personalization}
      testId={`order-personalization-${line.productId}`}
      canCorrect={canShip}
      pending={correctPersonalization.isPending && correctPersonalization.variables.productId === line.productId}
      error={correctPersonalization.isError && correctPersonalization.variables.productId === line.productId ? localizePanelError(correctPersonalization.error, t) : null}
      onCorrect={(text, done) => correctPersonalization.mutate({ orderId: order.id, productId: line.productId, text }, { onSuccess: done })}
    />
  );

  const staffRefunds = detail.data.staffRefunds;
  const latestStaffRefund = staffRefunds[0];
  const activeStaffRefund = latestStaffRefund !== undefined && isActiveStaffRefundStatus(latestStaffRefund.status) ? latestStaffRefund : null;
  const offPackingRefund = order.shipping != null && order.fulfilmentStatus == null && order.cancelReason == null
    ? staffRefunds.find((refund) => refund.removedFromPackingList) ?? null
    : null;
  const refundAction: RefundActionState = !refundPreviewShown
    ? { kind: 'hidden' }
    : refundPreview.isPending
      ? { kind: 'loading' }
      : refundPreview.isError
        ? { kind: 'error', message: localizePanelError(refundPreview.error, t) }
        : { kind: 'ready', preview: refundPreview.data };
  const paymentChips = (
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.5rem' }} data-testid="order-status-chips">
      <Chip size="small" label={statusLabels[order.status]} color={order.status === 'paid' ? 'success' : 'default'} />
      {order.mode === 'test' ? <Chip size="small" label={t.sales.testChip} /> : null}
      <OrderCancelledChip cancelReason={order.cancelReason} refundJobStatus={detail.data.refundJob?.status} />
      {activeStaffRefund === null ? null : (
        <RefundStatusChip
          status={activeStaffRefund.status}
          label={t.sales.staffRefund.stateChip({ state: t.sales.staffRefund.states[activeStaffRefund.status] })}
          data-testid="order-staff-refund-chip"
        />
      )}
    </Stack>
  );
  const fulfilmentChip = fulfilmentDisplay == null
    ? offPackingRefund === null ? undefined : <Chip size="small" variant="outlined" label={t.sales.staffRefund.offPackingChip} data-testid="order-off-packing-chip" />
    : (
      <Chip size="small" color={fulfilmentDisplay === 'to_pack' ? 'warning' : fulfilmentDisplay === 'label_ready' ? 'info' : 'success'}
        label={t.shipping.fulfilmentStatuses[fulfilmentDisplay]} data-testid={`order-${fulfilmentDisplay.replace('_', '-')}`} />
    );
  const preview = refundAction.kind === 'ready' ? refundAction.preview : null;
  const detailsCard = (
    <Slot order={6}>
      <SectionCard title={t.sales.orderDetailsHeading}>
        <Stack useFlexGap spacing="0.75rem">
          {rows.map(([label, value]) => (
            <Stack
              key={label}
              direction={{ xs: 'column', sm: 'row' }}
              useFlexGap
              spacing="0.5rem"
              sx={{ justifyContent: 'space-between' }}
            >
              <Typography color="textSecondary">{label}</Typography>
              <OrderDetailValue component="div">{value}</OrderDetailValue>
            </Stack>
          ))}
        </Stack>
      </SectionCard>
    </Slot>
  );

  return (
    <PanelPage
      title={t.sales.orderTitle({ id: order.id })}
      width="detail"
      action={<Button href={`/panel/orders/verify/${encodeURIComponent(order.verificationToken ?? order.id)}`} variant="outlined">{t.orderVerification.title}</Button>}
      backTo={<PanelBackLink to="/panel/sales">{t.sales.allOrders}</PanelBackLink>}
    >
      <Box
        data-testid="order-detail-layout"
        sx={{
          display: { xs: 'flex', lg: 'grid' },
          flexDirection: 'column',
          gap: '1.5rem',
          alignItems: { lg: 'start' },
          gridTemplateColumns: { lg: 'minmax(0, 1fr) 24rem', xl: 'minmax(0, 3fr) minmax(0, 2fr) 26rem' },
        }}
      >
        <Box sx={{ ...columnSx, display: { xs: 'contents', lg: 'flex', xl: 'contents' } }}>
          <Box sx={columnSx}>
            {order.lines === undefined || order.lines.length === 0 ? null : (
              <Slot order={2}><SectionCard title={t.salesLinks.products}><OfferLines lines={order.lines} currency={order.currency} lineName={orderLineLabel} afterName={linePersonalization} /></SectionCard></Slot>
            )}
            {staffRefunds.length === 0 ? null : <Slot order={3}><OrderStaffRefundHistory refunds={staffRefunds} order={order} /></Slot>}
            {detail.data.refundJob === null ? null : <Slot order={4}><OrderRefundJob job={detail.data.refundJob} /></Slot>}
            <Slot order={8}><DownloadCopies query={{ orderId }} /></Slot>
          </Box>
          <Box sx={columnSx}>
            {detailsInRail ? null : detailsCard}
            {attributionRows.length === 0 ? null : (
              <Slot order={7}>
                <SectionCard title={t.sales.source}>
                  <Stack useFlexGap spacing="0.75rem">
                    {order.attribution?.utmSource && order.attribution.utmMedium ? (
                      <Typography>{order.attribution.utmSource} / {order.attribution.utmMedium}</Typography>
                    ) : null}
                    {attributionRows.map(([label, value]) => (
                      <Stack key={label} direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem" sx={{ justifyContent: 'space-between' }}>
                        <Typography color="textSecondary">{label}</Typography>
                        <Typography sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </SectionCard>
              </Slot>
            )}
            {order.billing == null ? null : (
              <Slot order={9}>
                <SectionCard title={t.sales.billingDetails}>
                  <Stack useFlexGap spacing="0.25rem">
                    <Typography>{order.billing.companyName}</Typography>
                    <Typography>{order.billing.nip ?? ''}</Typography>
                    <Typography>{order.billing.address}</Typography>
                    <Typography>
                      {order.billing.postalCode} {order.billing.city}, {order.billing.country}
                    </Typography>
                  </Stack>
                </SectionCard>
              </Slot>
            )}
            <Slot order={10}>
              <SectionCard title={t.sales.invoiceStatus}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  useFlexGap
                  spacing="0.75rem"
                  sx={{ alignItems: 'flex-start' }}
                >
                  {detail.data.invoice !== null && order.mode === 'test' ? <Chip size="small" label={t.sales.testChip} /> : null}
                  {detail.data.invoice === null ? null : (
                    <Chip
                      size="small"
                      label={t.sales.invoiceStatuses[detail.data.invoice.status]}
                      color={detail.data.invoice.status === 'failed' || detail.data.invoice.status === 'conflict'
                        ? 'error'
                        : 'default'}
                    />
                  )}
                  {detail.data.invoice?.provider === 'ksef' && detail.data.invoice.ksef !== null
                    && detail.data.invoice.ksef !== undefined ? (
                      <Stack useFlexGap spacing="0.35rem">
                        <Typography variant="body2">
                          {t.sales.ksefStates[detail.data.invoice.ksef.state]}
                        </Typography>
                        {detail.data.invoice.ksef.ksefNumber === null ? null : (
                          <Typography variant="body2">
                            {t.sales.ksefNumber}: {detail.data.invoice.ksef.ksefNumber}
                          </Typography>
                        )}
                        {detail.data.invoice.ksef.state === 'numbering_conflict' ? (
                          <Typography color="error" variant="body2">
                            {t.sales.ksefConflictHelp}
                          </Typography>
                        ) : null}
                      </Stack>
                    ) : null}
                  {detail.data.invoice?.provider === 'ksef'
                    && detail.data.invoice.ksef?.ksefNumber !== null
                    && detail.data.invoice.ksef?.ksefNumber !== undefined ? (
                      <Link
                        href={`/api/invoices/${encodeURIComponent(detail.data.invoice.id)}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.sales.ksefPdfDownload}
                      </Link>
                    ) : null}
                  {detail.data.invoice?.provider === 'ksef'
                    && detail.data.invoice.ksef?.upoArtifactKey != null ? (
                      <Link
                        href={`/api/invoices/${encodeURIComponent(detail.data.invoice.id)}/upo`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.sales.ksefUpoDownload}
                      </Link>
                    ) : null}
                  {detail.data.invoice?.provider !== 'ksef'
                    && detail.data.invoice?.providerInvoiceId != null ? (
                      <Link
                        href={`/api/invoices/${encodeURIComponent(detail.data.invoice.id)}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.sales.invoiceDownload}
                      </Link>
                    ) : null}
                  {detail.data.invoice?.provider !== 'ksef'
                    && detail.data.invoice?.providerInvoiceId != null ? (
                      <Button
                        variant="outlined"
                        disabled={refreshInvoice.isPending}
                        onClick={() => refreshInvoice.mutate(detail.data.invoice?.id ?? '')}
                      >
                        {refreshInvoice.isPending ? t.sales.refreshingInvoice : t.sales.refreshInvoice}
                      </Button>
                    ) : null}
                  {canWriteInvoice && detail.data.invoice?.ksef?.state === 'held' ? (
                    <Button variant="contained" disabled={sendInvoice.isPending}
                      onClick={() => sendInvoice.mutate(order.id)}>
                      {t.sales.sendToKsef}
                    </Button>
                  ) : null}
                  {canWriteInvoice && order.billing != null && (detail.data.invoice === null || detail.data.invoice.status === 'failed') ? (
                    <Button
                      variant="contained"
                      disabled={issueInvoice.isPending}
                      onClick={() => issueInvoice.mutate(order.id)}
                    >
                      {issueInvoice.isPending ? t.sales.issuingInvoice : t.sales.issueInvoice}
                    </Button>
                  ) : null}
                </Stack>
                {sendInvoice.isError ? <Alert severity="error">{localizeInvoiceError(sendInvoice.error, t)}</Alert> : null}
                {issueInvoice.isError ? <Alert severity="error">{localizeInvoiceError(issueInvoice.error, t)}</Alert> : null}
                {refreshInvoice.isError ? <Alert severity="error">{localizePanelError(refreshInvoice.error, t)}</Alert> : null}
              </SectionCard>
            </Slot>
          </Box>
        </Box>
        <Box sx={columnSx}>
          <Slot order={1}>
            <OrderPaymentCard
              order={order}
              totals={detail.data.refundTotals}
              soldOutRefund={detail.data.refundJob}
              staffRefunds={staffRefunds}
              chips={paymentChips}
              action={refundAction}
              onRefund={() => setRefundDialog({ open: true, requestKey: newRefundRequestKey() })}
            />
          </Slot>
          {order.shipping == null ? null : (
            <Slot order={5}>
              <SectionCard title={t.shipping.orderDeliveryHeading} headerActions={fulfilmentChip} data-testid="order-delivery">
                <Stack useFlexGap spacing="0.75rem">
                  {[
                    { label: t.shipping.orderRate, value: order.shipping.label, stacked: false },
                    { label: t.shipping.orderPrice, value: formatPrice(order.shipping.amountCents, order.currency, language), stacked: false },
                    ...(order.shipping.pickupPoint === null ? [] : [{ label: t.shipping.orderPickupPoint, value: [order.shipping.pickupPoint.code, order.shipping.pickupPoint.name, order.shipping.pickupPoint.address].filter((value) => value !== null && value !== '').join(', '), stacked: true }]),
                    { label: t.shipping.orderAddress, value: [
                      order.shipping.address.name,
                      [order.shipping.address.line1, order.shipping.address.line2].filter((value) => value !== null && value !== '').join(', '),
                      `${order.shipping.address.postalCode} ${order.shipping.address.city}`.trim(),
                      order.shipping.address.country,
                    ].filter((value) => value !== '').join(', '), stacked: true },
                    { label: t.shipping.orderPhone, value: order.shipping.phone ?? '—', stacked: false },
                  ].map(({ label, value, stacked }) => (
                    <Stack key={label} direction={stacked ? 'column' : { xs: 'column', sm: 'row' }} useFlexGap spacing={stacked ? '0.25rem' : '0.5rem'} sx={{ justifyContent: 'space-between' }}>
                      <Typography color="textSecondary">{label}</Typography>
                      <Typography sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
                    </Stack>
                  ))}
                  {order.shipping.pickupPoint?.verified === false ? (
                    <Alert severity="warning" data-testid="order-locker-unverified">
                      <AlertTitle>{t.shipping.orderLockerUnverified}</AlertTitle>
                      {t.shipping.orderLockerUnverifiedHint}
                    </Alert>
                  ) : null}
                  <OrderShipx
                    order={order}
                    view={shipx.data}
                    canCreate={canShip}
                    pending={createShipment.isPending}
                    error={createShipment.error ?? discardShipment.error ?? downloadLabel.error}
                    discarding={discardShipment.isPending}
                    downloading={downloadLabel.isPending}
                    onCreate={(parcelTemplate, markShipped) => {
                      downloadLabel.reset();
                      discardShipment.reset();
                      createShipmentWith(parcelTemplate, markShipped);
                    }}
                    onDiscard={(parcelTemplate) => {
                      createShipment.reset();
                      downloadLabel.reset();
                      recreateTemplate.current = parcelTemplate;
                      discardShipment.mutate(order.id);
                    }}
                    onDownloadLabel={() => {
                      createShipment.reset();
                      downloadLabel.mutate(order.id);
                    }}
                  />
                  <OrderShipment
                    order={order}
                    canShip={canShip}
                    pending={shipOrder.isPending}
                    error={shipOrder.isError ? localizePanelError(shipOrder.error, t) : null}
                    onShip={(input) => shipOrder.mutate({ orderId: order.id, ...input })}
                  />
                  {offPackingRefund === null ? null : (
                    <OffPackingListNote
                      restocked={offPackingRefund.restocked}
                      canShip={canRefund}
                      pending={shipAnyway.isPending}
                      error={shipAnyway.isError ? localizePanelError(shipAnyway.error, t) : null}
                      onShipAnyway={() => shipAnyway.mutate(order.id)}
                    />
                  )}
                </Stack>
              </SectionCard>
            </Slot>
          )}
          {detailsInRail ? detailsCard : null}
        </Box>
      </Box>
      {preview === null || refundDialog.requestKey === '' ? null : (
        <StaffRefundDialog
          key={refundDialog.requestKey}
          open={refundDialog.open}
          order={order}
          preview={preview}
          requestKey={refundDialog.requestKey}
          onClose={() => setRefundDialog((current) => ({ ...current, open: false }))}
        />
      )}
    </PanelPage>
  );
};
