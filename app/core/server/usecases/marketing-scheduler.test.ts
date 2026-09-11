import { beforeEach, describe, expect, it, vi } from 'vitest';

import { err, integrationAuth, ok, type AppError, type Result } from '#core/domain/index.js';

import { InMemorySchedulerRunRepository } from '../testing/marketing-fakes.js';
import { SCHEDULER_RUN_PURGE_BATCH_SIZE, runScheduledMarketingJobs } from './marketing-email.js';

const NOW = '1998-07-22T10:00:00.000Z';
const clock = { nowIso: () => NOW };
let sequence = 0;
const ids = { nextId: () => `maintenance-${String(++sequence)}` };
let warnings: string[] = [];
const logger = { warn: (message: string) => { warnings.push(message); } };
const retentionBoundaries = {
  pendingOlderThan: NOW,
  renderedBodiesOlderThan: NOW,
  engagementOlderThan: NOW,
  rawSnsInboxOlderThan: NOW,
  schedulerRunsOlderThan: NOW,
  schedulerIdleRunsOlderThan: NOW,
};

describe('marketing maintenance scheduling', () => {
  beforeEach(() => { warnings = []; });

  it('runs overdue maintenance after cron delay and waits 30 minutes after a completed pass', async () => {
    const runs = new InMemorySchedulerRunRepository();
    const purge = vi.spyOn(runs, 'purge');
    let now = NOW;
    const runRetention = vi.fn(async () => ok(undefined));
    const refreshIdentity = vi.fn(async () => ok(undefined));
    const runReputationAlerts = vi.fn(async () => ok({ sent: 0 }));
    const run = () => runScheduledMarketingJobs({ now, ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 6 * 60 * 60 * 1000 }, {
      jobs: { listRunnableCampaigns: async () => [], listRetentionTenantIds: async () => ['tenant-1'],
        listSesIdentityRefreshTenantIds: async () => ['tenant-1'], listSesTenantIds: async () => ['tenant-1'] },
      runs, ids, clock: { nowIso: () => now }, logger, dispatchCampaign: async () => ok(undefined),
      runRetention, refreshIdentity, runReputationAlerts,
    });
    expect((await run()).ok).toBe(true);
    now = '1998-07-22T10:29:59.000Z';
    await run();
    expect(runRetention).toHaveBeenCalledTimes(1);
    now = '1998-07-22T10:31:05.000Z';
    await run();
    expect(runRetention).toHaveBeenCalledTimes(2);
    expect(refreshIdentity).toHaveBeenCalledTimes(2);
    expect(runReputationAlerts).toHaveBeenCalledTimes(2);
    expect(purge).toHaveBeenCalledWith(
      { runsBefore: NOW, idleRunsBefore: NOW },
      { batchSize: SCHEDULER_RUN_PURGE_BATCH_SIZE, timeoutMs: expect.any(Number) },
    );
    expect(purge).toHaveBeenCalledTimes(2);
    expect((await runs.listPage({ kind: 'marketing_maintenance', status: 'completed', limit: 10 })).runs).toHaveLength(2);
  });

  it.each(['failure', 'deadline'])('retries maintenance on the next tick after %s', async (mode) => {
    const runs = new InMemorySchedulerRunRepository();
    let first = true;
    const runRetention = vi.fn(async () => first && mode === 'failure' ? err(integrationAuth('Unavailable')) : ok(undefined));
    const run = () => runScheduledMarketingJobs({ now: NOW, ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 1000, shouldContinue: () => !(first && mode === 'deadline') }, {
      jobs: { listRunnableCampaigns: async () => [], listRetentionTenantIds: async () => ['tenant-1'],
        listSesIdentityRefreshTenantIds: async () => [], listSesTenantIds: async () => [] },
      runs, ids, clock, logger, dispatchCampaign: async () => ok(undefined), runRetention,
      refreshIdentity: async () => ok(undefined), runReputationAlerts: async () => ok({ sent: 0 }),
    });
    await run();
    expect((await runs.listPage({ kind: 'marketing_maintenance', status: 'failed', limit: 10 })).runs).toHaveLength(1);
    first = false;
    expect((await run()).ok).toBe(true);
    expect((await runs.listPage({ kind: 'marketing_maintenance', status: 'completed', limit: 10 })).runs).toHaveLength(1);
    expect(runRetention).toHaveBeenCalledTimes(mode === 'failure' ? 2 : 1);
  });

  it('does not start scheduler-run retention outside maintenance or after the deadline', async () => {
    const runs = new InMemorySchedulerRunRepository();
    const purge = vi.spyOn(runs, 'purge');
    const common = {
      jobs: { listRunnableCampaigns: async () => [], listRetentionTenantIds: async () => [],
        listSesIdentityRefreshTenantIds: async () => [], listSesTenantIds: async () => [] },
      runs,
      ids,
      clock,
      logger,
      dispatchCampaign: async () => ok(undefined),
      runRetention: async () => ok(undefined),
      refreshIdentity: async () => ok(undefined),
      runReputationAlerts: async () => ok({ sent: 0 }),
    };
    await runScheduledMarketingJobs({ now: NOW, ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 1000 }, common);
    purge.mockClear();

    await runScheduledMarketingJobs({ now: '1998-07-22T10:01:00.000Z', ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 1000 }, { ...common, clock: { nowIso: () => '1998-07-22T10:01:00.000Z' } });
    expect(purge).not.toHaveBeenCalled();

    await runScheduledMarketingJobs({ now: '1998-07-22T10:31:00.000Z', ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 1000, shouldContinue: () => false },
    { ...common, clock: { nowIso: () => '1998-07-22T10:31:00.000Z' } });
    expect(purge).not.toHaveBeenCalled();
  });

  it('continues bounded scheduler-run purge batches while maintenance has time', async () => {
    const runs = new InMemorySchedulerRunRepository();
    const purge = vi.spyOn(runs, 'purge')
      .mockResolvedValueOnce({ purged: SCHEDULER_RUN_PURGE_BATCH_SIZE, cancelled: false })
      .mockResolvedValueOnce({ purged: 1, cancelled: false });

    await runScheduledMarketingJobs({ now: NOW, ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 1000 }, {
      jobs: { listRunnableCampaigns: async () => [], listRetentionTenantIds: async () => [],
        listSesIdentityRefreshTenantIds: async () => [], listSesTenantIds: async () => [] },
      runs,
      ids,
      clock,
      logger,
      dispatchCampaign: async () => ok(undefined),
      runRetention: async () => ok(undefined),
      refreshIdentity: async () => ok(undefined),
      runReputationAlerts: async () => ok({ sent: 0 }),
    });

    expect(purge).toHaveBeenCalledTimes(2);
  });

  const purgeBudgetDeps = (runs: InMemorySchedulerRunRepository, dispatchCampaign: () => Promise<Result<unknown, AppError>>) => ({
    jobs: { listRunnableCampaigns: async () => [{ tenantId: 'tenant-1', campaignId: 'campaign-1' }],
      listRetentionTenantIds: async () => [], listSesIdentityRefreshTenantIds: async () => [], listSesTenantIds: async () => [] },
    runs,
    ids,
    clock,
    logger,
    dispatchCampaign,
    runRetention: async () => ok(undefined),
    refreshIdentity: async () => ok(undefined),
    runReputationAlerts: async () => ok({ sent: 0 }),
  });

  it('contains a cancelled batch and still dispatches campaigns', async () => {
    const runs = new InMemorySchedulerRunRepository();
    const purge = vi.spyOn(runs, 'purge')
      .mockResolvedValueOnce({ purged: SCHEDULER_RUN_PURGE_BATCH_SIZE, cancelled: false })
      .mockResolvedValueOnce({ purged: 0, cancelled: true });
    const dispatchCampaign = vi.fn(async () => ok(undefined));

    const result = await runScheduledMarketingJobs({ now: NOW, ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 1000 }, purgeBudgetDeps(runs, dispatchCampaign));

    expect(result.ok).toBe(true);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(warnings).toEqual(['[marketing] scheduler run purge stopped reason=budget_exhausted']);
    expect(dispatchCampaign).toHaveBeenCalledTimes(1);
    expect((await runs.listPage({ kind: 'marketing_maintenance', status: 'completed', limit: 10 })).runs).toHaveLength(1);
  });

  it('fails the maintenance run on a rejected purge batch and still runs the remaining steps', async () => {
    const runs = new InMemorySchedulerRunRepository();
    const purge = vi.spyOn(runs, 'purge')
      .mockResolvedValueOnce({ purged: SCHEDULER_RUN_PURGE_BATCH_SIZE, cancelled: false })
      .mockRejectedValueOnce(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }));
    const dispatchCampaign = vi.fn(async () => ok(undefined));
    const runRetention = vi.fn(async () => ok(undefined));
    const refreshIdentity = vi.fn(async () => ok(undefined));
    const runReputationAlerts = vi.fn(async () => ok({ sent: 0 }));

    const result = await runScheduledMarketingJobs({ now: NOW, ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 1000 }, {
      ...purgeBudgetDeps(runs, dispatchCampaign),
      jobs: { listRunnableCampaigns: async () => [{ tenantId: 'tenant-1', campaignId: 'campaign-1' }],
        listRetentionTenantIds: async () => ['tenant-1'], listSesIdentityRefreshTenantIds: async () => ['tenant-1'],
        listSesTenantIds: async () => ['tenant-1'] },
      runRetention, refreshIdentity, runReputationAlerts,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal');
    expect(result.error.message).toBe('canceling statement due to statement timeout');
    expect(purge).toHaveBeenCalledTimes(2);
    expect(warnings).toEqual(['[marketing] scheduler run purge stopped reason=purge_failed error=Error/57014']);
    expect(runRetention).toHaveBeenCalledTimes(1);
    expect(refreshIdentity).toHaveBeenCalledTimes(1);
    expect(runReputationAlerts).toHaveBeenCalledTimes(1);
    expect(dispatchCampaign).toHaveBeenCalledTimes(1);
    const [failed] = (await runs.listPage({ kind: 'marketing_maintenance', status: 'failed', limit: 10 })).runs;
    expect(failed?.error).toBe('canceling statement due to statement timeout');
    expect(failed?.idle).toBe(false);
  });

  it.each([
    { name: 'purged scheduler runs', purged: 3, idle: false },
    { name: 'purged nothing', purged: 0, idle: true },
  ])('finalizes a maintenance run that $name with idle=$idle', async ({ purged, idle }) => {
    const runs = new InMemorySchedulerRunRepository();
    vi.spyOn(runs, 'purge').mockResolvedValue({ purged, cancelled: false });

    await runScheduledMarketingJobs({ now: NOW, ...retentionBoundaries,
      sesIdentityRefreshIntervalMs: 1000 }, purgeBudgetDeps(runs, async () => ok(undefined)));

    const [run] = (await runs.listPage({ kind: 'marketing_maintenance', status: 'completed', limit: 10 })).runs;
    expect(run?.idle).toBe(idle);
  });

  it('does not start a purge batch that cannot fit in the remaining budget', async () => {
    vi.useFakeTimers();
    try {
      const runs = new InMemorySchedulerRunRepository();
      const purge = vi.spyOn(runs, 'purge').mockImplementation(async () => {
        vi.advanceTimersByTime(4000);
        return { purged: SCHEDULER_RUN_PURGE_BATCH_SIZE, cancelled: false };
      });
      const dispatchCampaign = vi.fn(async () => ok(undefined));

      const result = await runScheduledMarketingJobs({ now: NOW, ...retentionBoundaries,
        sesIdentityRefreshIntervalMs: 1000 }, purgeBudgetDeps(runs, dispatchCampaign));

      expect(result.ok).toBe(true);
      expect(purge).toHaveBeenCalledTimes(1);
      expect(warnings).toEqual([]);
      expect(dispatchCampaign).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

});
