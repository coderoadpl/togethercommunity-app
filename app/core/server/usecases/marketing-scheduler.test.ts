import { describe, expect, it, vi } from 'vitest';

import { err, integrationAuth, ok } from '#core/domain/index.js';

import { InMemorySchedulerRunRepository } from '../testing/marketing-fakes.js';
import { runScheduledMarketingJobs } from './marketing-email.js';

const NOW = '1998-07-22T10:00:00.000Z';
const clock = { nowIso: () => NOW };
let sequence = 0;
const ids = { nextId: () => `maintenance-${String(++sequence)}` };

describe('marketing maintenance scheduling', () => {
  it('runs overdue maintenance after cron delay and waits 30 minutes after a completed pass', async () => {
    const runs = new InMemorySchedulerRunRepository();
    let now = NOW;
    const runRetention = vi.fn(async () => ok(undefined));
    const refreshIdentity = vi.fn(async () => ok(undefined));
    const runReputationAlerts = vi.fn(async () => ok({ sent: 0 }));
    const run = () => runScheduledMarketingJobs({ now, pendingOlderThan: NOW, renderedBodiesOlderThan: NOW,
      engagementOlderThan: NOW, sesIdentityRefreshIntervalMs: 6 * 60 * 60 * 1000 }, {
      jobs: { listRunnableCampaigns: async () => [], listRetentionTenantIds: async () => ['tenant-1'],
        listSesIdentityRefreshTenantIds: async () => ['tenant-1'], listSesTenantIds: async () => ['tenant-1'] },
      runs, ids, clock: { nowIso: () => now }, dispatchCampaign: async () => ok(undefined),
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
    expect((await runs.listPage({ kind: 'marketing_maintenance', status: 'completed', limit: 10 })).runs).toHaveLength(2);
  });

  it.each(['failure', 'deadline'])('retries maintenance on the next tick after %s', async (mode) => {
    const runs = new InMemorySchedulerRunRepository();
    let first = true;
    const runRetention = vi.fn(async () => first && mode === 'failure' ? err(integrationAuth('Unavailable')) : ok(undefined));
    const run = () => runScheduledMarketingJobs({ now: NOW, pendingOlderThan: NOW, renderedBodiesOlderThan: NOW,
      engagementOlderThan: NOW, sesIdentityRefreshIntervalMs: 1000, shouldContinue: () => !(first && mode === 'deadline') }, {
      jobs: { listRunnableCampaigns: async () => [], listRetentionTenantIds: async () => ['tenant-1'],
        listSesIdentityRefreshTenantIds: async () => [], listSesTenantIds: async () => [] },
      runs, ids, clock, dispatchCampaign: async () => ok(undefined), runRetention,
      refreshIdentity: async () => ok(undefined), runReputationAlerts: async () => ok({ sent: 0 }),
    });
    await run();
    expect((await runs.listPage({ kind: 'marketing_maintenance', status: 'failed', limit: 10 })).runs).toHaveLength(1);
    first = false;
    expect((await run()).ok).toBe(true);
    expect((await runs.listPage({ kind: 'marketing_maintenance', status: 'completed', limit: 10 })).runs).toHaveLength(1);
    expect(runRetention).toHaveBeenCalledTimes(mode === 'failure' ? 2 : 1);
  });

});
