import { z } from 'zod';

import {
  organizationAuditEventSchema,
  organizationMemberAccountSchema,
  organizationMembershipSchema,
  organizationRoleSchema,
  organizationSchema,
  organizationWorkspaceSchema,
} from '#core/domain/index.js';

export {
  createOrganizationInputSchema,
  organizationAuditEventListQuerySchema,
  organizationLimitsSchema,
  organizationWorkspaceSelectionSchema,
} from '#core/domain/index.js';
export type { CreateOrganizationInput, OrganizationLimits, OrganizationWorkspaceSelection } from '#core/domain/index.js';

export const ORGANIZATION_ROUTES = {
  operatorOrganizationCreate: { method: 'POST', path: '/api/internal/organizations' },
  operatorOrganizationLimits: { method: 'POST', path: '/api/internal/organizations/:organizationId/limits' },
  organizations: { method: 'GET', path: '/api/organizations' },
  organization: { method: 'GET', path: '/api/organizations/:organizationId' },
  organizationMembers: { method: 'GET', path: '/api/organizations/:organizationId/members' },
  organizationAuditEvents: { method: 'GET', path: '/api/organizations/:organizationId/audit-events' },
  organizationWorkspaces: { method: 'GET', path: '/api/organizations/:organizationId/workspaces' },
  organizationWorkspaceLink: { method: 'POST', path: '/api/organizations/:organizationId/workspaces/link' },
  organizationWorkspaceUnlink: { method: 'POST', path: '/api/organizations/:organizationId/workspaces/unlink' },
} as const;

export const organizationListOutputSchema = z.object({ organizations: z.array(organizationMembershipSchema) });
export const organizationOutputSchema = z.object({ organization: organizationSchema, role: organizationRoleSchema });
export const organizationMembersOutputSchema = z.object({ members: z.array(organizationMemberAccountSchema) });
export const organizationAuditEventsOutputSchema = z.object({ events: z.array(organizationAuditEventSchema) });
export const organizationWorkspacesOutputSchema = z.object({ workspaces: z.array(organizationWorkspaceSchema) });
export const organizationWorkspaceChangeOutputSchema = z.object({ workspace: organizationWorkspaceSchema, changed: z.boolean() });
export const operatorCreateOrganizationOutputSchema = z.object({
  organization: organizationSchema,
  created: z.boolean(),
  ownerUserId: z.string().min(1),
}).strict();
export const operatorOrganizationLimitsOutputSchema = z.object({ organization: organizationSchema }).strict();
