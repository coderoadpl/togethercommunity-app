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

export type MemberErasureRequestEvent = {
  id: string;
  tenantId: string;
  requestId: string;
  type: 'requested' | 'cancelled' | 'completed' | 'rejected';
  actorUserId: string | null;
  meta: unknown | null;
  occurredAt: string;
  createdAt: string;
};

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
