import type { AppError, Result, SalesLink } from '#core/domain/index.js';
import type { Clock, IdGenerator, ProductPriceRepository, ProductBatchReader, ProductRepository, TenantRepository } from './ports.js';
import type { StockRepository } from './stock-ports.js';

export interface SalesLinkRepository {
  list(tenantId: string): Promise<SalesLink[]>;
  findById(tenantId: string, id: string): Promise<SalesLink | null>;
  findBySlug(tenantId: string, slug: string): Promise<SalesLink | null>;
  save(tenantId: string, link: SalesLink, expectedRevision: number | null): Promise<Result<SalesLink, AppError>>;
  delete(tenantId: string, id: string, occurredAt: string): Promise<Result<void, AppError>>;
}
export interface SalesLinkDeps {
  salesLinks: SalesLinkRepository;
  products: Pick<ProductBatchReader, 'findByIds'> & Pick<ProductRepository, 'listPublishedByTenant'>;
  prices: Pick<ProductPriceRepository, 'listActiveByProducts'>;
  tenants: Pick<TenantRepository, 'findSettings'>;
  clock: Clock;
  ids: IdGenerator;
  stock?: Pick<StockRepository, 'listByProducts'>;
}
