import {
  err,
  notFound,
  ok,
  type SchedulerRunListQuery,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { Clock, SchedulerRunRepository } from '../ports.js';

export const listSchedulerRunsForTenant = async (
  ctx: Ctx,
  input: SchedulerRunListQuery,
  deps: { runs: SchedulerRunRepository; clock: Clock },
) => {
  const tenantId = authorizeTenant(ctx, 'scheduler:read');
  if (!tenantId.ok) return tenantId;
  const since = new Date(Date.parse(deps.clock.nowIso()) - 24 * 60 * 60 * 1000).toISOString();
  const [page, summary] = await Promise.all([
    deps.runs.listForTenant(tenantId.value, input),
    deps.runs.summarizeForTenant(tenantId.value, since),
  ]);
  return ok({ ...page, summary });
};

export const getSchedulerRunForTenant = async (
  ctx: Ctx,
  input: { runId: string },
  deps: { runs: SchedulerRunRepository },
) => {
  const tenantId = authorizeTenant(ctx, 'scheduler:read');
  if (!tenantId.ok) return tenantId;
  const item = await deps.runs.getForTenant(tenantId.value, input.runId);
  return item === null ? err(notFound('Scheduler run was not found')) : ok(item);
};

export const listGlobalSchedulerRuns = async (
  input: SchedulerRunListQuery,
  deps: { runs: SchedulerRunRepository },
) => ok(await deps.runs.listPage(input));

export const getGlobalSchedulerRun = async (
  input: { runId: string },
  deps: { runs: SchedulerRunRepository },
) => {
  const item = await deps.runs.getWithTenants(input.runId);
  return item === null ? err(notFound('Scheduler run was not found')) : ok(item);
};
