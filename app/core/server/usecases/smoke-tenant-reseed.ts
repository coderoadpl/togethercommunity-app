import {
  appError,
  err,
  internal,
  ok,
  SmokeTenantReseedRefused,
  type AppError,
  type Result,
  type WipedTable,
} from '#core/domain/index.js';

import type { Clock, IdGenerator, PlatformAuditRepository, SmokeTenantReseedPort } from '../ports.js';

export interface SmokeTenantReseedDeps {
  reseed: SmokeTenantReseedPort;
  platformAudit: PlatformAuditRepository;
  environment: string;
  ids: IdGenerator;
  clock: Clock;
}

export interface SmokeTenantReseedResult {
  tenantId: string;
  environment: string;
  durationMs: number;
  wiped: WipedTable[];
}

const OPERATOR_ACTOR = { userId: 'operator-secret', email: 'operator@together.invalid' };

/**
 * Runs on production by design: the smoke tenant is synthetic, so this path
 * deliberately skips `productionResetRefusal`. The adapter refuses instead when
 * the tenant no longer looks like the seeded fixture.
 */
export const reseedSmokeTenant = async (
  deps: SmokeTenantReseedDeps,
): Promise<Result<SmokeTenantReseedResult, AppError>> => {
  const startedAt = Date.parse(deps.clock.nowIso());
  const audit = (
    status: 'succeeded' | 'failed',
    detail: string | null,
    durationMs: number,
  ): Promise<void> => deps.platformAudit.record({
    id: deps.ids.nextId(),
    action: 'reseed-acme',
    actorUserId: OPERATOR_ACTOR.userId,
    actorEmail: OPERATOR_ACTOR.email,
    environment: deps.environment,
    status,
    detail,
    durationMs,
    createdAt: deps.clock.nowIso(),
  });

  try {
    const { tenantId, wiped } = await deps.reseed.run();
    const durationMs = Math.max(0, Date.parse(deps.clock.nowIso()) - startedAt);
    await audit('succeeded', null, durationMs);
    return ok({ tenantId, environment: deps.environment, durationMs, wiped });
  } catch (error) {
    const durationMs = Math.max(0, Date.parse(deps.clock.nowIso()) - startedAt);
    const message = error instanceof Error ? error.message : String(error);
    await audit('failed', message, durationMs);
    return err(error instanceof SmokeTenantReseedRefused
      ? appError('conflict', message)
      : internal('Smoke tenant reseed failed'));
  }
};
