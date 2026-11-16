import type { ListOrderChangesQuery, OrderChangeRead, OrderListItem } from '#core/domain/index.js';

export interface OrderChangeRepository {
  listOrderChanges(tenantId: string, query: ListOrderChangesQuery): Promise<OrderChangeRead>;
}

export interface OrderListItemReader {
  listByIds(tenantId: string, orderIds: readonly string[]): Promise<OrderListItem[]>;
}
