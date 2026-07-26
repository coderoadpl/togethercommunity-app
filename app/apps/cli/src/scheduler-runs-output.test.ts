import { describe, expect, it } from 'vitest';

import type { SchedulerRun, SchedulerRunTenant } from '@core/domain/index.js';

import { formatSchedulerRun, formatSchedulerRuns } from './scheduler-runs-output.js';

const run: SchedulerRun = {
  id: 'run-1',
  kind: 'outbox_dispatch',
  trigger: 'cron',
  startedAt: '2026-07-26T10:00:00.000Z',
  finishedAt: '2026-07-26T10:00:01.000Z',
  durationMs: 1000,
  status: 'completed',
  error: null,
  totals: {
    campaignsTouched: 0,
    sendsAttempted: 5,
    sent: 4,
    failed: 1,
    skipped: 0,
    reEnqueued: false,
  },
  createdAt: '2026-07-26T10:00:00.000Z',
};

const tenant: SchedulerRunTenant = {
  id: 'tenant-row-1',
  runId: 'run-1',
  tenantId: 'tenant-a',
  campaignsTouched: 0,
  batchSize: 5,
  sent: 4,
  failed: 1,
  skipped: 0,
  budgetComputed: 25,
  budgetUsed: 5,
  errors: ['SES rejected'],
  createdAt: '2026-07-26T10:00:01.000Z',
};

describe('scheduler run CLI output', () => {
  it('shows global totals in list output', () => {
    const output = formatSchedulerRuns([run]);
    expect(output).toContain('run-1');
    expect(output).toContain('campaigns');
    expect(output).toContain('attempted');
    expect(output).toContain('re_enqueued');
    expect(output).toContain('\t5\t4\t1\t0\tfalse');
  });

  it('shows the full per-tenant breakdown', () => {
    const output = formatSchedulerRun({ run, tenants: [tenant] });
    expect(output).toContain('tenant-a');
    expect(output).toContain('campaigns 0');
    expect(output).toContain('attempted 5');
    expect(output).toContain('re-enqueued no');
    expect(output).toContain('budget 5/25');
    expect(output).toContain('SES rejected');
  });
});
