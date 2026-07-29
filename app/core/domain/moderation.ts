import { z } from 'zod';

import { publicPostSchema } from './community.js';
import { MAX_MEMBER_BAN_REASON_LENGTH } from './tenant.js';

export const postReportReasonSchema = z.enum(['spam', 'harassment', 'off-topic', 'illegal', 'other']);
export const postReportSourceSchema = z.enum(['member', 'heuristic']);
export const postReportStatusSchema = z.enum(['open', 'dismissed', 'resolved']);
export const heuristicSignalSchema = z.enum(['link-flood', 'duplicate-body']);

export type PostReportReason = z.output<typeof postReportReasonSchema>;
export type PostReportSource = z.output<typeof postReportSourceSchema>;
export type PostReportStatus = z.output<typeof postReportStatusSchema>;
export type HeuristicSignal = z.output<typeof heuristicSignalSchema>;

export const MAX_REPORT_NOTE_LENGTH = 1000;

export const postReportSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  postId: z.string().min(1),
  reporterUserId: z.string().min(1).nullable(),
  reporterDisplay: z.string().trim().min(1).nullable(),
  source: postReportSourceSchema,
  reason: postReportReasonSchema,
  note: z.string().max(MAX_REPORT_NOTE_LENGTH).nullable(),
  signals: z.array(heuristicSignalSchema).nullable(),
  status: postReportStatusSchema,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().min(1).nullable(),
});

export type PostReport = z.output<typeof postReportSchema>;

export const postReportEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  reportId: z.string().min(1),
  postId: z.string().min(1),
  type: z.enum(['opened', 'dismissed', 'post_removed']),
  occurredAt: z.string().datetime(),
});

export type PostReportEvent = z.output<typeof postReportEventSchema>;

export const reportQueueItemSchema = z.object({
  report: postReportSchema,
  post: publicPostSchema,
  spaceName: z.string().nullable(),
  openReportsForPost: z.number().int().nonnegative(),
});

export type ReportQueueItem = z.output<typeof reportQueueItemSchema>;

export const reportQueueSchema = z.object({
  items: z.array(reportQueueItemSchema),
  nextCursor: z.string().nullable(),
  openCount: z.number().int().nonnegative(),
});

export type ReportQueue = z.output<typeof reportQueueSchema>;

export const reportPostInputSchema = z.object({
  postId: z.string().min(1),
  reason: postReportReasonSchema,
  note: z.string().max(MAX_REPORT_NOTE_LENGTH).optional(),
});

export type ReportPostInput = z.input<typeof reportPostInputSchema>;

export const listReportsInputSchema = z.object({
  status: postReportStatusSchema.default('open'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ListReportsInput = z.input<typeof listReportsInputSchema>;

export const resolveReportInputSchema = z.object({
  reportId: z.string().min(1),
  action: z.enum(['dismiss', 'delete-post']),
});

export type ResolveReportInput = z.input<typeof resolveReportInputSchema>;

export const setMemberBannedInputSchema = z.object({
  memberId: z.string().min(1),
  banned: z.boolean(),
  reason: z.string().trim().max(MAX_MEMBER_BAN_REASON_LENGTH).optional(),
});

export const memberEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  memberId: z.string().min(1),
  type: z.enum(['banned', 'unbanned']),
  reason: z.string().nullable(),
  actorUserId: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export type MemberEvent = z.output<typeof memberEventSchema>;

export type SetMemberBannedInput = z.input<typeof setMemberBannedInputSchema>;

export const POST_RATE_LIMIT = { maxPosts: 10, windowMinutes: 10 } as const;
export const LINK_COUNT_FLAG_THRESHOLD = 3;
export const DUPLICATE_BODY_WINDOW_MINUTES = 60;

export const countLinks = (body: string): number =>
  body.match(/(?:https?:\/\/|www\.)[^\s<]+/giu)?.length ?? 0;

export const normalizeBodyForDuplicate = (body: string): string =>
  body
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

export const heuristicSignalsFor = (input: {
  body: string;
  recentBodies: readonly string[];
}): HeuristicSignal[] => {
  const signals: HeuristicSignal[] = [];
  if (countLinks(input.body) >= LINK_COUNT_FLAG_THRESHOLD) signals.push('link-flood');
  const normalized = normalizeBodyForDuplicate(input.body);
  if (
    normalized.length >= 20 &&
    input.recentBodies.some((body) => normalizeBodyForDuplicate(body) === normalized)
  ) {
    signals.push('duplicate-body');
  }
  return signals;
};
