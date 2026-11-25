import { useId, useState } from 'react';
import { Chip, Typography } from '@mui/material';

import type { OrderListItem } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';
import { SalesProductItems, SalesProductLine, SalesProductMore, SalesProductName, SalesProductToggle, VisuallyHidden } from '../../../theme.js';
import { ExpandChevronIcon } from './refund-icons.js';

export const OrderProductSummary = ({ order }: { order: OrderListItem }) => {
  const t = useTranslations();
  const itemsId = useId();
  const [expanded, setExpanded] = useState(false);
  const names = order.lines?.map((line) => line.name) ?? [];
  const [first = order.productTitle, ...rest] = names;
  return (
    <>
      <SalesProductLine title={names.length > 1 ? names.join('\n') : first}>
        <SalesProductName data-testid="sales-product-first">{first}</SalesProductName>
        {rest.length === 0 ? null : (
          <>
            <SalesProductMore data-testid="sales-product-more">
              <span aria-hidden>{t.sales.moreItems({ count: rest.length })}</span>
              <VisuallyHidden>{t.sales.moreItemsLabel({ count: rest.length })}</VisuallyHidden>
            </SalesProductMore>
            <SalesProductToggle
              size="small"
              expanded={expanded}
              aria-expanded={expanded}
              aria-controls={itemsId}
              aria-label={t.sales.orderLines({ count: names.length })}
              onClick={() => setExpanded((current) => !current)}
            >
              <ExpandChevronIcon />
            </SalesProductToggle>
          </>
        )}
      </SalesProductLine>
      {rest.length === 0 ? null : (
        <SalesProductItems id={itemsId} hidden={!expanded} data-testid="sales-product-items">
          {names.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}
        </SalesProductItems>
      )}
      {order.salesLinkId ? <Typography variant="caption" color="textSecondary" sx={{ display: 'block' }}>{t.salesLinks.salesLink}: {order.salesLinkTitle ?? order.salesLinkId}</Typography> : null}
      {order.mode === 'test' ? <Chip size="small" label={t.sales.testChip} /> : null}
      {order.lines?.some((line) => line.personalization !== undefined) === true ? <Chip size="small" variant="outlined" color="info" label={t.personalization.marker} data-testid="sales-personalization-chip" sx={{ ml: '0.25rem' }} /> : null}
    </>
  );
};
