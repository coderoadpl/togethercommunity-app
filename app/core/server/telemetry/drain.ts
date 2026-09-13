import type { Clock, SecretCrypto, TenantSecretRepository } from '../ports.js';
import type { TelemetryOutbox, TelemetrySettingsRepository, TelemetryStore, TelemetryStoreFactory } from './ports.js';

const DRAIN_BATCH_SIZE = 500;
const DRAIN_RESERVE_MS = 5000;

export const drainTelemetry = async (tenantId: string, deps: {
  outbox: TelemetryOutbox; settings: TelemetrySettingsRepository; stores: TelemetryStoreFactory;
  secrets: TenantSecretRepository; crypto: SecretCrypto; clock: Clock; random: () => number; deadlineAt: string;
}): Promise<void> => {
  if ((await deps.settings.get(tenantId)).provider === null) return;
  const secret = await deps.secrets.findByKey(tenantId, 'telemetry.mongodb');
  if (secret === null) return;
  const decrypted = deps.crypto.decrypt(secret);
  if (!decrypted.ok) return;
  let store: TelemetryStore | undefined;
  try {
    while (Date.parse(deps.clock.nowIso()) + DRAIN_RESERVE_MS < Date.parse(deps.deadlineAt)) {
      const batch = await deps.outbox.pending(tenantId, deps.clock.nowIso(), DRAIN_BATCH_SIZE);
      const last = batch.at(-1);
      if (last === undefined) return;
      try {
        store ??= deps.stores.open(tenantId, decrypted.value);
        await store.appendBatch(tenantId, batch.map((row) => row.event));
        await deps.outbox.acknowledge(tenantId, last.sequence, deps.clock.nowIso());
      } catch {
        const attempts = Math.max(...batch.map((row) => row.attempts));
        const delay = Math.min(15 * 60 * 1000, Math.max(5000, 5000 * 2 ** attempts * (0.75 + deps.random() * 0.5)));
        await deps.outbox.retry(tenantId, last.sequence, new Date(Date.parse(deps.clock.nowIso()) + delay).toISOString());
        return;
      }
    }
  } finally {
    await store?.close(tenantId);
  }
};
