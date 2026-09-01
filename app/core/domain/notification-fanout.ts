import { z } from 'zod';

export const NOTIFICATION_FANOUT_BATCH_SIZE = 50;
export const NOTIFICATION_FANOUT_ATTEMPTS_CAP = 5;
const NOTIFICATION_FANOUT_BACKOFF_BASE_MS = 60_000;
const NOTIFICATION_FANOUT_BACKOFF_CAP_MS = 30 * 60_000;
export const NOTIFICATION_FANOUT_LEASE_MS = 5 * 60_000;

const notificationFanoutKindSchema = z.enum(['space-post', 'thread-reply', 'space-event']);

export type NotificationFanoutKind = z.output<typeof notificationFanoutKindSchema>;

const notificationFanoutStatusSchema = z.enum(['pending', 'completed', 'failed']);

export type NotificationFanoutStatus = z.output<typeof notificationFanoutStatusSchema>;

const notificationFanoutPayloadSchema = z.object({
  postId: z.string().min(1).nullable().default(null),
  eventId: z.string().min(1).nullable().default(null),
  tenantName: z.string().min(1),
  tenantSlug: z.string().min(1).nullable().default(null),
  authorDisplay: z.string().min(1).nullable().default(null),
});

export const notificationFanoutJobSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  kind: notificationFanoutKindSchema,
  sourceKey: z.string().min(1),
  payload: notificationFanoutPayloadSchema,
  status: notificationFanoutStatusSchema,
  attempts: z.number().int().min(0),
  cursorUserId: z.string().min(1).nullable(),
  nextAttemptAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type NotificationFanoutJob = z.output<typeof notificationFanoutJobSchema>;

export const notificationSourceKey = (kind: NotificationFanoutKind, sourceId: string): string =>
  `${kind}:${sourceId}`;

export const notificationFanoutBackoffAt = (now: string, attempts: number): string => {
  const delay = Math.min(
    NOTIFICATION_FANOUT_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    NOTIFICATION_FANOUT_BACKOFF_CAP_MS,
  );
  return new Date(Date.parse(now) + delay).toISOString();
};
