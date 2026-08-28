import { Alert, Button, Chip, Link, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatPrice } from '../../../lib/format.js';
import { PanelBackLink } from '../PanelBackLink.js';

export const OrderDetailPage = ({ orderId }: { orderId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const detail = useQuery(actions.order(orderId));
  const issueInvoice = useMutation({
    ...actions.issueInvoice,
    onSuccess: () => {
      void detail.refetch();
    },
  });
  const refreshInvoice = useMutation({
    ...actions.refreshInvoice,
    onSuccess: () => {
      void detail.refetch();
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

  const order = detail.data.order;
  const rows = [
    [t.sales.date, formatDateTime(order.createdAt, language)],
    [t.sales.member, order.memberName ?? order.memberEmail],
    [t.sales.product, order.productTitle],
    [t.sales.kind, order.kind === 'one_time' ? t.sales.oneTime : t.sales.recurring],
    [t.sales.amount, formatPrice(order.amountCents, order.currency, language)],
    [t.sales.coupon, order.couponCode ?? '—'],
    [t.sales.discount, formatPrice(order.discountCents, order.currency, language)],
    [t.sales.provider, order.provider],
  ];

  return (
    <PanelPage
      title={t.sales.orderTitle({ id: order.id })}
      backTo={<PanelBackLink to="/panel/sales">{t.sales.allOrders}</PanelBackLink>}
    >
      <SectionCard title={t.sales.orderTitle({ id: order.id })}>
        <Stack useFlexGap spacing="0.75rem">
          {rows.map(([label, value]) => (
            <Stack
              key={label}
              direction={{ xs: 'column', sm: 'row' }}
              useFlexGap
              spacing="0.5rem"
              sx={{ justifyContent: 'space-between' }}
            >
              <Typography color="text.secondary">{label}</Typography>
              <Typography>{value}</Typography>
            </Stack>
          ))}
          <Stack direction="row" useFlexGap spacing="0.5rem">
            <Typography color="text.secondary">{t.sales.status}</Typography>
            <Chip size="small" label={statusLabels[order.status]} />
          </Stack>
        </Stack>
      </SectionCard>
      {order.billing == null ? null : (
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
      )}
      <SectionCard title={t.sales.invoiceStatus}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          spacing="0.75rem"
          sx={{ alignItems: 'flex-start' }}
        >
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
          {order.billing !== null &&
          order.billing !== undefined &&
          (detail.data.invoice === null || detail.data.invoice.status === 'failed') ? (
            <Button
              variant="contained"
              disabled={issueInvoice.isPending}
              onClick={() => issueInvoice.mutate(order.id)}
            >
              {issueInvoice.isPending ? t.sales.issuingInvoice : t.sales.issueInvoice}
            </Button>
          ) : null}
        </Stack>
        {issueInvoice.isError ? <Alert severity="error">{localizePanelError(issueInvoice.error, t)}</Alert> : null}
        {refreshInvoice.isError ? <Alert severity="error">{localizePanelError(refreshInvoice.error, t)}</Alert> : null}
      </SectionCard>
    </PanelPage>
  );
};
