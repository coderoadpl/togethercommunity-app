import type { ListOrderChangesQuery, OrderChange } from '#core/domain/index.js';

export interface OrderChangeRepository {
  listOrderChanges(tenantId: string, query: ListOrderChangesQuery): Promise<OrderChange[]>;
}
