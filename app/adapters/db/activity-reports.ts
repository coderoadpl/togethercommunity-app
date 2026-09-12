import { sql, type SQL } from 'drizzle-orm';
import { activitySummarySchema, memberActivityRowSchema, type ActivitySummaryQuery } from '#core/domain/index.js';
import type { ActivityReportRepository } from '#core/server/index.js';
import type { Db } from './client.js';

const activity = (tenantId: string, query: ActivitySummaryQuery, patterns = '') => sql`
  with tenant_members as (
    select id, display_name, email from members
    where tenant_id = ${tenantId} and deleted_at is null
      and not exists (
        select 1 from unnest(string_to_array(${patterns}, ',')) pattern
        where pattern <> '' and email ilike pattern
      )
  ), activity as (
    select e.member_id, e.occurred_at::timestamptz at time zone 'UTC' at, 'sign-in' kind, null::text course_id
    from member_events e join tenant_members m on m.id = e.member_id
    where e.tenant_id = ${tenantId} and e.type = 'sign-in'
      and e.occurred_at::timestamptz >= ${query.from}::timestamptz
      and e.occurred_at::timestamptz < ${query.to}::timestamptz
    union all
    select p.member_id, p.updated_at::timestamptz at time zone 'UTC', 'progress', p.course_id
    from member_course_progress p join tenant_members m on m.id = p.member_id
    where p.tenant_id = ${tenantId} and p.updated_at::timestamptz >= ${query.from}::timestamptz
      and p.updated_at::timestamptz < ${query.to}::timestamptz
    union all
    select e.member_id, e.occurred_at::timestamptz at time zone 'UTC', 'completion', null::text
    from member_events e join tenant_members m on m.id = e.member_id
    where e.tenant_id = ${tenantId} and e.type = 'lesson-completion'
      and e.occurred_at::timestamptz >= ${query.from}::timestamptz
      and e.occurred_at::timestamptz < ${query.to}::timestamptz
  )`;

const databaseErrorCode = (error: unknown): string | undefined => {
  const cause: unknown = error instanceof Error ? error.cause : error;
  const code: unknown = typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'code') : undefined;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code) ? code : undefined;
};

const readReport = async (db: Db, query: SQL): Promise<unknown> => {
  try {
    return await db.execute(query);
  } catch (error) {
    // Keep SQLSTATE for diagnosis without exposing driver messages or bound email filters.
    const code = databaseErrorCode(error);
    throw new Error('Activity report database query failed', code !== undefined
      ? { cause: new Error(`PostgreSQL SQLSTATE ${code}`) }
      : undefined);
  }
};

export const createActivityReportRepository = (db: Db): ActivityReportRepository => ({
  activitySummary: async (tenantId, query) => {
    const result = await readReport(db, sql`${activity(tenantId, query)}, days as (
      select to_char(at, 'YYYY-MM-DD') as day,
        count(*) filter (where kind = 'sign-in')::int "signIns",
        count(distinct member_id) filter (where kind = 'sign-in')::int "distinctSignInMembers",
        count(*) filter (where kind = 'progress')::int "progressUpdates",
        count(distinct member_id) filter (where kind = 'progress')::int "distinctProgressMembers",
        count(*) filter (where kind = 'completion')::int "lessonCompletions"
      from activity group by 1
    ) select json_build_object(
      'days', coalesce((select json_agg(days order by day) from days), '[]'::json),
      'totals', json_build_object(
        'membersTotal', (select count(*)::int from tenant_members),
        'membersActive', (select count(distinct member_id)::int from activity where kind <> 'completion')
      )
    ) report`);
    const rows: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, 'rows') : undefined;
    const first: unknown = Array.isArray(rows) ? rows[0] : undefined;
    return activitySummarySchema.parse(typeof first === 'object' && first !== null ? Reflect.get(first, 'report') : undefined);
  },
  memberActivity: async (tenantId, query) => {
    const pivot = sql`${query.pivot}::timestamptz at time zone 'UTC'`;
    const result = await readReport(db, sql`${activity(tenantId, query, query.excludeEmailPatterns)}, selected as (
      select member_id from activity where kind <> 'completion' and member_id > ${query.cursor}
      group by member_id order by member_id limit ${query.limit + 1}
    ) select m.id "memberId", m.display_name "displayName", m.email,
      count(*) filter (where kind = 'sign-in' and at < ${pivot})::int "signInsBefore",
      count(*) filter (where kind = 'sign-in' and at >= ${pivot})::int "signInsAfter",
      to_char(min(at) filter (where kind = 'sign-in'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') "firstSignIn",
      to_char(max(at) filter (where kind = 'sign-in'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') "lastSignIn",
      count(*) filter (where kind = 'progress' and at < ${pivot})::int "progressBefore",
      count(*) filter (where kind = 'progress' and at >= ${pivot})::int "progressAfter",
      count(distinct course_id) filter (where kind = 'progress')::int "coursesTouched",
      count(*) filter (where kind = 'completion')::int "lessonsCompletedTotal",
      to_char(max(at) filter (where kind = 'progress'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') "lastProgress",
      count(*) filter (where kind = 'completion' and at < ${pivot})::int "completionsBefore",
      count(*) filter (where kind = 'completion' and at >= ${pivot})::int "completionsAfter"
    from selected s join tenant_members m on m.id = s.member_id join activity a on a.member_id = m.id
    group by m.id, m.display_name, m.email order by m.id`);
    const rows = memberActivityRowSchema.array().parse(typeof result === 'object' && result !== null ? Reflect.get(result, 'rows') : undefined);
    const members = rows.slice(0, query.limit);
    return { members, nextCursor: rows.length > query.limit ? members.at(-1)?.memberId ?? null : null };
  },
});
