import {
  appError,
  err,
  listReportsInputSchema,
  notFound,
  ok,
  postReportEventSchema,
  postReportSchema,
  renderPost,
  reportPostInputSchema,
  resolveReportInputSchema,
  toPublicPost,
  validation,
  type AppError,
  type PostReport,
  type ReportQueue,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { MemberRepository, PostReportRepository } from '../ports.js';
import { lessonContextAccess, requireActor, requireUnbannedMember, spaceContextAccess } from './community-access.js';
import { deletePost, type CommunityDeps } from './community.js';
export { openHeuristicReport } from './moderation-heuristics.js';

export interface ModerationDeps extends CommunityDeps {
  reports: PostReportRepository;
  members: MemberRepository;
}

const postAccess = async (
  ctx: Ctx,
  post: { contextKind: 'lesson' | 'space'; contextId: string },
  deps: ModerationDeps,
): Promise<Result<void, AppError>> => {
  if (post.contextKind === 'lesson') return lessonContextAccess(ctx, post.contextId, deps);
  const space = await spaceContextAccess(ctx, post.contextId, deps);
  return space.ok ? ok(undefined) : space;
};

export const reportPost = async (
  ctx: Ctx,
  input: unknown,
  deps: ModerationDeps,
): Promise<Result<PostReport, AppError>> => {
  const actor = requireUnbannedMember(ctx, 'community:report');
  if (!actor.ok) return actor;
  const parsed = reportPostInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid report payload', parsed.error.flatten()));
  const post = await deps.posts.findById(actor.value.tenantId, parsed.data.postId);
  if (post === null || post.deletedAt !== null) return err(notFound('Post not found'));
  const access = await postAccess(ctx, post, deps);
  if (!access.ok) return access;
  if (post.authorUserId === actor.value.userId) return err(validation('You cannot report your own post'));
  const now = deps.clock.nowIso();
  const report = postReportSchema.parse({
    id: deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    postId: post.id,
    reporterUserId: actor.value.userId,
    reporterDisplay: ctx.identity.name.trim() || ctx.identity.email,
    source: 'member',
    reason: parsed.data.reason,
    note: parsed.data.note?.trim() || null,
    signals: null,
    status: 'open',
    createdAt: now,
    resolvedAt: null,
    resolvedByUserId: null,
  });
  const event = postReportEventSchema.parse({
    id: deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    reportId: report.id,
    postId: post.id,
    type: 'opened',
    occurredAt: now,
  });
  const opened = await deps.reports.open(actor.value.tenantId, report, event);
  return opened === null
    ? err(appError('conflict', 'You have already reported this post'))
    : ok(opened);
};

export const listReports = async (
  ctx: Ctx,
  input: unknown,
  deps: ModerationDeps,
): Promise<Result<ReportQueue, AppError>> => {
  const actor = requireActor(ctx, 'community:report:read');
  if (!actor.ok) return actor;
  const parsed = listReportsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid reports query', parsed.error.flatten()));
  const listed = await deps.reports.listByStatus(actor.value.tenantId, {
    status: parsed.data.status,
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
  const posts = await Promise.all(
    listed.reports.map((report) => deps.posts.findById(actor.value.tenantId, report.postId)),
  );
  const counts = await deps.reports.countOpenByPost(
    actor.value.tenantId,
    listed.reports.map((report) => report.postId),
  );
  const items = await Promise.all(listed.reports.flatMap((report, index) => {
    const post = posts[index];
    if (post === null || post === undefined) return [];
    return [async () => ({
      report,
      post: toPublicPost(renderPost(post), actor.value.userId),
      spaceName: post.contextKind === 'space'
        ? (await deps.spaces.findById(actor.value.tenantId, post.contextId))?.name ?? null
        : null,
      openReportsForPost: Math.max(1, counts.get(post.id) ?? 0),
    })];
  }).map((hydrate) => hydrate()));
  return ok({
    items,
    nextCursor: listed.nextCursor,
    openCount: await deps.reports.countOpen(actor.value.tenantId),
  });
};

export const resolveReport = async (
  ctx: Ctx,
  input: unknown,
  deps: ModerationDeps,
): Promise<Result<PostReport, AppError>> => {
  const actor = requireActor(ctx, 'community:moderate');
  if (!actor.ok) return actor;
  const parsed = resolveReportInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid report resolution', parsed.error.flatten()));
  const report = await deps.reports.findById(actor.value.tenantId, parsed.data.reportId);
  if (report === null) return err(notFound('Report not found'));
  const now = deps.clock.nowIso();
  if (parsed.data.action === 'dismiss') {
    const event = postReportEventSchema.parse({
      id: deps.ids.nextId(),
      tenantId: actor.value.tenantId,
      reportId: report.id,
      postId: report.postId,
      type: 'dismissed',
      occurredAt: now,
    });
    const resolved = await deps.reports.resolve(actor.value.tenantId, {
      id: report.id,
      status: 'dismissed',
      resolvedAt: now,
      resolvedByUserId: actor.value.userId,
    }, event);
    return resolved === null ? err(notFound('Open report not found')) : ok(resolved);
  }
  const deleted = await deletePost(ctx, { id: report.postId }, deps);
  if (!deleted.ok) return deleted;
  await deps.reports.resolveAllForPost(actor.value.tenantId, {
    postId: report.postId,
    resolvedAt: now,
    resolvedByUserId: actor.value.userId,
  }, (reportId) => postReportEventSchema.parse({
    id: deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    reportId,
    postId: report.postId,
    type: 'post_removed',
    occurredAt: now,
  }));
  const resolved = await deps.reports.findById(actor.value.tenantId, report.id);
  return resolved === null ? err(notFound('Report not found')) : ok(resolved);
};
