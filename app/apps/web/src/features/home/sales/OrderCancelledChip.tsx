import { Chip } from '@mui/material';
import type { OrderListItem, OrderRefundJobView } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';

export const OrderCancelledChip = ({ cancelReason, refundJobStatus }: {
  cancelReason: OrderListItem['cancelReason'];
  refundJobStatus: OrderRefundJobView['status'] | null | undefined;
}) => {
  const t = useTranslations();
  if (cancelReason == null) return null;
  const refund = refundJobStatus == null ? null : t.sales.refundJobStatuses[refundJobStatus];
  return (
    <Chip
      size="small"
      color="error"
      variant="outlined"
      label={refund === null ? t.sales.cancelledOutOfStock : t.sales.cancelledOutOfStockRefund({ refund })}
      data-testid="order-cancelled-out-of-stock"
    />
  );
};
