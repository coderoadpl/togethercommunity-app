import type { ListOrderChangesQuery, OrderChange, OrderListItem } from '#core/domain/index.js';

export interface OrderChangeRepository {
  listOrderChanges(tenantId: string, query: ListOrderChangesQuery): Promise<OrderChange[]>;
}

export interface OrderListItemReader {
  listByIds(tenantId: string, orderIds: readonly string[]): Promise<OrderListItem[]>;
}
