import type { SchedulerRun, SchedulerRunTenant } from '#core/domain/index.js';

const row = (values: Array<string | number | boolean>): string => values.map(String).join('\t');

export const formatSchedulerRuns = (runs: SchedulerRun[]): string =>
  runs.length === 0
    ? 'no scheduler runs'
    : [
        row([
          'id',
          'kind',
          'trigger',
          'started',
          'duration_ms',
          'status',
          'campaigns',
          'attempted',
          'sent',
          'failed',
          'skipped',
          're_enqueued',
        ]),
        ...runs.map((run) => row([
          run.id,
          run.kind,
          run.trigger,
          run.startedAt,
          run.durationMs ?? '—',
          run.status,
          run.totals.campaignsTouched,
          run.totals.sendsAttempted,
          run.totals.sent,
          run.totals.failed,
          run.totals.skipped,
          run.totals.reEnqueued,
        ])),
      ].join('\n');

const formatTenant = (tenant: SchedulerRunTenant): string => [
  `${tenant.tenantId}: campaigns ${String(tenant.campaignsTouched)}, batch ${String(tenant.batchSize)}, `
    + `budget ${String(tenant.budgetUsed)}/${String(tenant.budgetComputed)}, `
    + `sent ${String(tenant.sent)}, failed ${String(tenant.failed)}, skipped ${String(tenant.skipped)}`
    + (tenant.purged === undefined || tenant.purged === null ? '' : `, purged ${String(tenant.purged)}`),
  ...(tenant.errors.length === 0 ? [] : tenant.errors.map((error) => `  error: ${error}`)),
].join('\n');

export const formatSchedulerRun = (input: { run: SchedulerRun; tenants: SchedulerRunTenant[] }): string => [
  `${input.run.id} ${input.run.kind} ${input.run.trigger} ${input.run.status}`,
  `started ${input.run.startedAt} · duration ${String(input.run.durationMs ?? '—')} ms`,
  `totals: campaigns ${String(input.run.totals.campaignsTouched)}, attempted ${String(input.run.totals.sendsAttempted)}, `
    + `sent ${String(input.run.totals.sent)}, failed ${String(input.run.totals.failed)}, `
    + `skipped ${String(input.run.totals.skipped)}, re-enqueued ${input.run.totals.reEnqueued ? 'yes' : 'no'}`,
  ...(input.run.error === null ? [] : [`error: ${input.run.error}`]),
  input.tenants.length === 0 ? 'no tenants touched' : input.tenants.map(formatTenant).join('\n'),
].join('\n');
