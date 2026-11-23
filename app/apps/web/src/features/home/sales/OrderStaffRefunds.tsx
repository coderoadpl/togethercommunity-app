import { Alert, AlertTitle, Box, Button, Chip, Divider, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { SALES_LINK_TIME_ZONE, type OrderListItem, type OrderRefundTotals, type OrderStaffRefundView, type StaffRefundPreview } from '#core/domain/index.js';

import { SectionCard } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatMinorUnitsPrice } from '../../../lib/format.js';
import { PreLineText, RefundAmountLabel, RefundAmountValue, RefundHistoryAmount, RefundHistoryItem, RefundMutedRow, WrapAnywhereText } from '../../../theme.js';
import { RefundStatusChip } from './OrderRefundJob.js';
import { CheckCircleIcon, ClockIcon, RefundIcon } from './refund-icons.js';

const UNCONFIRMED_STATUSES: readonly OrderStaffRefundView['status'][] = ['pending', 'running', 'submitted', 'blocked_permission', 'unconfirmed'];

const AmountRow = ({ label, children, sub, total = false }: { label: string; children: ReactNode; sub?: string | undefined; total?: boolean }) => (
  <Stack direction="row" useFlexGap spacing="1rem" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
    <RefundAmountLabel total={total}>{label}</RefundAmountLabel>
    <Stack sx={{ alignItems: 'flex-end' }}>
      <RefundAmountValue total={total}>{children}</RefundAmountValue>
      {sub === undefined ? null : <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Stack>
  </Stack>
);

export type RefundActionState =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: StaffRefundPreview };

interface OrderPaymentCardProps {
  order: OrderListItem;
  totals: OrderRefundTotals | null;
  staffRefunds: readonly OrderStaffRefundView[];
  chips: ReactNode;
  action: RefundActionState;
  onRefund: () => void;
}

export const OrderPaymentCard = ({ order, totals, staffRefunds, chips, action, onRefund }: OrderPaymentCardProps) => {
  const t = useTranslations();
  const messages = t.sales.staffRefund;
  const { language } = useLanguage();
  const money = (cents: number) => formatMinorUnitsPrice(cents, order.currency, language);
  const paidCents = totals?.paidCents ?? order.amountCents;
  const refundedCents = totals?.refundedCents ?? (order.status === 'refunded' ? order.amountCents : 0);
  const remainingCents = totals?.remainingCents ?? paidCents - refundedCents;
  const unconfirmedCents = Math.min(
    refundedCents,
    staffRefunds.filter((refund) => UNCONFIRMED_STATUSES.includes(refund.status)).reduce((sum, refund) => sum + refund.amountCents, 0),
  );
  const shippingCents = order.shipping?.amountCents ?? 0;
  const blocked = staffRefunds.some((refund) => refund.status === 'blocked_permission');

  return (
    <SectionCard title={messages.paymentTitle} headerActions={chips} data-testid="order-payment">
      <Stack useFlexGap spacing="0.6rem">
        {refundedCents === 0 ? (
          <>
            <AmountRow label={messages.productsSubtotal}>{money(paidCents - shippingCents + order.discountCents)}</AmountRow>
            {order.shipping == null ? null : <AmountRow label={messages.deliverySubtotal}>{money(shippingCents)}</AmountRow>}
            <AmountRow label={t.sales.discount}>{order.discountCents === 0 ? money(0) : `−${money(order.discountCents)}`}</AmountRow>
            <Divider />
            <AmountRow label={messages.paidTotal} total>{money(paidCents)}</AmountRow>
          </>
        ) : (
          <>
            <AmountRow label={messages.paidTotal}>{money(paidCents)}</AmountRow>
            <AmountRow label={messages.refunded} sub={unconfirmedCents === 0 ? undefined : messages.inProgress({ amount: money(unconfirmedCents) })}>
              {`−${money(refundedCents)}`}
            </AmountRow>
            <Divider />
            <AmountRow label={messages.remaining} total>{money(remainingCents)}</AmountRow>
          </>
        )}
      </Stack>
      {blocked ? (
        <Typography variant="body2" color="warning.main" data-testid="order-payment-not-paid-out">{messages.notPaidOut}</Typography>
      ) : refundedCents > 0 && remainingCents === 0 && unconfirmedCents === 0 ? (
        <RefundMutedRow direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center' }}>
          <CheckCircleIcon />
          <Typography variant="body2">{messages.fullyRefunded}</Typography>
        </RefundMutedRow>
      ) : null}
      {action.kind === 'loading' ? <Typography variant="body2" color="text.secondary">{messages.previewLoading}</Typography> : null}
      {action.kind === 'error' ? <Alert severity="error">{action.message}</Alert> : null}
      {action.kind === 'ready' && action.preview.refundable ? (
        <Button variant="outlined" fullWidth startIcon={<RefundIcon />} onClick={onRefund} data-testid="order-refund">
          {messages.action}
        </Button>
      ) : null}
      {action.kind === 'ready' && !action.preview.refundable && action.preview.waitingRefundId !== null && action.preview.remainderCents > 0 ? (
        <Stack useFlexGap spacing="0.5rem">
          <Button variant="outlined" fullWidth startIcon={<RefundIcon />} disabled aria-describedby="order-refund-waiting" data-testid="order-refund">
            {messages.action}
          </Button>
          <Typography id="order-refund-waiting" variant="body2" color="text.secondary">{messages.waitingBlocksAction}</Typography>
        </Stack>
      ) : null}
    </SectionCard>
  );
};

const RefundItem = ({ refund }: { refund: OrderStaffRefundView }) => {
  const t = useTranslations();
  const messages = t.sales.staffRefund;
  const { language } = useLanguage();
  const time = (value: string) => formatDateTime(value, language, SALES_LINK_TIME_ZONE);
  const waiting = refund.status === 'pending' || refund.status === 'running' || refund.status === 'submitted';
  const blocked = refund.status === 'blocked_permission';
  const facts = [
    refund.status === 'succeeded' ? messages.completedAt({ time: time(refund.updatedAt) }) : null,
    blocked ? [messages.attempts({ count: refund.attempts }), refund.nextAttemptAt === null ? null : messages.nextAttempt({ time: time(refund.nextAttemptAt) })].filter((part) => part !== null).join(' · ') : null,
    refund.restocked ? messages.restocked : null,
    refund.removedFromPackingList ? messages.removedFromPackingList : null,
  ].filter((fact) => fact !== null);

  return (
    <RefundHistoryItem attention={blocked} data-testid={`order-staff-refund-${refund.id}`}>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'baseline', columnGap: '0.75rem', rowGap: '0.25rem' }}>
        <RefundHistoryAmount>{formatMinorUnitsPrice(refund.amountCents, refund.currency, language)}</RefundHistoryAmount>
        <WrapAnywhereText variant="body2" color="text.secondary" sx={{ flex: '1 1 12rem', minWidth: 0 }}>
          {messages.requestedBy({ who: refund.requestedByEmail, time: time(refund.createdAt) })}
        </WrapAnywhereText>
        <RefundStatusChip status={refund.status} label={messages.states[refund.status]} data-testid="order-staff-refund-state" />
      </Stack>
      {refund.note === null ? null : (
        <Box sx={{ mt: '0.5rem' }}>
          <Typography variant="caption" color="text.secondary">{messages.reasonLabel}</Typography>
          <PreLineText variant="body2">{refund.note}</PreLineText>
        </Box>
      )}
      {waiting ? (
        <RefundMutedRow direction="row" useFlexGap spacing="0.35rem" sx={{ mt: '0.5rem', alignItems: 'center' }}>
          <ClockIcon />
          <Typography variant="body2">{messages.waitingForStripe}</Typography>
        </RefundMutedRow>
      ) : null}
      {facts.length === 0 ? null : (
        <Stack direction="row" useFlexGap sx={{ mt: '0.5rem', flexWrap: 'wrap', columnGap: '1rem', rowGap: '0.25rem' }}>
          {facts.map((fact) => <Typography key={fact} variant="body2" color="text.secondary">{fact}</Typography>)}
        </Stack>
      )}
      {blocked ? (
        <Alert severity="warning" sx={{ mt: '0.75rem' }}>
          <AlertTitle>{messages.blockedTitle}</AlertTitle>
          {t.sales.refundJobBlockedHelp}
          <Typography variant="body2" sx={{ mt: '0.5rem' }}>{messages.blockedBuyerEmail}</Typography>
        </Alert>
      ) : null}
      {refund.status === 'failed' ? <Alert severity="error" sx={{ mt: '0.75rem' }}>{messages.failedHelp}</Alert> : null}
      {refund.status === 'unconfirmed' ? <Alert severity="error" sx={{ mt: '0.75rem' }}>{t.sales.refundJobUnconfirmedHelp}</Alert> : null}
    </RefundHistoryItem>
  );
};

export const OrderStaffRefundHistory = ({ refunds }: { refunds: readonly OrderStaffRefundView[] }) => {
  const t = useTranslations();
  const messages = t.sales.staffRefund;
  return (
    <SectionCard
      title={messages.historyTitle}
      headerActions={<Chip size="small" variant="outlined" label={messages.historyCount({ count: refunds.length })} />}
      data-testid="order-staff-refunds"
    >
      <Stack component="ul" useFlexGap spacing="0.75rem" sx={{ m: 0, p: 0 }}>
        {refunds.map((refund) => <RefundItem key={refund.id} refund={refund} />)}
      </Stack>
    </SectionCard>
  );
};

export const OffPackingListNote = ({ restocked, pending, error, canShip, onShipAnyway }: {
  restocked: boolean;
  pending: boolean;
  error: string | null;
  canShip: boolean;
  onShipAnyway: () => void;
}) => {
  const t = useTranslations();
  const messages = t.sales.staffRefund;
  return (
    <Stack useFlexGap spacing="0.75rem" data-testid="order-off-packing-list">
      <Alert severity="success">{restocked ? messages.offPackingRestockedNote : messages.offPackingNote}</Alert>
      {canShip ? (
        <Button variant="outlined" fullWidth disabled={pending} onClick={onShipAnyway} data-testid="order-ship-anyway">
          {pending ? messages.shippingAnyway : messages.shipAnyway}
        </Button>
      ) : null}
      {error === null ? null : <Alert severity="error">{error}</Alert>}
    </Stack>
  );
};
