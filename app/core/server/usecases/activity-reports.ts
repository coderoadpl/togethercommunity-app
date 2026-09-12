import { ok, type ActivitySummaryQuery, type MemberActivityQuery } from '#core/domain/index.js';
import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { ActivityReportRepository } from '../ports.js';

export const getActivitySummary = async (ctx: Ctx, query: ActivitySummaryQuery, deps: { activityReports: ActivityReportRepository }) => {
  const tenant = authorizeTenant(ctx, 'report:read');
  if (!tenant.ok) return tenant;
  return ok(await deps.activityReports.activitySummary(tenant.value, query));
};

export const getMemberActivity = async (ctx: Ctx, query: MemberActivityQuery, deps: { activityReports: ActivityReportRepository }) => {
  const tenant = authorizeTenant(ctx, 'report:read');
  if (!tenant.ok) return tenant;
  return ok(await deps.activityReports.memberActivity(tenant.value, query));
};
