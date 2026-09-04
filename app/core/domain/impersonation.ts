import { z } from 'zod';

import type { StaffRole } from './identity.js';

export const IMPERSONATION_TTL_MS = 3_600_000;

/**
 * The cookie is host-only on `/`, so over HTTPS it qualifies for the `__Host-`
 * prefix, which pins it against shadowing from a subdomain or a narrower path.
 * Browsers reject the prefix without `Secure`, so plain-HTTP development keeps
 * the bare name.
 */
export const impersonationCookieName = (secure: boolean): string =>
  secure ? '__Host-together_impersonation' : 'together_impersonation';

export const impersonationSessionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  actorUserId: z.string().min(1),
  actorSessionId: z.string().min(1),
  subjectMemberId: z.string().min(1),
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});

export type ImpersonationSession = z.infer<typeof impersonationSessionSchema>;

export const impersonationStartInputSchema = z.object({
  memberId: z.string().min(1),
  reason: z.string().trim().min(1).max(500).nullable().default(null),
});

export const impersonationViewSchema = z.object({
  id: z.string(),
  subjectMemberId: z.string(),
  subjectName: z.string(),
  actorName: z.string(),
  expiresAt: z.string().datetime(),
});

export type ImpersonationView = z.infer<typeof impersonationViewSchema>;

export const tenantAuditEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  kind: z.enum(['impersonation_started', 'impersonation_ended']),
  actorUserId: z.string().min(1),
  actorEmail: z.string().min(1),
  subjectMemberId: z.string().nullable(),
  subjectLabel: z.string().nullable(),
  reason: z.string().nullable(),
  at: z.string().datetime(),
});

export type TenantAuditEvent = z.infer<typeof tenantAuditEventSchema>;

/**
 * The subject label is resolved from the member at read time, so the append-only
 * trail keeps no copy of a personal datum that erasure has to reach.
 */
export type TenantAuditEventInput = Omit<TenantAuditEvent, 'subjectLabel'>;

const tenantAuditEventCursorSchema = z.string().min(1).superRefine((value, ctx) => {
  const parts = value.split('~');
  try {
    if (
      parts.length !== 2
      || !z.string().datetime().safeParse(decodeURIComponent(parts[0] ?? '')).success
      || decodeURIComponent(parts[1] ?? '').length === 0
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid audit event cursor' });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid audit event cursor' });
  }
});

export const tenantAuditEventListQuerySchema = z.object({
  cursor: tenantAuditEventCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type TenantAuditEventListQuery = z.infer<typeof tenantAuditEventListQuerySchema>;

export interface TenantAuditEventPage {
  events: TenantAuditEvent[];
  nextCursor: string | null;
}

/** Acting staff account behind an impersonated request; never a wire shape. */
export interface ImpersonationPrincipal {
  id: string;
  actorUserId: string;
  actorEmail: string;
  actorName: string;
  actorStaffRole: StaffRole;
  subjectMemberId: string;
  subjectName: string;
  expiresAt: string;
}

export const impersonationExpiresAt = (startedAt: string): string =>
  new Date(new Date(startedAt).getTime() + IMPERSONATION_TTL_MS).toISOString();
