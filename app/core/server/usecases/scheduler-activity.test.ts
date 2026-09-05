import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';
import { InMemorySchedulerRunRepository } from '../testing/marketing-fakes.js';

import {
  getSchedulerRunForTenant,
  listGlobalSchedulerRuns,
  listSchedulerRunsForTenant,
} from './scheduler-activity.js';

const identity = (tenantId: string | null = 'tenant-a'): Identity => ({
  userId: 'staff-a',
  email: 'staff@example.test',
  name: 'Staff',
  emailVerified: true,
  tenantId,
  tenantSlug: tenantId === null ? null : 'tenant-a',
  tenantName: tenantId === null ? null : 'Tenant A',
  staffRole: tenantId === null ? null : 'admin',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
});

const seedRun = async (
  repository: InMemorySchedulerRunRepository,
  input: {
    id: string;
    kind: 'marketing_tick' | 'outbox_dispatch';
    startedAt: string;
    status: 'completed' | 'failed';
    tenants: Array<{ tenantId: string; sent: number; failed: number; skipped: number }>;
  },
) => {
  await repository.start({
    id: input.id,
    kind: input.kind,
    trigger: 'cron',
    startedAt: input.startedAt,
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
    createdAt: input.startedAt,
  });
  await repository.finalize(input.id, {
    finishedAt: new Date(Date.parse(input.startedAt) + 250).toISOString(),
    durationMs: 250,
    status: input.status,
    error: input.status === 'failed' ? 'scheduler failed' : null,
    totals: {
      campaignsTouched: input.kind === 'marketing_tick' ? input.tenants.length : 0,
      sendsAttempted: input.tenants.reduce((total, tenant) => total + tenant.sent + tenant.failed, 0),
      sent: input.tenants.reduce((total, tenant) => total + tenant.sent, 0),
      failed: input.tenants.reduce((total, tenant) => total + tenant.failed, 0),
      skipped: input.tenants.reduce((total, tenant) => total + tenant.skipped, 0),
      reEnqueued: false,
    },
    tenants: input.tenants.map((tenant, index) => ({
      id: `${input.id}:tenant:${String(index)}`,
      runId: input.id,
      tenantId: tenant.tenantId,
      campaignsTouched: input.kind === 'marketing_tick' ? 1 : 0,
      batchSize: tenant.sent + tenant.failed + tenant.skipped,
      sent: tenant.sent,
      failed: tenant.failed,
      skipped: tenant.skipped,
      budgetComputed: 20,
      budgetUsed: tenant.sent + tenant.failed,
      errors: tenant.failed > 0 ? ['SES rejected'] : [],
      createdAt: input.startedAt,
    })),
  });
};

describe('scheduler activity', () => {
  it('requires the declared scheduler read capability', async () => {
    const runs = new InMemorySchedulerRunRepository();
    expect(await listSchedulerRunsForTenant(
      { identity: identity(), capabilities: ['scheduler:dispatch'] },
      { limit: 25 },
      { runs, clock: { nowIso: () => '2026-07-26T10:00:00.000Z' } },
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('returns only runs that touched the active tenant with tenant counts and a 24 hour summary', async () => {
    const runs = new InMemorySchedulerRunRepository();
    await seedRun(runs, {
      id: 'recent-a',
      kind: 'marketing_tick',
      startedAt: '2026-07-26T09:00:00.000Z',
      status: 'completed',
      tenants: [
        { tenantId: 'tenant-a', sent: 3, failed: 1, skipped: 2 },
        { tenantId: 'tenant-b', sent: 7, failed: 0, skipped: 0 },
      ],
    });
    await seedRun(runs, {
      id: 'other-tenant',
      kind: 'outbox_dispatch',
      startedAt: '2026-07-26T08:00:00.000Z',
      status: 'completed',
      tenants: [{ tenantId: 'tenant-b', sent: 4, failed: 0, skipped: 0 }],
    });
    await seedRun(runs, {
      id: 'old-a',
      kind: 'outbox_dispatch',
      startedAt: '2026-07-24T08:00:00.000Z',
      status: 'failed',
      tenants: [{ tenantId: 'tenant-a', sent: 1, failed: 2, skipped: 0 }],
    });

    const result = await listSchedulerRunsForTenant(
      { identity: identity() },
      { limit: 25 },
      { runs, clock: { nowIso: () => '2026-07-26T10:00:00.000Z' } },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        summary: {
          runsLast24Hours: 1,
          sentLast24Hours: 3,
          failedLast24Hours: 1,
          lastRun: { id: 'recent-a', status: 'completed' },
        },
        items: [
          { run: { id: 'recent-a' }, tenant: { tenantId: 'tenant-a', sent: 3, failed: 1, skipped: 2 } },
          { run: { id: 'old-a' }, tenant: { tenantId: 'tenant-a' } },
        ],
        nextCursor: null,
      },
    });
    if (result.ok) expect(result.value).not.toHaveProperty('runs');
  });

  it('enforces tenant scope on detail and supports global operator filters', async () => {
    const runs = new InMemorySchedulerRunRepository();
    await seedRun(runs, {
      id: 'failed-global',
      kind: 'outbox_dispatch',
      startedAt: '2026-07-26T09:00:00.000Z',
      status: 'failed',
      tenants: [
        { tenantId: 'tenant-a', sent: 1, failed: 1, skipped: 0 },
        { tenantId: 'tenant-b', sent: 2, failed: 0, skipped: 0 },
      ],
    });

    await expect(getSchedulerRunForTenant(
      { identity: identity('tenant-b') },
      { runId: 'failed-global' },
      { runs },
    )).resolves.toMatchObject({
      ok: true,
      value: { run: { id: 'failed-global' }, tenant: { tenantId: 'tenant-b' } },
    });
    await expect(getSchedulerRunForTenant(
      { identity: identity('tenant-c') },
      { runId: 'failed-global' },
      { runs },
    )).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(listGlobalSchedulerRuns({
      kind: 'outbox_dispatch',
      status: 'failed',
      since: '2026-07-26T08:30:00.000Z',
      limit: 10,
    }, { runs })).resolves.toMatchObject({
      ok: true,
      value: { runs: [{ id: 'failed-global', totals: { sent: 3, failed: 1 } }] },
    });
  });
});
