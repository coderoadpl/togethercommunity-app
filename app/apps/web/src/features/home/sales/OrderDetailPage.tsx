import { Button, Chip, Link, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatPrice } from '../../../lib/format.js';

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
  const statusLabels = {
    paid: t.sales.paid,
    pending: t.sales.pending,
    failed: t.sales.failed,
    refunded: t.sales.refunded,
  };

  if (detail.isPending) {
    return <PanelPage title={t.sections.sales} state={{ kind: 'loading', label: t.sales.loading }} />;
  }
  if (detail.isError) {
    return (
      <PanelPage
        title={t.sections.sales}
        state={{ kind: 'error', message: localizeError(detail.error, t) }}
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
      backTo={{ label: t.sales.allOrders, href: '/panel/sales' }}
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
              color={detail.data.invoice.status === 'failed' ? 'error' : 'default'}
            />
          )}
          {detail.data.invoice?.pdfUrl == null ? null : (
            <Link href={detail.data.invoice.pdfUrl} target="_blank" rel="noreferrer">
              {t.sales.invoiceDownload}
            </Link>
          )}
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
      </SectionCard>
    </PanelPage>
  );
};
