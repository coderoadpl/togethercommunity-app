import { z } from 'zod';

export const memberErasureRequestStatusSchema = z.enum([
  'open',
  'cancelled',
  'completed',
  'rejected',
]);
export type MemberErasureRequestStatus = z.output<
  typeof memberErasureRequestStatusSchema
>;

export const memberErasureRequestSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  memberId: z.string(),
  status: memberErasureRequestStatusSchema,
  reason: z.string().nullable(),
  requestedAt: z.string().datetime(),
  dueAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});
export type MemberErasureRequest = z.output<typeof memberErasureRequestSchema>;

export const memberErasureRequestEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  requestId: z.string(),
  type: z.enum(['requested', 'cancelled', 'completed', 'rejected']),
  actorUserId: z.string().nullable(),
  meta: z.unknown().nullable(),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type MemberErasureRequestEvent = z.output<
  typeof memberErasureRequestEventSchema
>;

export const memberErasureRequestWithMemberSchema =
  memberErasureRequestSchema.extend({
    member: z.object({
      id: z.string(),
      email: z.string(),
      displayName: z.string().nullable(),
    }),
  });
export type MemberErasureRequestWithMember = z.output<
  typeof memberErasureRequestWithMemberSchema
>;

export const erasureRequestDueAt = (requestedAt: string): string =>
  new Date(Date.parse(requestedAt) + 30 * 24 * 60 * 60 * 1000).toISOString();
