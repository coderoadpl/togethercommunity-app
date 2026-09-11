import { and, desc, eq, exists, gte, inArray, lt, ne, or, sql, sum } from 'drizzle-orm';

import {
  schedulerRunSchema,
  schedulerRunCampaignCountsSchema,
  schedulerRunTenantItemSchema,
  schedulerRunTenantSummarySchema,
  schedulerRunTenantSchema,
  type SchedulerRun,
  type SchedulerRunListQuery,
} from '#core/domain/index.js';
import type { SchedulerRunRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { queryCanceled } from './pg-errors.js';
import { campaignSends, schedulerRuns, schedulerRunTenants } from './schema.js';

const rowCount = (result: unknown): number => {
  if (typeof result !== 'object' || result === null || !('rowCount' in result)) {
    throw new Error('Scheduler run purge query did not return a row count');
  }
  if (result.rowCount !== null && typeof result.rowCount !== 'number') {
    throw new Error('Scheduler run purge query returned an invalid row count');
  }
  return result.rowCount ?? 0;
};

const parseRun = (row: typeof schedulerRuns.$inferSelect): SchedulerRun => schedulerRunSchema.parse({
  ...row,
  startedAt: new Date(row.startedAt).toISOString(),
  finishedAt: row.finishedAt === null ? null : new Date(row.finishedAt).toISOString(),
  createdAt: new Date(row.createdAt).toISOString(),
});

const parseTenant = (row: typeof schedulerRunTenants.$inferSelect) => schedulerRunTenantSchema.parse({
  ...row,
  createdAt: new Date(row.createdAt).toISOString(),
});

const encodeCursor = (run: SchedulerRun): string =>
  `${encodeURIComponent(run.startedAt)}~${encodeURIComponent(run.id)}`;

const decodeCursor = (cursor: string): { startedAt: string; id: string } => {
  const [startedAt = '', id = ''] = cursor.split('~');
  return { startedAt: decodeURIComponent(startedAt), id: decodeURIComponent(id) };
};

export const createSchedulerRunRepository = (db: Db): SchedulerRunRepository => {
  const filtersFor = (input: SchedulerRunListQuery, tenantId?: string) => {
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const cursorFilter = cursor === undefined ? undefined : or(
      lt(schedulerRuns.startedAt, cursor.startedAt),
      and(eq(schedulerRuns.startedAt, cursor.startedAt), lt(schedulerRuns.id, cursor.id)),
    );
    return [
      input.kind === undefined ? undefined : eq(schedulerRuns.kind, input.kind),
      input.status === undefined ? undefined : eq(schedulerRuns.status, input.status),
      input.campaignId === undefined ? undefined : exists(
        db.select({ id: campaignSends.id }).from(campaignSends).where(and(
          eq(campaignSends.runId, schedulerRuns.id),
          eq(campaignSends.campaignId, input.campaignId),
          tenantId === undefined ? undefined : eq(campaignSends.tenantId, tenantId),
        )),
      ),
      input.includeIdle === true || tenantId === undefined ? undefined : or(
        ne(schedulerRuns.kind, 'marketing_tick'),
        ne(schedulerRuns.status, 'completed'),
        ne(schedulerRunTenants.batchSize, 0),
        ne(schedulerRunTenants.sent, 0),
        ne(schedulerRunTenants.failed, 0),
        ne(schedulerRunTenants.skipped, 0),
        sql`jsonb_array_length(${schedulerRunTenants.errors}) > 0`,
      ),
      input.since === undefined ? undefined : gte(schedulerRuns.startedAt, input.since),
      cursorFilter,
    ];
  };
  const pageFrom = (rows: SchedulerRun[], limit: number) => {
    const runs = rows.slice(0, limit);
    const last = runs.at(-1);
    return {
      runs,
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last) : null,
    };
  };
  const listGlobal = async (input: SchedulerRunListQuery) => {
    const rows = (await db.select().from(schedulerRuns)
      .where(and(...filtersFor(input)))
      .orderBy(desc(schedulerRuns.startedAt), desc(schedulerRuns.id))
      .limit(input.limit + 1)).map(parseRun);
    return pageFrom(rows, input.limit);
  };
  const listTenant = async (tenantId: string, input: SchedulerRunListQuery) => {
    const selected = await db.select({ run: schedulerRuns, tenant: schedulerRunTenants })
      .from(schedulerRunTenants)
      .innerJoin(schedulerRuns, eq(schedulerRuns.id, schedulerRunTenants.runId))
      .where(and(eq(schedulerRunTenants.tenantId, tenantId), ...filtersFor(input, tenantId)))
      .orderBy(desc(schedulerRuns.startedAt), desc(schedulerRuns.id))
      .limit(input.limit + 1);
    const pageRows = selected.slice(0, input.limit);
    const runIds = pageRows.map(({ run }) => run.id);
    const campaignRows = input.campaignId === undefined || runIds.length === 0 ? [] : await db.select({
      runId: campaignSends.runId,
      sent: sql<number>`count(*) filter (where ${campaignSends.status} = 'sent')::int`,
      failed: sql<number>`count(*) filter (where ${campaignSends.status} = 'failed')::int`,
      skipped: sql<number>`count(*) filter (where ${campaignSends.status} = 'skipped')::int`,
    }).from(campaignSends).where(and(
      eq(campaignSends.tenantId, tenantId),
      eq(campaignSends.campaignId, input.campaignId),
      inArray(campaignSends.runId, runIds),
    )).groupBy(campaignSends.runId);
    const campaignCounts = new Map(campaignRows.flatMap((row) => row.runId === null
      ? []
      : [[row.runId, schedulerRunCampaignCountsSchema.parse(row)]]
    ));
    const items = pageRows.map(({ run, tenant }) => schedulerRunTenantItemSchema.parse({
      run: parseRun(run),
      tenant: parseTenant(tenant),
      campaignCounts: campaignCounts.get(run.id) ?? null,
    }));
    const last = items.at(-1)?.run;
    return {
      items,
      nextCursor: selected.length > input.limit && last !== undefined ? encodeCursor(last) : null,
    };
  };
  return {
    start: async (run) => {
      await db.insert(schedulerRuns).values(schedulerRunSchema.parse(run));
    },
    finalize: async (runId, input) => db.transaction(async (tx) => {
      const [row] = await tx.update(schedulerRuns).set({
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
        status: input.status,
        idle: input.idle,
        error: input.error,
        totals: input.totals,
      }).where(and(eq(schedulerRuns.id, runId), eq(schedulerRuns.status, 'running'))).returning();
      if (row === undefined) return null;
      if (input.tenants.length > 0) {
        await tx.insert(schedulerRunTenants).values(input.tenants.map((tenant) =>
          schedulerRunTenantSchema.parse({ ...tenant, runId })
        ));
      }
      return parseRun(row);
    }),
    listPage: listGlobal,
    getWithTenants: async (runId) => {
      const [row] = await db.select().from(schedulerRuns).where(eq(schedulerRuns.id, runId)).limit(1);
      if (row === undefined) return null;
      const tenants = await db.select().from(schedulerRunTenants)
        .where(eq(schedulerRunTenants.runId, runId))
        .orderBy(desc(schedulerRunTenants.createdAt), desc(schedulerRunTenants.id));
      return { run: parseRun(row), tenants: tenants.map(parseTenant) };
    },
    getForTenant: async (tenantId, runId) => {
      const [row] = await db.select({ run: schedulerRuns, tenant: schedulerRunTenants })
        .from(schedulerRuns)
        .innerJoin(schedulerRunTenants, and(
          eq(schedulerRunTenants.runId, schedulerRuns.id),
          eq(schedulerRunTenants.tenantId, tenantId),
        ))
        .where(eq(schedulerRuns.id, runId))
        .limit(1);
      return row === undefined ? null : schedulerRunTenantItemSchema.parse({
        run: parseRun(row.run),
        tenant: parseTenant(row.tenant),
      });
    },
    listForTenant: listTenant,
    summarizeForTenant: async (tenantId, since) => {
      const [totals] = await db.select({
        runs: sql<number>`count(*)::int`,
        sent: sql<number>`coalesce(${sum(schedulerRunTenants.sent)}, 0)::int`,
        failed: sql<number>`coalesce(${sum(schedulerRunTenants.failed)}, 0)::int`,
      }).from(schedulerRunTenants)
        .innerJoin(schedulerRuns, eq(schedulerRuns.id, schedulerRunTenants.runId))
        .where(and(
          eq(schedulerRunTenants.tenantId, tenantId),
          gte(schedulerRuns.startedAt, since),
        ));
      const latest = await listTenant(tenantId, { includeIdle: true, limit: 1 });
      return schedulerRunTenantSummarySchema.parse({
        runsLast24Hours: totals?.runs ?? 0,
        sentLast24Hours: totals?.sent ?? 0,
        failedLast24Hours: totals?.failed ?? 0,
        lastRun: latest.items[0]?.run ?? null,
      });
    },
    failStale: async (input) => {
      const rows = await db.update(schedulerRuns).set({
        finishedAt: input.finishedAt,
        durationMs: sql<number>`greatest(0, floor(extract(epoch from (${input.finishedAt}::timestamptz - ${schedulerRuns.startedAt})) * 1000))`,
        status: 'failed',
        error: input.error,
      }).where(and(
        eq(schedulerRuns.status, 'running'),
        lt(schedulerRuns.startedAt, input.startedBefore),
      )).returning({ id: schedulerRuns.id });
      return rows.length;
    },
    purge: async (input, options) => {
      try {
        const purged = await db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('statement_timeout', ${String(options.timeoutMs)}, true)`);
          const result = await tx.execute(sql`
            WITH batch AS MATERIALIZED (
              SELECT candidate.id
              FROM ${schedulerRuns} candidate
              WHERE (
                (candidate.idle = true AND candidate.started_at < ${input.idleRunsBefore})
                OR (candidate.idle = false AND candidate.started_at < ${input.runsBefore})
              )
                AND candidate.id NOT IN (
                  SELECT DISTINCT ON (newest.kind) newest.id
                  FROM ${schedulerRuns} newest
                  ORDER BY newest.kind, newest.started_at DESC, newest.id DESC
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM ${campaignSends}
                  WHERE ${campaignSends.runId} = candidate.id
                )
              ORDER BY candidate.started_at, candidate.id
              LIMIT ${options.batchSize}
            )
            DELETE FROM ${schedulerRuns}
            WHERE ${schedulerRuns.id} IN (SELECT id FROM batch)
          `);
          return rowCount(result);
        });
        return { purged, cancelled: false };
      } catch (cause) {
        if (!queryCanceled(cause)) throw cause;
        return { purged: 0, cancelled: true };
      }
    },
  };
};
