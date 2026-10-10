import type { ConsumerSalesQuery, Order } from '#core/domain/index.js';

export interface ConsumerSalesRepository {
  listUninvoicedConsumers(tenantId: string, query: ConsumerSalesQuery): Promise<Order[]>;
}
