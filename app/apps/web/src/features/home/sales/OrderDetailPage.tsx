import { Chip, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatPrice } from '../../../lib/format.js';

export const OrderDetailPage = ({ orderId }: { orderId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const detail = useQuery(actions.order(orderId));
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
    </PanelPage>
  );
};
