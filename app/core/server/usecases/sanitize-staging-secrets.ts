import {
  err,
  forbidden,
  internal,
  ok,
  productionResetRefusal,
  type AppError,
  type DeploymentResetMarkers,
  type Result,
  type TenantSecretKey,
} from '#core/domain/index.js';

import type {
  Clock,
  IdGenerator,
  PlatformAuditRepository,
  SecretCrypto,
  TenantSecretScanPort,
} from '../ports.js';

export interface SanitizeStagingSecretsDeps extends DeploymentResetMarkers {
  secrets: TenantSecretScanPort;
  secretCrypto: SecretCrypto;
  platformAudit: PlatformAuditRepository;
  environment: string;
  ids: IdGenerator;
  clock: Clock;
}

interface RemovedTenantSecret {
  tenantId: string;
  key: TenantSecretKey;
}

export interface SanitizeStagingSecretsResult {
  environment: string;
  scanned: number;
  kept: number;
  removed: RemovedTenantSecret[];
  durationMs: number;
}

const OPERATOR_ACTOR = { userId: 'operator-secret', email: 'operator@together.invalid' };

const describeCounts = (scanned: number, removed: RemovedTenantSecret[]): string => {
  const counts = `scanned=${String(scanned)} kept=${String(scanned - removed.length)} removed=${String(removed.length)}`;
  if (removed.length === 0) return counts;
  const listed = removed.map((entry) => `${entry.tenantId}:${entry.key}`).join(', ');
  return `${counts} (${listed})`;
};

/**
 * A disposable database branched from production carries secrets encrypted with
 * the production master key, which this deployment cannot read. Removing them
 * turns every dependent integration back into an unconfigured one, so the
 * operator can re-enter deployment-specific credentials.
 */
export const sanitizeStagingSecrets = async (
  deps: SanitizeStagingSecretsDeps,
): Promise<Result<SanitizeStagingSecretsResult, AppError>> => {
  const refusal = productionResetRefusal(deps);
  if (refusal !== null) {
    return err(forbidden(`Secret sanitize refused because ${refusal}`));
  }

  const startedAt = Date.parse(deps.clock.nowIso());
  const elapsed = (): number => Math.max(0, Date.parse(deps.clock.nowIso()) - startedAt);
  const audit = (
    status: 'succeeded' | 'failed',
    detail: string | null,
    durationMs: number,
  ): Promise<void> => deps.platformAudit.record({
    id: deps.ids.nextId(),
    action: 'sanitize-staging-secrets',
    actorUserId: OPERATOR_ACTOR.userId,
    actorEmail: OPERATOR_ACTOR.email,
    environment: deps.environment,
    status,
    detail,
    durationMs,
    createdAt: deps.clock.nowIso(),
  });

  try {
    const stored = await deps.secrets.listAll();
    const removed: RemovedTenantSecret[] = [];
    for (const secret of stored) {
      if (deps.secretCrypto.decrypt(secret).ok) continue;
      if (await deps.secrets.deleteById(secret.id)) {
        removed.push({ tenantId: secret.tenantId, key: secret.key });
      }
    }
    const durationMs = elapsed();
    await audit('succeeded', describeCounts(stored.length, removed), durationMs);
    return ok({
      environment: deps.environment,
      scanned: stored.length,
      kept: stored.length - removed.length,
      removed,
      durationMs,
    });
  } catch (error) {
    await audit('failed', error instanceof Error ? error.message : String(error), elapsed());
    return err(internal('Secret sanitize failed'));
  }
};
