import { z } from 'zod';

import { operatorTenantSlugSchema } from './operator-tenant.js';
import { isReservedTenantSlug, tenantSchema } from './tenant.js';

const organizationSlugSchema = operatorTenantSlugSchema
  .refine((slug) => !isReservedTenantSlug(slug), 'Organization slug is reserved');

export const organizationSchema = z.object({
  id: z.string().min(1),
  slug: organizationSlugSchema,
  name: tenantSchema.shape.name,
  status: z.enum(['active', 'suspended']),
  maxWorkspaces: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Organization = z.infer<typeof organizationSchema>;

const organizationRoleSchema = z.enum(['owner', 'admin']);

export const organizationMemberSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  role: organizationRoleSchema,
  createdAt: z.string().datetime(),
  createdByUserId: z.string().min(1),
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

const organizationAuditEventKindSchema = z.enum([
  'organization.created',
  'organization.updated',
  'member.added',
  'member.role_changed',
  'member.removed',
  'workspace.created',
  'workspace.linked',
  'workspace.unlinked',
  'config_source.changed',
  'secret.set',
  'secret.deleted',
  'stripe.credential_configured',
  'invoicing.series_cutover',
  'api_key.created',
  'api_key.revoked',
]);

const auditDataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);

export const organizationAuditEventSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  kind: organizationAuditEventKindSchema,
  actorUserId: z.string().min(1),
  actorEmail: z.string().min(1),
  actorKeyId: z.string().min(1).nullable(),
  subjectTenantId: z.string().min(1).nullable(),
  subjectUserId: z.string().min(1).nullable(),
  data: z.record(z.string(), auditDataValueSchema),
  at: z.string().datetime(),
});

export type OrganizationAuditEvent = z.infer<typeof organizationAuditEventSchema>;
