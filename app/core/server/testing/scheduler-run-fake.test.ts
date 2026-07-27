import { describe, expect, it } from 'vitest';

import { InMemorySchedulerRunRepository } from './marketing-fakes.js';

const NOW = '2026-07-26T10:00:00.000Z';

describe('in-memory scheduler run repository', () => {
  it('finalizes once and keyset-lists runs with tenant metrics', async () => {
    const repository = new InMemorySchedulerRunRepository();
    await repository.start({
      id: 'run-1',
      kind: 'marketing_tick',
      trigger: 'cron',
      startedAt: NOW,
      finishedAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      totals: {
        campaignsTouched: 0,
        sendsAttempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        reEnqueued: false,
      },
      createdAt: NOW,
    });
    const finalized = await repository.finalize('run-1', {
      finishedAt: '2026-07-26T10:00:01.000Z',
      durationMs: 1000,
      status: 'completed',
      error: null,
      totals: {
        campaignsTouched: 1,
        sendsAttempted: 2,
        sent: 1,
        failed: 1,
        skipped: 0,
        reEnqueued: false,
      },
      tenants: [{
        id: 'run-tenant-1',
        runId: 'run-1',
        tenantId: 'tenant-1',
        campaignsTouched: 1,
        batchSize: 2,
        sent: 1,
        failed: 1,
        skipped: 0,
        budgetComputed: 2,
        budgetUsed: 2,
        errors: ['SES unavailable'],
        createdAt: NOW,
      }],
    });
    expect(finalized?.status).toBe('completed');
    expect(await repository.finalize('run-1', {
      finishedAt: NOW,
      durationMs: 0,
      status: 'failed',
      error: 'late',
      totals: finalized?.totals ?? {
        campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0, reEnqueued: false,
      },
      tenants: [],
    })).toBeNull();
    await expect(repository.getWithTenants('run-1')).resolves.toMatchObject({
      run: { status: 'completed' },
      tenants: [{ tenantId: 'tenant-1', budgetUsed: 2 }],
    });
    await expect(repository.listForTenant('tenant-1', { limit: 10 })).resolves.toMatchObject({
      items: [{ run: { id: 'run-1' }, tenant: { tenantId: 'tenant-1' } }],
      nextCursor: null,
    });
  });

  it('fails stale running rows without touching completed rows', async () => {
    const repository = new InMemorySchedulerRunRepository();
    for (const id of ['stale', 'fresh']) {
      await repository.start({
        id,
        kind: 'outbox_dispatch',
        trigger: 'dev',
        startedAt: id === 'stale' ? '2026-07-26T09:00:00.000Z' : NOW,
        finishedAt: null,
        durationMs: null,
        status: 'running',
        error: null,
        totals: {
          campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0, reEnqueued: false,
        },
        createdAt: id === 'stale' ? '2026-07-26T09:00:00.000Z' : NOW,
      });
    }
    await expect(repository.failStale({
      startedBefore: '2026-07-26T09:30:00.000Z',
      finishedAt: NOW,
      error: 'Scheduler run exceeded its timeout',
    })).resolves.toBe(1);
    await expect(repository.getWithTenants('stale')).resolves.toMatchObject({
      run: { status: 'failed', durationMs: 3_600_000 },
    });
    await expect(repository.getWithTenants('fresh')).resolves.toMatchObject({
      run: { status: 'running' },
    });
  });
});
