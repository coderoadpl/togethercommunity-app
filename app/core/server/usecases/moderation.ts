import {
  DM_REPORT_SNAPSHOT_SIZE,
  appError,
  dmParticipants,
  dmReportReceiptOf,
  dmReportSchema,
  err,
  internal,
  listDmReportsInputSchema,
  listReportsInputSchema,
  notFound,
  ok,
  otherDmParticipant,
  postReportEventSchema,
  postReportSchema,
  renderPost,
  reportDmConversationInputSchema,
  reportPostInputSchema,
  resolveDmReportInputSchema,
  resolveReportInputSchema,
  toPublicPost,
  validation,
  type AppError,
  type DmReport,
  type DmReportMessage,
  type DmReportQueue,
  type DmReportReceipt,
  type Notification,
  type PostReport,
  type ReportQueue,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  DmConversationRepository,
  DmMessageRepository,
  DmReportRepository,
  MemberRepository,
  PostReportRepository,
  RealtimeBusPort,
  TenantRepository,
  UserDisplayReader,
} from '../ports.js';
import { lessonContextAccess, requireActor, requireUnbannedMember, spaceContextAccess } from './community-access.js';
import { deletePost, resolveActorDisplay, resolveAuthorDisplay, type CommunityDeps } from './community.js';
import { requireDirectMessages } from './direct-messages.js';
export { openHeuristicReport } from './moderation-heuristics.js';

export interface ModerationDeps extends CommunityDeps {
  reports: PostReportRepository;
  members: MemberRepository;
  dmReports: DmReportRepository;
  dmConversations: DmConversationRepository;
  dmMessages: DmMessageRepository;
  tenants: TenantRepository;
  userDisplays: UserDisplayReader;
  realtimeBus: RealtimeBusPort;
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
  const postIds = [...new Set(listed.reports.map((report) => report.postId))];
  const [posts, spaces, counts, openCount] = await Promise.all([
    deps.posts.findByIds(actor.value.tenantId, postIds),
    deps.spaces.list(actor.value.tenantId),
    deps.reports.countOpenByPost(actor.value.tenantId, postIds),
    deps.reports.countOpen(actor.value.tenantId),
  ]);
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const spacesById = new Map(spaces.map((space) => [space.id, space]));
  const items = [];
  for (const report of listed.reports) {
    const post = postsById.get(report.postId);
    if (post === undefined) continue;
    items.push({
      report,
      post: toPublicPost(renderPost(post), actor.value.userId),
      spaceName: post.contextKind === 'space'
        ? spacesById.get(post.contextId)?.name ?? null
        : null,
      openReportsForPost: counts.get(post.id) ?? 0,
    });
  }
  return ok({
    items,
    nextCursor: listed.nextCursor,
    openCount,
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

const dmDisplayNames = async (
  tenantId: string,
  userIds: readonly string[],
  deps: ModerationDeps,
): Promise<Map<string, string>> => {
  const ids = [...userIds];
  const [names, members] = await Promise.all([
    deps.userDisplays.findDisplayNames(tenantId, ids),
    Promise.all(ids.map((userId) => deps.tenantAccess.findMember(tenantId, userId))),
  ]);
  return new Map(
    ids.map((userId, index) => {
      const member = members[index] ?? null;
      const override = member?.displayName?.trim() ?? '';
      return [
        userId,
        override.length > 0
          ? override
          : resolveAuthorDisplay({ name: names.get(userId) ?? null, email: member?.email ?? null }),
      ];
    }),
  );
};

const notifyStaffOfDmReport = async (
  report: DmReport,
  deps: ModerationDeps,
): Promise<void> => {
  const staff = await deps.tenantAccess.listStaffForTenant(report.tenantId);
  const recipients = staff.filter((member) => member.userId !== report.reporterUserId);
  if (recipients.length === 0) return;
  const notifications: Notification[] = recipients.map((member) => ({
    id: deps.ids.nextId(),
    tenantId: report.tenantId,
    recipientUserId: member.userId,
    kind: 'dm-report',
    payload: {
      rootPostId: report.id,
      postId: report.id,
      contextKind: 'dm',
      contextId: report.conversationId,
      courseId: null,
      eventId: null,
      domain: null,
      lessonName: report.reportedDisplay,
      authorDisplay: report.reporterDisplay,
      authorAvatarUrl: null,
      snippet: '',
    },
    sourceKey: `dm-report:${report.id}`,
    readAt: null,
    createdAt: report.createdAt,
  }));
  const inserted = await deps.notifications.insertMany(report.tenantId, notifications);
  for (const notification of inserted) {
    deps.realtimeBus.publish({
      kind: 'notification',
      tenantId: notification.tenantId,
      recipientUserId: notification.recipientUserId,
      notificationId: notification.id,
      createdAt: notification.createdAt,
    });
  }
};

export const reportDmConversation = async (
  ctx: Ctx,
  input: unknown,
  deps: ModerationDeps,
): Promise<Result<DmReportReceipt, AppError>> => {
  const actor = requireUnbannedMember(ctx, 'community:report');
  if (!actor.ok) return actor;
  const enabled = await requireDirectMessages(actor.value.tenantId, deps);
  if (!enabled.ok) return enabled;
  const parsed = reportDmConversationInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid report payload', parsed.error.flatten()));
  const conversation = await deps.dmConversations.findById(
    actor.value.tenantId,
    parsed.data.conversationId,
  );
  if (conversation === null || !dmParticipants(conversation).includes(actor.value.userId)) {
    return err(notFound('Conversation not found'));
  }
  const reportedUserId = otherDmParticipant(conversation, actor.value.userId);
  const [{ messages }, displays, reporterDisplay] = await Promise.all([
    deps.dmMessages.listForConversation(actor.value.tenantId, {
      conversationId: conversation.id,
      limit: DM_REPORT_SNAPSHOT_SIZE,
    }),
    dmDisplayNames(actor.value.tenantId, [reportedUserId], deps),
    resolveActorDisplay(ctx.identity, deps),
  ]);
  const reportedDisplay = displays.get(reportedUserId) ?? resolveAuthorDisplay({});
  const snapshot: DmReportMessage[] = [...messages].reverse().map((message) => ({
    id: message.id,
    senderDisplay: message.senderUserId === actor.value.userId ? reporterDisplay : reportedDisplay,
    senderIsReporter: message.senderUserId === actor.value.userId,
    body: message.body,
    createdAt: message.createdAt,
  }));
  const report = dmReportSchema.safeParse({
    id: deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    conversationId: conversation.id,
    reporterUserId: actor.value.userId,
    reporterDisplay,
    reportedUserId,
    reportedDisplay,
    reason: parsed.data.reason,
    snapshot,
    status: 'open',
    createdAt: deps.clock.nowIso(),
    resolvedAt: null,
    resolvedByUserId: null,
  });
  if (!report.success) return err(internal('Could not create a valid report'));
  const opened = await deps.dmReports.open(actor.value.tenantId, report.data);
  if (opened === null) {
    return err(appError('conflict', 'You have already reported this conversation'));
  }
  await notifyStaffOfDmReport(opened, deps).catch(() => undefined);
  return ok(dmReportReceiptOf(opened));
};

export const listDmReports = async (
  ctx: Ctx,
  input: unknown,
  deps: ModerationDeps,
): Promise<Result<DmReportQueue, AppError>> => {
  const actor = requireActor(ctx, 'community:report:read');
  if (!actor.ok) return actor;
  const parsed = listDmReportsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid reports query', parsed.error.flatten()));
  const [listed, openCount] = await Promise.all([
    deps.dmReports.listByStatus(actor.value.tenantId, {
      status: parsed.data.status,
      limit: parsed.data.limit,
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    }),
    deps.dmReports.countOpen(actor.value.tenantId),
  ]);
  return ok({ reports: listed.reports, nextCursor: listed.nextCursor, openCount });
};

export const resolveDmReport = async (
  ctx: Ctx,
  input: unknown,
  deps: ModerationDeps,
): Promise<Result<DmReport, AppError>> => {
  const actor = requireActor(ctx, 'community:moderate');
  if (!actor.ok) return actor;
  const parsed = resolveDmReportInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid report resolution', parsed.error.flatten()));
  const resolved = await deps.dmReports.resolve(actor.value.tenantId, {
    id: parsed.data.reportId,
    resolvedAt: deps.clock.nowIso(),
    resolvedByUserId: actor.value.userId,
  });
  return resolved === null ? err(notFound('Open report not found')) : ok(resolved);
};
