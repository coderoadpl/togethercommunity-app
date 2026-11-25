import { Tooltip } from '@mui/material';

import type { OrderListItem } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';
import { StudioGridHint, StudioGridMutedHint } from '../../../theme.js';

type OrderBillingKind = 'company' | 'private' | 'none';

const orderBillingKind = (order: Pick<OrderListItem, 'billing'>): OrderBillingKind =>
  order.billing == null ? 'none' : order.billing.nip == null ? 'private' : 'company';

const useOrderInvoiceState = () => {
  const t = useTranslations();
  return (order: Pick<OrderListItem, 'invoice'>): { label: string; hint: string; missing: boolean } => {
    if (order.invoice == null) return { label: t.sales.noInvoice, hint: t.sales.noInvoiceHint, missing: true };
    const ksef = order.invoice.ksef;
    return ksef == null
      ? { label: t.sales.invoiceStatuses[order.invoice.status], hint: t.sales.invoiceStatusHints[order.invoice.status], missing: false }
      : { label: t.sales.ksefStates[ksef.state], hint: t.sales.ksefStateHints[ksef.state], missing: false };
  };
};

export const OrderInvoiceState = ({ order }: { order: Pick<OrderListItem, 'invoice'> }) => {
  const state = useOrderInvoiceState()(order);
  const Hint = state.missing ? StudioGridMutedHint : StudioGridHint;
  return (
    <Tooltip title={state.hint} describeChild>
      <Hint tabIndex={0} data-testid="sales-invoice-state">{state.label}</Hint>
    </Tooltip>
  );
};

export const OrderBillingState = ({ order }: { order: Pick<OrderListItem, 'billing'> }) => {
  const t = useTranslations();
  const kind = orderBillingKind(order);
  const Hint = kind === 'none' ? StudioGridMutedHint : StudioGridHint;
  return (
    <Tooltip title={t.sales.billingHints[kind]} describeChild>
      <Hint tabIndex={0} data-testid="sales-billing-state">{t.sales.billings[kind]}</Hint>
    </Tooltip>
  );
};
