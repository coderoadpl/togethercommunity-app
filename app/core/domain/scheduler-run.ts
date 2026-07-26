import { z } from 'zod';

const nonNegativeInteger = z.number().int().nonnegative();
const isoDateTime = z.string().datetime();

export const schedulerRunKindSchema = z.enum(['marketing_tick', 'outbox_dispatch']);
export const schedulerRunTriggerSchema = z.enum(['cron', 'dev', 'manual']);
export const schedulerRunStatusSchema = z.enum(['running', 'completed', 'failed']);

export const schedulerRunTotalsSchema = z.object({
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

export type SchedulerRunKind = z.output<typeof schedulerRunKindSchema>;
export type SchedulerRunTrigger = z.output<typeof schedulerRunTriggerSchema>;
export type SchedulerRunStatus = z.output<typeof schedulerRunStatusSchema>;
export type SchedulerRunTotals = z.output<typeof schedulerRunTotalsSchema>;
export type SchedulerRun = z.output<typeof schedulerRunSchema>;
export type SchedulerRunTenant = z.output<typeof schedulerRunTenantSchema>;
