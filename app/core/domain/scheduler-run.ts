import { z } from 'zod';

const nonNegativeInteger = z.number().int().nonnegative();
const isoDateTime = z.string().datetime();

const schedulerRunKindSchema = z.enum(['marketing_tick', 'outbox_dispatch', 'consent_evidence_purge']);
const schedulerRunTriggerSchema = z.enum(['cron', 'dev', 'manual']);
const schedulerRunStatusSchema = z.enum(['running', 'completed', 'failed']);

const schedulerRunTotalsSchema = z.object({
  campaignsTouched: nonNegativeInteger,
  sendsAttempted: nonNegativeInteger,
  sent: nonNegativeInteger,
  failed: nonNegativeInteger,
  skipped: nonNegativeInteger,
  reEnqueued: z.boolean(),
});

export const schedulerRunSchema = z.object({
  id: z.string().min(1),
  kind: schedulerRunKindSchema,
  trigger: schedulerRunTriggerSchema,
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  durationMs: nonNegativeInteger.nullable(),
  status: schedulerRunStatusSchema,
  error: z.string().min(1).nullable(),
  totals: schedulerRunTotalsSchema,
  createdAt: isoDateTime,
}).superRefine((run, ctx) => {
  const finalized = run.finishedAt !== null && run.durationMs !== null;
  if (run.status === 'running' && (finalized || run.error !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Running scheduler runs cannot have completion fields' });
  }
  if (run.status === 'completed' && (!finalized || run.error !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Completed scheduler runs require completion fields without an error' });
  }
  if (run.status === 'failed' && (!finalized || run.error === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Failed scheduler runs require completion fields and an error' });
  }
});

export const schedulerRunTenantSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  tenantId: z.string().min(1),
  campaignsTouched: nonNegativeInteger,
  batchSize: nonNegativeInteger,
  sent: nonNegativeInteger,
  failed: nonNegativeInteger,
  skipped: nonNegativeInteger,
  budgetComputed: nonNegativeInteger,
  budgetUsed: nonNegativeInteger,
  errors: z.array(z.string().min(1)),
  createdAt: isoDateTime,
});

const schedulerRunCursorSchema = z.string().min(1).superRefine((value, ctx) => {
  const parts = value.split('~');
  try {
    if (
      parts.length !== 2
      || !isoDateTime.safeParse(decodeURIComponent(parts[0] ?? '')).success
      || decodeURIComponent(parts[1] ?? '').length === 0
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid scheduler run cursor' });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid scheduler run cursor' });
  }
});

export const schedulerRunListQuerySchema = z.object({
  kind: schedulerRunKindSchema.optional(),
  status: schedulerRunStatusSchema.optional(),
  since: isoDateTime.optional(),
  cursor: schedulerRunCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const schedulerRunTenantItemSchema = z.object({
  run: schedulerRunSchema,
  tenant: schedulerRunTenantSchema,
});

export const schedulerRunTenantSummarySchema = z.object({
  runsLast24Hours: nonNegativeInteger,
  sentLast24Hours: nonNegativeInteger,
  failedLast24Hours: nonNegativeInteger,
  lastRun: schedulerRunSchema.nullable(),
});

export type SchedulerRunKind = z.output<typeof schedulerRunKindSchema>;
export type SchedulerRunTrigger = z.output<typeof schedulerRunTriggerSchema>;
export type SchedulerRunStatus = z.output<typeof schedulerRunStatusSchema>;
export type SchedulerRunTotals = z.output<typeof schedulerRunTotalsSchema>;
export type SchedulerRun = z.output<typeof schedulerRunSchema>;
export type SchedulerRunTenant = z.output<typeof schedulerRunTenantSchema>;
export type SchedulerRunListQuery = z.output<typeof schedulerRunListQuerySchema>;
export type SchedulerRunTenantItem = z.output<typeof schedulerRunTenantItemSchema>;
export type SchedulerRunTenantSummary = z.output<typeof schedulerRunTenantSummarySchema>;
