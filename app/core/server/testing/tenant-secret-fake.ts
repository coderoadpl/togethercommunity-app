import type { TenantSecret } from '#core/domain/index.js';

import type { TenantSecretRepository } from '../ports.js';

export const createTenantSecretRepositoryFake = (initial: readonly TenantSecret[] = []) => {
  const rows: TenantSecret[] = structuredClone([...initial]);
  let nextBatchFailure: number | null = null;
  const store = (target: TenantSecret[], tenantId: string, secret: TenantSecret): TenantSecret => {
    const stored = { ...secret, tenantId };
    const index = target.findIndex((row) => row.tenantId === tenantId && row.key === secret.key);
    if (index === -1) target.push(stored);
    else target[index] = stored;
    return stored;
  };
  const repository: TenantSecretRepository = {
    listByTenant: async (tenantId) => rows.filter((row) => row.tenantId === tenantId),
    findByKey: async (tenantId, key) =>
      rows.find((row) => row.tenantId === tenantId && row.key === key) ?? null,
    upsert: async (tenantId, secret) => store(rows, tenantId, secret),
    upsertMany: async (tenantId, secrets) => {
      const staged = structuredClone(rows);
      const stored: TenantSecret[] = [];
      const failure = nextBatchFailure;
      nextBatchFailure = null;
      for (const [index, secret] of secrets.entries()) {
        if (index === failure) throw new Error(`tenant secret batch failed at ${String(index)}`);
        stored.push(store(staged, tenantId, secret));
      }
      rows.splice(0, rows.length, ...staged);
      return stored;
    },
    delete: async (tenantId, key) => {
      const index = rows.findIndex((row) => row.tenantId === tenantId && row.key === key);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    },
  };
  return {
    repository,
    rows,
    failNextBatchAt: (index: number) => { nextBatchFailure = index; },
  };
};
