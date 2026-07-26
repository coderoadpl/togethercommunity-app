import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

import {
  schedulerRunSchema,
  schedulerRunTenantSchema,
  type SchedulerRun,
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
  const list = async (
    input: { limit: number; cursor?: string },
    tenantId?: string,
  ): Promise<{ runs: SchedulerRun[]; nextCursor: string | null }> => {
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const cursorFilter = cursor === undefined ? undefined : or(
      lt(schedulerRuns.startedAt, cursor.startedAt),
      and(eq(schedulerRuns.startedAt, cursor.startedAt), lt(schedulerRuns.id, cursor.id)),
    );
    const filters = tenantId === undefined
      ? [cursorFilter]
      : [eq(schedulerRunTenants.tenantId, tenantId), cursorFilter];
    const query = db.selectDistinct({ run: schedulerRuns })
      .from(schedulerRuns)
      .leftJoin(schedulerRunTenants, eq(schedulerRunTenants.runId, schedulerRuns.id))
      .where(and(...filters))
      .orderBy(desc(schedulerRuns.startedAt), desc(schedulerRuns.id))
      .limit(input.limit + 1);
    const rows = (await query).map(({ run }) => parseRun(run));
    const runs = rows.slice(0, input.limit);
    const last = runs.at(-1);
    return {
      runs,
      nextCursor: rows.length > input.limit && last !== undefined ? encodeCursor(last) : null,
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
    listPage: (input) => list(input),
    getWithTenants: async (runId) => {
      const [row] = await db.select().from(schedulerRuns).where(eq(schedulerRuns.id, runId)).limit(1);
      if (row === undefined) return null;
      const tenants = await db.select().from(schedulerRunTenants)
        .where(eq(schedulerRunTenants.runId, runId))
        .orderBy(desc(schedulerRunTenants.createdAt), desc(schedulerRunTenants.id));
      return { run: parseRun(row), tenants: tenants.map(parseTenant) };
    },
    listForTenant: (tenantId, input) => list(input, tenantId),
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
