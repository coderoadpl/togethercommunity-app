import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import { telemetryConnectionSchema, type TelemetryStoreView } from '#core/domain/telemetry.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, SecretCrypto, TenantSecretRepository } from '../ports.js';
import type { TelemetryOutbox, TelemetrySettingsRepository, TelemetryStoreFactory } from '../telemetry/ports.js';

export interface TelemetryStoreDeps {
  settings: TelemetrySettingsRepository;
  outbox: TelemetryOutbox;
  stores: TelemetryStoreFactory;
  secrets: TenantSecretRepository;
  crypto: SecretCrypto;
  clock: Clock;
  ids: IdGenerator;
  egress: (tenantId: string) => Promise<TelemetryStoreView['egress']>;
  hidesStatistics: boolean;
}
export const getTelemetryStore = async (ctx: Ctx, deps: TelemetryStoreDeps): Promise<Result<TelemetryStoreView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:read');
  if (!tenant.ok) return tenant;
  const settings = await deps.settings.get(tenant.value);
  return ok({ settings, egress: await deps.egress(tenant.value), sync: await deps.outbox.status(tenant.value, deps.clock.nowIso()), hidesStatistics: deps.hidesStatistics && settings.provider === null });
};
export const connectTelemetryStore = async (ctx: Ctx, input: unknown, deps: TelemetryStoreDeps): Promise<Result<TelemetryStoreView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const parsed = telemetryConnectionSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid telemetry connection'));
  const current = await deps.settings.get(tenant.value);
  if (current.provider !== null) return err(validation('Disconnect the current telemetry store first'));
  let store;
  try { store = deps.stores.open(tenant.value, parsed.data.connectionString); } catch { return err(validation('Invalid telemetry connection')); }
  try {
    const probe = await store.probe(tenant.value);
    if (!probe.ok) return probe;
  } finally { await store.close(tenant.value); }
  const now = deps.clock.nowIso();
  await deps.secrets.upsert(tenant.value, { id: deps.ids.nextId(), tenantId: tenant.value, key: 'telemetry.mongodb', ...deps.crypto.encrypt(parsed.data.connectionString), maskedPreview: '••••', updatedAt: now });
  await deps.settings.save(tenant.value, { provider: 'mongodb', region: parsed.data.region, connectedAt: now, lastProbeAt: now, lastProbeResult: 'ok', egressMode: (await deps.egress(tenant.value)).mode });
  return getTelemetryStore(ctx, deps);
};
export const probeTelemetryStore = async (ctx: Ctx, deps: TelemetryStoreDeps): Promise<Result<TelemetryStoreView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const settings = await deps.settings.get(tenant.value);
  const secret = await deps.secrets.findByKey(tenant.value, 'telemetry.mongodb');
  if (settings.provider === null || secret === null) return err(validation('Telemetry store is disconnected'));
  const decrypted = deps.crypto.decrypt(secret);
  if (!decrypted.ok) return decrypted;
  const store = deps.stores.open(tenant.value, decrypted.value);
  try {
    const result = await store.probe(tenant.value);
    await deps.settings.save(tenant.value, { ...settings, lastProbeAt: deps.clock.nowIso(), lastProbeResult: result.ok ? 'ok' : 'error' });
    return getTelemetryStore(ctx, deps);
  } finally { await store.close(tenant.value); }
};
export const disconnectTelemetryStore = async (ctx: Ctx, deps: TelemetryStoreDeps): Promise<Result<TelemetryStoreView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const settings = await deps.settings.get(tenant.value);
  await deps.settings.save(tenant.value, { ...settings, provider: null, connectedAt: null });
  await deps.outbox.discard(tenant.value);
  await deps.secrets.delete(tenant.value, 'telemetry.mongodb');
  return getTelemetryStore(ctx, deps);
};

type ReportDeps = Pick<TelemetryStoreDeps, 'settings' | 'hidesStatistics'> | undefined;
const hiddenForTenant = async (tenantId: string, deps: ReportDeps): Promise<Result<boolean, AppError>> =>
  ok(deps?.hidesStatistics === true && (await deps.settings.get(tenantId)).provider === null);

export const telemetryReportsHidden = async (ctx: Ctx, deps: ReportDeps): Promise<Result<boolean, AppError>> => {
  const tenant = authorizeTenant(ctx, 'marketing:campaign:read');
  if (!tenant.ok) return tenant;
  return hiddenForTenant(tenant.value, deps);
};
export const telemetryDeliveryEngagementHidden = async (ctx: Ctx, deps: ReportDeps): Promise<Result<boolean, AppError>> => {
  const tenant = authorizeTenant(ctx, 'marketing:delivery:read');
  if (!tenant.ok) return tenant;
  return hiddenForTenant(tenant.value, deps);
};
