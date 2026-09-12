import { z } from 'zod';

const instant = z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const rangeShape = { from: instant, to: instant };
const validRange = (input: { from: string; to: string }) => input.from < input.to;
export const activitySummaryQuerySchema = z.object(rangeShape).refine(validRange, 'from must precede to');
export const memberActivityQuerySchema = z.object({
  ...rangeShape,
  pivot: instant,
  excludeEmailPatterns: z.string().max(4096).default(''),
  cursor: z.string().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(500).default(100),
}).refine(validRange, 'from must precede to');
const count = z.number().int().nonnegative();
const timestamp = z.string().datetime().nullable();
export const activitySummarySchema = z.object({
  days: z.array(z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sessions: count,
    distinctUsers: count,
    progressUpdates: count,
    distinctProgressMembers: count,
    lessonCompletions: count,
  })),
  totals: z.object({ membersTotal: count, membersActive: count }),
});
export const memberActivityRowSchema = z.object({
  memberId: z.string(),
  displayName: z.string().nullable(),
  email: z.string(),
  sessionsBefore: count,
  sessionsAfter: count,
  firstSession: timestamp,
  lastSession: timestamp,
  progressBefore: count,
  progressAfter: count,
  coursesTouched: count,
  lessonsCompletedTotal: count,
  lastProgress: timestamp,
  completionsBefore: count,
  completionsAfter: count,
});
export const memberActivitySchema = z.object({
  members: z.array(memberActivityRowSchema),
  nextCursor: z.string().nullable(),
});
export type ActivitySummaryQuery = z.output<typeof activitySummaryQuerySchema>;
export type MemberActivityQuery = z.output<typeof memberActivityQuerySchema>;
export type ActivitySummary = z.output<typeof activitySummarySchema>;
export type MemberActivity = z.output<typeof memberActivitySchema>;
