import { describe, expect, it } from 'vitest';

import {
  schedulerRunSchema,
  schedulerRunTenantSchema,
} from './scheduler-run.js';

describe('scheduler run domain', () => {
  it('parses running and finalized operational telemetry', () => {
    const running = schedulerRunSchema.parse({
      id: 'run-1',
      kind: 'marketing_tick',
      trigger: 'cron',
      startedAt: '2026-07-26T10:00:00.000Z',
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
      createdAt: '2026-07-26T10:00:00.000Z',
    });
    expect(running.status).toBe('running');
    expect(schedulerRunSchema.parse({
      ...running,
      finishedAt: '2026-07-26T10:00:01.250Z',
      durationMs: 1250,
      status: 'completed',
    }).durationMs).toBe(1250);
  });

  it('requires completed tenant metrics to be non-negative', () => {
    expect(() => schedulerRunTenantSchema.parse({
      id: 'run-tenant-1',
      runId: 'run-1',
      tenantId: 'tenant-1',
      campaignsTouched: 1,
      batchSize: 10,
      sent: 8,
      failed: 1,
      skipped: 1,
      budgetComputed: 10,
      budgetUsed: 10,
      errors: [],
      createdAt: '2026-07-26T10:00:00.000Z',
    })).not.toThrow();
    expect(() => schedulerRunTenantSchema.parse({
      id: 'run-tenant-1',
      runId: 'run-1',
      tenantId: 'tenant-1',
      campaignsTouched: 0,
      batchSize: -1,
      sent: 0,
      failed: 0,
      skipped: 0,
      budgetComputed: 0,
      budgetUsed: 0,
      errors: [],
      createdAt: '2026-07-26T10:00:00.000Z',
    })).toThrow();
  });

  it('rejects run states without matching completion fields', () => {
    const running = {
      id: 'run-1',
      kind: 'outbox_dispatch',
      trigger: 'dev',
      startedAt: '2026-07-26T10:00:00.000Z',
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
      createdAt: '2026-07-26T10:00:00.000Z',
    };
    expect(() => schedulerRunSchema.parse({
      ...running,
      status: 'completed',
    })).toThrow();
    expect(() => schedulerRunSchema.parse({
      ...running,
      status: 'failed',
      finishedAt: '2026-07-26T10:00:01.000Z',
      durationMs: 1000,
    })).toThrow();
    expect(() => schedulerRunSchema.parse({
      ...running,
      finishedAt: '2026-07-26T10:00:01.000Z',
      durationMs: 1000,
    })).toThrow();
  });
});
