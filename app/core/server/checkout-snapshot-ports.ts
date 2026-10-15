import type { CheckoutSnapshot } from '#core/domain/index.js';

export interface CheckoutSnapshotRepository {
  create(tenantId: string, snapshot: CheckoutSnapshot): Promise<void>;
  attachProviderSession(tenantId: string, id: string, providerSessionId: string): Promise<void>;
  findById(tenantId: string, id: string): Promise<CheckoutSnapshot | null>;
}
