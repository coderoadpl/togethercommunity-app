import { useState } from 'react';
import { Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import type { OrderListItem } from '#core/domain/index.js';
import { SectionCard } from '../../../components/layout/index.js';
import { OfferLines } from '../../../components/ui/OfferLines.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime, formatPrice } from '../../../lib/format.js';

export const OrderVerificationLookup = ({ initialReference = '', onFind }: {
  initialReference?: string;
  onFind: (reference: string) => void;
}) => {
  const t = useTranslations();
  const [reference, setReference] = useState(initialReference);
  return <Stack component="form" spacing={2} onSubmit={(event) => {
    event.preventDefault();
    if (reference.trim()) onFind(reference.trim());
  }}>
    <Typography color="text.secondary">{t.orderVerification.help}</Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <TextField fullWidth label={t.orderVerification.reference} value={reference} onChange={(event) => setReference(event.target.value)} />
      <Button type="submit" variant="outlined" disabled={!reference.trim()} sx={{ flexShrink: 0 }}>{t.orderVerification.find}</Button>
    </Stack>
  </Stack>;
};

export const OrderVerification = ({ order, canIssue, pending = false, onIssue }: {
  order: OrderListItem;
  canIssue: boolean;
  pending?: boolean;
  onIssue: (productId: string) => void;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const paid = order.status === 'paid';
  const lines = order.lines ?? [];
  return <Stack spacing={3} data-testid="order-verification">
    <SectionCard title={t.sales.orderTitle({ id: order.id })}>
      <Stack direction="row" spacing={1}>
        <Chip label={t.sales[order.status]} color={paid ? 'success' : 'warning'} />
        {order.mode === 'test' ? <Chip label={t.sales.testChip} /> : null}
      </Stack>
      <Typography>{order.memberName ?? order.memberEmail}</Typography>
      {order.memberName === null ? null : <Typography color="text.secondary">{order.memberEmail}</Typography>}
      <Typography>{t.sales.amount}: {formatPrice(order.amountCents, order.currency, language)}</Typography>
      {order.salesLinkTitle === undefined ? null : <Typography>{t.salesLinks.salesLink}: {order.salesLinkTitle}</Typography>}
    </SectionCard>
    <SectionCard title={t.salesLinks.products}>
      <OfferLines lines={lines} currency={order.currency} />
    </SectionCard>
    {!paid ? <Alert severity="warning">{t.orderVerification.unpaidHelp}</Alert> : null}
    {lines.filter((line) => line.productType === 'physical').map((line) => <SectionCard key={line.productId} title={line.name}>
      <Typography variant="h3">{t.orderVerification.issued({ count: line.issuedCount ?? 0 })}</Typography>
      {line.issuedAt == null ? null : <Typography>{t.orderVerification.firstIssued}: {formatDateTime(line.issuedAt, language)}</Typography>}
      {line.issuedByDisplayName == null ? null : <Typography color="text.secondary">{t.orderVerification.staff}: {line.issuedByDisplayName}</Typography>}
      {canIssue && paid && line.issuedCount === 0 ? <Button variant="contained" disabled={pending} onClick={() => onIssue(line.productId)}>{pending ? t.orderVerification.issuing : t.orderVerification.markIssued}</Button> : null}
    </SectionCard>)}
  </Stack>;
};
