import { ok, type TenantSettings } from '#core/domain/index.js';

import type { TenantRepository } from '../ports.js';

export const inMemoryChangeSettings = (
  read: (tenantId: string) => TenantSettings | null | Promise<TenantSettings | null>,
  write: (next: TenantSettings) => void = () => undefined,
): TenantRepository['changeSettings'] => async (tenantId, change) => {
  const current = await read(tenantId);
  if (current === null) return null;
  const changes = await change(current);
  if (!changes.ok) return changes;
  const next = { ...current, ...changes.value };
  write(next);
  return ok(next);
};

export const writeSettings = async (
  tenants: Pick<TenantRepository, 'changeSettings'>,
  tenantId: string,
  changes: Partial<TenantSettings>,
): Promise<TenantSettings> => {
  const result = await tenants.changeSettings(tenantId, async () => ok(changes));
  if (result === null || !result.ok) throw new Error(`The settings of ${tenantId} were not written`);
  return result.value;
};
