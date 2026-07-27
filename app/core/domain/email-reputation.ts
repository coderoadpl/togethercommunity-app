import { z } from 'zod';

const DAY_MS = 24 * 60 * 60 * 1000;

export const emailReputationStatusSchema = z.enum(['insufficient_data', 'ok', 'warn', 'critical']);

export const emailReputationMetricSchema = z.object({
  count: z.number().int().nonnegative(),
  sends: z.number().int().nonnegative(),
  rate: z.number().nonnegative().nullable(),
  status: emailReputationStatusSchema,
});

export const emailReputationSchema = z.object({
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  hardBounce: emailReputationMetricSchema,
  complaint: emailReputationMetricSchema,
  overallStatus: emailReputationStatusSchema,
});

export type EmailReputation = z.output<typeof emailReputationSchema>;
export type EmailReputationMetric = z.output<typeof emailReputationMetricSchema>;
export type EmailReputationStatus = z.output<typeof emailReputationStatusSchema>;

export type EmailReputationCounts = {
  sends: number;
  hardBounces: number;
  complaints: number;
};

type Thresholds = {
  absoluteFloor: number;
  warn: number;
  critical: number;
};

const hardBounceThresholds: Thresholds = { absoluteFloor: 5, warn: 0.05, critical: 0.1 };
const complaintThresholds: Thresholds = { absoluteFloor: 2, warn: 0.00075, critical: 0.0015 };

const deriveMetric = (sends: number, count: number, thresholds: Thresholds): EmailReputationMetric => {
  if (sends < 100 || count < thresholds.absoluteFloor) {
    return { count, sends, rate: null, status: 'insufficient_data' as const };
  }
  const rate = count / sends;
  const status: EmailReputationStatus =
    rate >= thresholds.critical ? 'critical' : rate >= thresholds.warn ? 'warn' : 'ok';
  return { count, sends, rate, status };
};

const severity: Record<EmailReputationStatus, number> = {
  insufficient_data: 0,
  ok: 1,
  warn: 2,
  critical: 3,
};

export const deriveEmailReputation = (counts: EmailReputationCounts) => {
  const hardBounce = deriveMetric(counts.sends, counts.hardBounces, hardBounceThresholds);
  const complaint = deriveMetric(counts.sends, counts.complaints, complaintThresholds);
  const overallStatus = severity[hardBounce.status] >= severity[complaint.status]
    ? hardBounce.status
    : complaint.status;
  return { hardBounce, complaint, overallStatus };
};

export const reputationWindow = (now: string): { since: string; until: string } => ({
  since: new Date(Date.parse(now) - 7 * DAY_MS).toISOString(),
  until: now,
});
