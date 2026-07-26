import { and, desc, eq, gte, lt, or, sql, sum } from 'drizzle-orm';

import {
  schedulerRunSchema,
  schedulerRunTenantItemSchema,
  schedulerRunTenantSummarySchema,
  schedulerRunTenantSchema,
  type SchedulerRun,
  type SchedulerRunListQuery,
} from '@core/domain/index.js';
import type { SchedulerRunRepository } from '@core/server/index.js';

import type { Db } from './client.js';
import { schedulerRuns, schedulerRunTenants } from './schema.js';

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
  const filtersFor = (input: SchedulerRunListQuery) => {
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const cursorFilter = cursor === undefined ? undefined : or(
      lt(schedulerRuns.startedAt, cursor.startedAt),
      and(eq(schedulerRuns.startedAt, cursor.startedAt), lt(schedulerRuns.id, cursor.id)),
    );
    return [
      input.kind === undefined ? undefined : eq(schedulerRuns.kind, input.kind),
      input.status === undefined ? undefined : eq(schedulerRuns.status, input.status),
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
      .where(and(eq(schedulerRunTenants.tenantId, tenantId), ...filtersFor(input)))
      .orderBy(desc(schedulerRuns.startedAt), desc(schedulerRuns.id))
      .limit(input.limit + 1);
    const items = selected.slice(0, input.limit).map(({ run, tenant }) => ({
      run: parseRun(run),
      tenant: parseTenant(tenant),
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
      const latest = await listTenant(tenantId, { limit: 1 });
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
  };
};
