import {
  err,
  forbidden,
  internal,
  ok,
  productionResetRefusal,
  validation,
  type AppError,
  type DeploymentResetMarkers,
  type Result,
  type WipedTable,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorize } from '../authorize.js';
import type { Clock, IdGenerator, PlatformAuditRepository, PlatformDataResetPort } from '../ports.js';

export interface PlatformDataResetDeps extends DeploymentResetMarkers {
  dataReset: PlatformDataResetPort;
  platformAudit: PlatformAuditRepository;
  environment: string;
  ids: IdGenerator;
  clock: Clock;
}

export interface PlatformDataResetResult {
  environment: string;
  durationMs: number;
  wiped: WipedTable[];
}

export const resetPlatformData = async (
  ctx: Ctx,
  input: { confirmation: string },
  deps: PlatformDataResetDeps,
): Promise<Result<PlatformDataResetResult, AppError>> => {
  const denial = authorize(ctx, 'platform:data:reset');
  if (denial !== null) return err(denial);

  const refusal = productionResetRefusal(deps);
  if (refusal !== null) {
    return err(forbidden(`Data reset refused because ${refusal}`));
  }
  if (input.confirmation.trim() !== deps.environment) {
    return err(validation(`Type "${deps.environment}" to confirm the data reset`));
  }

  const startedAt = Date.parse(deps.clock.nowIso());
  const audit = (
    status: 'succeeded' | 'failed',
    detail: string | null,
    durationMs: number,
  ): Promise<void> => deps.platformAudit.record({
    id: deps.ids.nextId(),
    action: 'platform:data-reset',
    actorUserId: ctx.identity.userId,
    actorEmail: ctx.identity.email,
    environment: deps.environment,
    status,
    detail,
    durationMs,
    createdAt: deps.clock.nowIso(),
  });

  try {
    const { wiped } = await deps.dataReset.run();
    const durationMs = Math.max(0, Date.parse(deps.clock.nowIso()) - startedAt);
    await audit('succeeded', null, durationMs);
    return ok({ environment: deps.environment, durationMs, wiped });
  } catch (error) {
    const durationMs = Math.max(0, Date.parse(deps.clock.nowIso()) - startedAt);
    await audit('failed', error instanceof Error ? error.message : String(error), durationMs);
    return err(internal('Data reset failed'));
  }
};
