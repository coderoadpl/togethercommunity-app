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

export const organizationRoleSchema = z.enum(['owner', 'admin']);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const organizationMemberSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  role: organizationRoleSchema,
  createdAt: z.string().datetime(),
  createdByUserId: z.string().min(1),
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const organizationMembershipSchema = organizationSchema
  .pick({ id: true, slug: true, name: true, status: true })
  .extend({ role: organizationRoleSchema });

export type OrganizationMembership = z.infer<typeof organizationMembershipSchema>;

export const organizationMemberAccountSchema = z.object({
  userId: z.string().min(1),
  email: z.string().min(1),
  role: organizationRoleSchema,
  createdAt: z.string().datetime(),
});

export type OrganizationMemberAccount = z.infer<typeof organizationMemberAccountSchema>;

export const organizationMemberSelectionSchema = z.object({ email: z.string().trim().toLowerCase().email() }).strict();

export type OrganizationMemberSelection = z.infer<typeof organizationMemberSelectionSchema>;

export const organizationMemberInputSchema = organizationMemberSelectionSchema.extend({ role: organizationRoleSchema }).strict();

export type OrganizationMemberInput = z.infer<typeof organizationMemberInputSchema>;

export const organizationWorkspaceSchema = tenantSchema.pick({ id: true, slug: true, status: true })
  .extend({ name: z.string().min(1) });

export type OrganizationWorkspace = z.infer<typeof organizationWorkspaceSchema>;

export const organizationWorkspaceSelectionSchema = z.object({ tenantId: z.string().trim().min(1) }).strict();

export type OrganizationWorkspaceSelection = z.infer<typeof organizationWorkspaceSelectionSchema>;

const maxWorkspacesSchema = z.number().int().min(0).max(10_000);

export const createOrganizationInputSchema = z.object({
  slug: operatorTenantSlugSchema,
  name: tenantSchema.shape.name,
  ownerEmail: z.string().trim().toLowerCase().email(),
  maxWorkspaces: maxWorkspacesSchema.optional(),
}).strict();

export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const organizationLimitsSchema = z.object({ maxWorkspaces: maxWorkspacesSchema }).strict();

export type OrganizationLimits = z.infer<typeof organizationLimitsSchema>;

export const organizationAuditEventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type OrganizationAuditEventListQuery = z.infer<typeof organizationAuditEventListQuerySchema>;

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
