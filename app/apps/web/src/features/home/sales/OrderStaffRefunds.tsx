import { Alert, AlertTitle, Box, Button, Chip, Divider, Link as MuiLink, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import {
  orderRefundPermissionDeadline,
  refundedAmountUnknown,
  SALES_LINK_TIME_ZONE,
  staffRefundReason,
  type OrderListItem,
  type OrderRefundTotals,
  type OrderStaffRefundView,
  type StaffRefundPreview,
} from '#core/domain/index.js';

import { SectionCard } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatMinorUnitsPrice } from '../../../lib/format.js';
import {
  PreLineText,
  RefundAmountLabel,
  RefundAmountValue,
  RefundHistoryAmount,
  RefundHistoryCard,
  RefundHistoryItem,
  RefundMutedRow,
  RefundNote,
  RefundWarningRow,
  WrapAnywhereText,
} from '../../../theme.js';
import { RefundStatusChip } from './OrderRefundJob.js';
import { CheckCircleIcon, ClockIcon, RefundIcon, WarningIcon } from './refund-icons.js';

type Statuses = readonly OrderStaffRefundView['status'][];

// Stripe's list may already hold a refund being sent; the platform counts it as refunded only once Stripe accepted it.
const IN_PROGRESS_STATUSES: Record<'provider' | 'platform', Statuses> = { provider: ['running', 'submitted', 'unconfirmed'], platform: ['submitted', 'unconfirmed'] };
const REQUESTED_STATUSES: Record<'provider' | 'platform', Statuses> = { provider: ['pending', 'blocked_permission'], platform: ['pending', 'running', 'blocked_permission'] };

const sumOf = (refunds: readonly OrderStaffRefundView[], statuses: readonly OrderStaffRefundView['status'][]): number =>
  refunds.filter((refund) => statuses.includes(refund.status)).reduce((sum, refund) => sum + refund.amountCents, 0);

const AmountRow = ({ label, children, sub, total = false }: { label: string; children: ReactNode; sub?: string | undefined; total?: boolean }) => (
  <Stack direction="row" useFlexGap spacing="1rem" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
    <RefundAmountLabel total={total}>{label}</RefundAmountLabel>
    <Stack sx={{ alignItems: 'flex-end' }}>
      <RefundAmountValue total={total}>{children}</RefundAmountValue>
      {sub === undefined ? null : <Typography variant="caption" color="textSecondary">{sub}</Typography>}
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
  const preview = action.kind === 'ready' ? action.preview : null;
  const totalsNote = action.kind === 'error'
    ? messages.paymentPreviewFailedTotals
    : preview?.remainderSource === 'platform' ? messages.paymentPlatformTotals : null;
  const source = preview?.remainderSource ?? 'platform';
  const paidCents = preview?.paidCents ?? totals?.paidCents ?? order.amountCents;
  const refundedCents = preview?.refundedCents ?? totals?.refundedCents ?? 0;
  const remainingCents = preview?.remainderCents ?? totals?.remainingCents ?? 0;
  const unknown = refundedAmountUnknown(order, refundedCents);
  const requestedCents = sumOf(staffRefunds, REQUESTED_STATUSES[source]);
  const unconfirmedCents = Math.min(refundedCents, sumOf(staffRefunds, IN_PROGRESS_STATUSES[source]));
  const shippingCents = order.shipping?.amountCents ?? 0;
  const blocked = staffRefunds.some((refund) => refund.status === 'blocked_permission');

  return (
    <SectionCard title={messages.paymentTitle} headerActions={chips} data-testid="order-payment">
      <Stack useFlexGap spacing="0.6rem">
        {refundedCents === 0 && requestedCents === 0 && !unknown ? (
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
            {unknown ? <AmountRow label={messages.refunded}>{messages.refundedUnknownValue}</AmountRow> : null}
            {unknown || refundedCents === 0 ? null : (
              <AmountRow label={messages.refunded} sub={unconfirmedCents === 0 ? undefined : messages.inProgress({ amount: money(unconfirmedCents) })}>
                {`−${money(refundedCents)}`}
              </AmountRow>
            )}
            {requestedCents === 0 ? null : (
              <AmountRow label={messages.requestedRefund} sub={blocked ? messages.waitingForPermission : messages.notSentYet}>{`−${money(requestedCents)}`}</AmountRow>
            )}
            <Divider />
            <AmountRow label={messages.remaining} total>{money(remainingCents)}</AmountRow>
          </>
        )}
        {totalsNote === null ? null : <Typography variant="body2" color="textSecondary" data-testid="order-payment-platform-totals">{totalsNote}</Typography>}
      </Stack>
      {unknown ? (
        <RefundWarningRow direction="row" useFlexGap spacing="0.5rem" data-testid="order-payment-refunded-unknown">
          <WarningIcon />
          <Typography variant="body2">{messages.refundedUnknown}</Typography>
        </RefundWarningRow>
      ) : null}
      {blocked ? (
        <RefundWarningRow direction="row" useFlexGap spacing="0.5rem" data-testid="order-payment-not-paid-out">
          <WarningIcon />
          <Typography variant="body2">{messages.notPaidOut}</Typography>
        </RefundWarningRow>
      ) : !unknown && refundedCents > 0 && refundedCents >= paidCents && remainingCents === 0 && unconfirmedCents === 0 ? (
        <RefundMutedRow direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center' }}>
          <CheckCircleIcon />
          <Typography variant="body2">{messages.fullyRefunded}</Typography>
        </RefundMutedRow>
      ) : null}
      {action.kind === 'loading' ? <Typography variant="body2" color="textSecondary">{messages.previewLoading}</Typography> : null}
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
          <Typography id="order-refund-waiting" variant="body2" color="textSecondary">{messages.waitingBlocksAction}</Typography>
        </Stack>
      ) : null}
    </SectionCard>
  );
};

const RefundItem = ({ refund, order }: { refund: OrderStaffRefundView; order: Pick<OrderListItem, 'status'> }) => {
  const t = useTranslations();
  const messages = t.sales.staffRefund;
  const { language } = useLanguage();
  const time = (value: string) => formatDateTime(value, language, SALES_LINK_TIME_ZONE);
  const waiting = refund.status === 'pending' || refund.status === 'running' || refund.status === 'submitted';
  const blocked = refund.status === 'blocked_permission';
  const reason = staffRefundReason(refund, order);
  const facts = [
    refund.status === 'succeeded' ? messages.completedAt({ time: time(refund.updatedAt) }) : null,
    blocked ? [messages.attempts({ count: refund.attempts }), refund.nextAttemptAt === null ? null : messages.nextAttempt({ time: time(refund.nextAttemptAt) })].filter((part) => part !== null).join(' · ') : null,
    blocked && refund.permissionBlockedAt !== null ? messages.lastAttempt({ time: time(orderRefundPermissionDeadline(refund.permissionBlockedAt)) }) : null,
    refund.restocked ? messages.restocked : null,
    refund.removedFromPackingList ? messages.removedFromPackingList : null,
  ].filter((fact) => fact !== null);

  return (
    <RefundHistoryItem data-testid={`order-staff-refund-${refund.id}`}>
      <RefundHistoryCard attention={blocked}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'baseline', columnGap: '0.75rem', rowGap: '0.25rem' }}>
          <RefundHistoryAmount>{formatMinorUnitsPrice(refund.amountCents, refund.currency, language)}</RefundHistoryAmount>
          <WrapAnywhereText variant="body2" color="textSecondary" sx={{ flex: '1 1 12rem', minWidth: 0 }}>
            {messages.requestedBy({ who: refund.requestedByEmail, time: time(refund.createdAt) })}
          </WrapAnywhereText>
          <RefundStatusChip status={refund.status} label={messages.states[refund.status]} data-testid="order-staff-refund-state" />
        </Stack>
        {refund.note === null ? null : (
          <Box sx={{ mt: '0.5rem' }}>
            <Typography variant="caption" color="textSecondary">{messages.reasonLabel}</Typography>
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
            {facts.map((fact) => <Typography key={fact} variant="body2" color="textSecondary">{fact}</Typography>)}
          </Stack>
        )}
      </RefundHistoryCard>
      {blocked ? (
        <Alert severity="warning">
          <AlertTitle>{messages.blockedTitle}</AlertTitle>
          <Stack useFlexGap spacing="0.5rem">
            <Typography variant="body2">{messages.blockedBody}</Typography>
            <Typography variant="body2">{messages.blockedNoAction}</Typography>
            <MuiLink component={Link} to="/panel/integrations" hash="stripe" variant="body2" underline="always" sx={{ alignSelf: 'flex-start' }}>
              {messages.paymentSettingsLink}
            </MuiLink>
            <Typography variant="body2">{messages.blockedBuyerEmail}</Typography>
          </Stack>
        </Alert>
      ) : null}
      {reason === null ? null : <Alert severity="error" data-testid="order-staff-refund-help">{messages.reasonHelp[reason]}</Alert>}
    </RefundHistoryItem>
  );
};

export const OrderStaffRefundHistory = ({ refunds, order }: { refunds: readonly OrderStaffRefundView[]; order: Pick<OrderListItem, 'status'> }) => {
  const t = useTranslations();
  const messages = t.sales.staffRefund;
  return (
    <SectionCard
      title={messages.historyTitle}
      headerActions={<Chip size="small" variant="outlined" label={messages.historyCount({ count: refunds.length })} />}
      data-testid="order-staff-refunds"
    >
      <Stack component="ul" useFlexGap spacing="0.75rem" sx={{ m: 0, p: 0 }}>
        {refunds.map((refund) => <RefundItem key={refund.id} refund={refund} order={order} />)}
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
      <RefundNote direction="row" useFlexGap spacing="0.5rem">
        <CheckCircleIcon />
        <Typography variant="body2">{restocked ? messages.offPackingRestockedNote : messages.offPackingNote}</Typography>
      </RefundNote>
      {canShip ? (
        <Button variant="outlined" fullWidth disabled={pending} onClick={onShipAnyway} data-testid="order-ship-anyway">
          {pending ? messages.shippingAnyway : messages.shipAnyway}
        </Button>
      ) : null}
      {error === null ? null : <Alert severity="error">{error}</Alert>}
    </Stack>
  );
};
