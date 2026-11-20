import type { Clock, IdGenerator, ProductPriceRepository, ProductBatchReader, ProductRepository, SalesLinkRepository, TenantRepository } from './ports.js';
import type { StockRepository } from './stock-ports.js';

export interface SalesLinkDeps {
  salesLinks: SalesLinkRepository;
  products: Pick<ProductBatchReader, 'findByIds'> & Pick<ProductRepository, 'listPublishedByTenant'>;
  prices: Pick<ProductPriceRepository, 'listActiveByProducts'>;
  tenants: Pick<TenantRepository, 'findSettings'>;
  clock: Clock;
  ids: IdGenerator;
  stock?: Pick<StockRepository, 'listByProducts'>;
}
