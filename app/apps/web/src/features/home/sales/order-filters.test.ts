import { describe, expect, it } from 'vitest';

import { listLayoutSchema, listOrdersQuerySchema, ORDER_SOURCE_FILTER_PREFIX, ORDER_SOURCE_MAX_LENGTH } from '#core/domain/index.js';

import { reconcileGridLayout } from '../../../components/ui/data-grid/grid-layout.js';
import { ORDER_FILTER_VALIDATORS, orderListFilters, validateOrdersSearch } from './order-filters.js';

describe('order source filter', () => {
  it('round-trips the longest campaign source through the URL, saved layout and API', () => {
    const campaign = String.fromCodePoint(0x1f331).repeat(ORDER_SOURCE_MAX_LENGTH / 2);
    const source = `${ORDER_SOURCE_FILTER_PREFIX}${campaign}`;
    const filters = validateOrdersSearch({ source });
    expect(filters).toEqual({ source });
    const saved: unknown = JSON.parse(JSON.stringify({ version: 1, columns: [], sort: null, filters }));
    const restored = reconcileGridLayout(listLayoutSchema.parse(saved), { columns: [], sortFields: [], filters: ORDER_FILTER_VALIDATORS });
    expect(restored.filters).toEqual({ source });
    expect(listOrdersQuerySchema.parse(orderListFilters(restored.filters, '', null)))
      .toMatchObject({ source: campaign, sourceMatch: 'exact' });
    expect(validateOrdersSearch({ source: `${source}x` })).toEqual({});
  });
});
