import { z } from 'zod';

import {
  organizationAuditEventSchema,
  organizationMemberAccountSchema,
  organizationMembershipSchema,
  organizationRoleSchema,
  organizationSchema,
  organizationSecretKeySchema,
  organizationSecretMaskedSchema,
  organizationSettingsSchema,
  organizationWorkspaceSchema,
  workspaceConfigSourceSchema,
} from '#core/domain/index.js';

export {
  createOrganizationInputSchema,
  organizationAuditEventListQuerySchema,
  organizationLimitsSchema,
  organizationMemberInputSchema,
  organizationMemberSelectionSchema,
  organizationSecretKeySchema,
  organizationWorkspaceSelectionSchema,
  setOrganizationSecretInputSchema,
  updateOrganizationInputSchema,
} from '#core/domain/index.js';
export type {
  CreateOrganizationInput,
  OrganizationLimits,
  OrganizationMemberInput,
  OrganizationMemberSelection,
  OrganizationSecretKey,
  OrganizationWorkspaceSelection,
  SetOrganizationSecretInput,
  UpdateOrganizationInput,
} from '#core/domain/index.js';

export const ORGANIZATION_ROUTES = {
  operatorOrganizationCreate: { method: 'POST', path: '/api/internal/organizations' },
  operatorOrganizationLimits: { method: 'POST', path: '/api/internal/organizations/:organizationId/limits' },
  organizations: { method: 'GET', path: '/api/organizations' },
  organization: { method: 'GET', path: '/api/organizations/:organizationId' },
  organizationUpdate: { method: 'POST', path: '/api/organizations/:organizationId/update' },
  organizationMembers: { method: 'GET', path: '/api/organizations/:organizationId/members' },
  organizationMemberAdd: { method: 'POST', path: '/api/organizations/:organizationId/members' },
  organizationMemberRole: { method: 'POST', path: '/api/organizations/:organizationId/members/role' },
  organizationMemberRemove: { method: 'POST', path: '/api/organizations/:organizationId/members/remove' },
  organizationAuditEvents: { method: 'GET', path: '/api/organizations/:organizationId/audit-events' },
  organizationWorkspaces: { method: 'GET', path: '/api/organizations/:organizationId/workspaces' },
  organizationWorkspaceLink: { method: 'POST', path: '/api/organizations/:organizationId/workspaces/link' },
  organizationWorkspaceUnlink: { method: 'POST', path: '/api/organizations/:organizationId/workspaces/unlink' },
  organizationWorkspaceSources: { method: 'GET', path: '/api/organizations/:organizationId/workspaces/:tenantId/sources' },
  organizationSecrets: { method: 'GET', path: '/api/organizations/:organizationId/secrets' },
  organizationSecretSet: { method: 'POST', path: '/api/organizations/:organizationId/secrets' },
  organizationSecretDelete: { method: 'DELETE', path: '/api/organizations/:organizationId/secrets/:key' },
} as const;

export const organizationListOutputSchema = z.object({ organizations: z.array(organizationMembershipSchema) });
export const organizationOutputSchema = z.object({
  organization: organizationSchema,
  settings: organizationSettingsSchema,
  role: organizationRoleSchema,
});
export const organizationUpdateOutputSchema = z.object({
  organization: organizationSchema,
  settings: organizationSettingsSchema,
  changed: z.boolean(),
});
export const organizationSecretsOutputSchema = z.object({ secrets: z.array(organizationSecretMaskedSchema) });
export const organizationSecretSetOutputSchema = z.object({ secret: organizationSecretMaskedSchema });
export const organizationSecretDeleteOutputSchema = z.object({ key: organizationSecretKeySchema });
export const organizationWorkspaceSourcesOutputSchema = z.object({
  workspace: organizationWorkspaceSchema,
  sources: z.array(workspaceConfigSourceSchema),
});
export const organizationMembersOutputSchema = z.object({ members: z.array(organizationMemberAccountSchema) });
export const organizationMemberChangeOutputSchema = z.object({ member: organizationMemberAccountSchema, changed: z.boolean() });
export const organizationAuditEventsOutputSchema = z.object({ events: z.array(organizationAuditEventSchema) });
export const organizationWorkspacesOutputSchema = z.object({ workspaces: z.array(organizationWorkspaceSchema) });
export const organizationWorkspaceChangeOutputSchema = z.object({ workspace: organizationWorkspaceSchema, changed: z.boolean() });
export const operatorCreateOrganizationOutputSchema = z.object({
  organization: organizationSchema,
  created: z.boolean(),
  ownerUserId: z.string().min(1),
}).strict();
export const operatorOrganizationLimitsOutputSchema = z.object({ organization: organizationSchema }).strict();
