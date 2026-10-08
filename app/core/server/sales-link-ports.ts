import type { AppError, Result, SalesLink } from '#core/domain/index.js';
import type { Clock, IdGenerator, ProductPriceRepository, ProductBatchReader, TenantRepository } from './ports.js';

export interface SalesLinkRepository {
  list(tenantId: string): Promise<SalesLink[]>;
  findById(tenantId: string, id: string): Promise<SalesLink | null>;
  findBySlug(tenantId: string, slug: string): Promise<SalesLink | null>;
  save(tenantId: string, link: SalesLink, expectedRevision: number | null): Promise<Result<SalesLink, AppError>>;
  delete(tenantId: string, id: string, occurredAt: string): Promise<Result<void, AppError>>;
}
export interface SalesLinkDeps {
  salesLinks: SalesLinkRepository;
  products: Pick<ProductBatchReader, 'findByIds'>;
  prices: Pick<ProductPriceRepository, 'listActiveByProducts'>;
  tenants: Pick<TenantRepository, 'findSettings'>;
  clock: Clock;
  ids: IdGenerator;
}
