import { z } from 'zod';

import { publicPostSchema } from './community.js';
import { MAX_MEMBER_BAN_REASON_LENGTH } from './tenant.js';

const postReportReasonSchema = z.enum(['spam', 'harassment', 'off-topic', 'illegal', 'other']);
const postReportSourceSchema = z.enum(['member', 'heuristic']);
const postReportStatusSchema = z.enum(['open', 'dismissed', 'resolved']);
const heuristicSignalSchema = z.enum(['link-flood', 'duplicate-body']);

export type PostReportReason = z.output<typeof postReportReasonSchema>;
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

const reportQueueItemSchema = z.object({
  report: postReportSchema,
  post: publicPostSchema,
  spaceName: z.string().nullable(),
  openReportsForPost: z.number().int().nonnegative(),
});

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

export const listReportsInputSchema = z.object({
  status: postReportStatusSchema.default('open'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const resolveReportInputSchema = z.object({
  reportId: z.string().min(1),
  action: z.enum(['dismiss', 'delete-post']),
});

const dmReportReasonSchema = z.enum(['spam', 'harassment', 'illegal', 'other']);
const dmReportStatusSchema = z.enum(['open', 'resolved']);

export type DmReportReason = z.output<typeof dmReportReasonSchema>;
export type DmReportStatus = z.output<typeof dmReportStatusSchema>;

/**
 * Staff cannot read live DM threads, so a report carries its own frozen copy of
 * the conversation tail; the snapshot is evidence and is never refreshed.
 */
const dmReportMessageSchema = z.object({
  id: z.string().min(1),
  senderDisplay: z.string().min(1),
  senderIsReporter: z.boolean(),
  body: z.string(),
  createdAt: z.string().datetime(),
});

export type DmReportMessage = z.output<typeof dmReportMessageSchema>;

export const dmReportSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  reporterUserId: z.string().min(1),
  reporterDisplay: z.string().trim().min(1),
  reportedUserId: z.string().min(1),
  reportedDisplay: z.string().trim().min(1),
  reason: dmReportReasonSchema,
  snapshot: z.array(dmReportMessageSchema),
  status: dmReportStatusSchema,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().min(1).nullable(),
});

export type DmReport = z.output<typeof dmReportSchema>;

/**
 * Raw participant user ids are global across tenants, so the reporter only ever
 * gets back the acknowledgement fields; the identifying columns and the
 * evidence snapshot stay on the staff queue.
 */
export const dmReportReceiptSchema = dmReportSchema.pick({
  id: true,
  conversationId: true,
  reason: true,
  status: true,
  createdAt: true,
});

export type DmReportReceipt = z.output<typeof dmReportReceiptSchema>;

export const dmReportReceiptOf = (report: DmReport): DmReportReceipt => ({
  id: report.id,
  conversationId: report.conversationId,
  reason: report.reason,
  status: report.status,
  createdAt: report.createdAt,
});

export const dmReportQueueSchema = z.object({
  reports: z.array(dmReportSchema),
  nextCursor: z.string().nullable(),
  openCount: z.number().int().nonnegative(),
});

export type DmReportQueue = z.output<typeof dmReportQueueSchema>;

export const reportDmConversationInputSchema = z.object({
  conversationId: z.string().min(1),
  reason: dmReportReasonSchema,
});

export const listDmReportsInputSchema = z.object({
  status: dmReportStatusSchema.default('open'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const resolveDmReportInputSchema = z.object({
  reportId: z.string().min(1),
});

export const setMemberBannedInputSchema = z.object({
  memberId: z.string().min(1),
  banned: z.boolean(),
  reason: z.string().trim().max(MAX_MEMBER_BAN_REASON_LENGTH).optional(),
});

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
