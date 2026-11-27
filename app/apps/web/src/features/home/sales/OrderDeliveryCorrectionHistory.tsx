import { Stack, Typography } from '@mui/material';
import { SALES_LINK_TIME_ZONE, type OrderShipping } from '#core/domain/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

export const OrderDeliveryCorrectionHistory = ({ shipping }: { shipping: OrderShipping }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const corrections = shipping.corrections ?? [];
  if (corrections.length === 0) return null;
  return (
    <Stack useFlexGap spacing="0.5rem" data-testid="order-delivery-history">
      <Typography variant="subtitle2">{t.deliveryCorrection.history}</Typography>
      {corrections.map((entry, index) => (
        <Stack key={`${entry.at}-${String(index)}`} useFlexGap spacing="0.1rem">
          <Typography variant="caption" color="text.secondary">{formatDateTime(entry.at, language, SALES_LINK_TIME_ZONE)} · {entry.byEmail ?? entry.byUserId}</Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{t.deliveryCorrection.fields[entry.field]}: {entry.from ?? '—'} → {entry.to}</Typography>
        </Stack>
      ))}
    </Stack>
  );
};
