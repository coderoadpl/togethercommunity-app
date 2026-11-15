import {
  appError,
  err,
  forbidden,
  notFound,
  ok,
  organizationWorkspaceSelectionSchema,
  validation,
  workspaceConfigSourcesOf,
  type AppError,
  type OrganizationWorkspace,
  type OrganizationWorkspaceSelection,
  type Result,
  type WorkspaceConfigSource,
} from '#core/domain/index.js';

import { authorizeOrganization } from '../authorize.js';
import type { OrganizationCtx } from '../context.js';
import type { Clock, IdGenerator, OrganizationWorkspaceRepository, TenantConfigSourceRepository } from '../ports.js';

export interface OrganizationWorkspaceDeps {
  organizationWorkspaces: OrganizationWorkspaceRepository;
  ids: IdGenerator;
  clock: Clock;
}

type WorkspaceChangeInput = { organizationId: string } & OrganizationWorkspaceSelection;
type WorkspaceChangeOutput = { workspace: OrganizationWorkspace; changed: boolean };

const workspaceOwnerRequired = () =>
  err(forbidden('Linking or unlinking a workspace requires a direct owner grant in that workspace'));
const linkedElsewhere = () => err(appError('conflict', 'Workspace belongs to another organization'));

const prepareChange = (
  octx: OrganizationCtx,
  organizationId: string,
  input: OrganizationWorkspaceSelection,
  deps: Pick<OrganizationWorkspaceDeps, 'ids' | 'clock'>,
  kinds: { organization: 'workspace.linked' | 'workspace.unlinked'; tenant: 'organization.linked' | 'organization.unlinked' },
) => {
  const selection = organizationWorkspaceSelectionSchema.safeParse({ tenantId: input.tenantId });
  if (!selection.success) return err(validation('Invalid workspace selection'));
  const { tenantId } = selection.data;
  const at = deps.clock.nowIso();
  const actor = { actorUserId: octx.identity.userId, actorEmail: octx.identity.email };
  return ok({
    tenantId,
    change: {
      organizationId,
      actorUserId: octx.identity.userId,
      organizationAudit: {
        ...actor, id: deps.ids.nextId(), kind: kinds.organization, actorKeyId: null,
        subjectTenantId: tenantId, subjectUserId: null, data: {}, at,
      },
      tenantAudit: { ...actor, id: deps.ids.nextId(), kind: kinds.tenant, subjectMemberId: null, reason: organizationId, at },
    },
  });
};

export const listOrganizationWorkspaces = async (
  octx: OrganizationCtx,
  input: { organizationId: string },
  deps: Pick<OrganizationWorkspaceDeps, 'organizationWorkspaces'>,
): Promise<Result<{ workspaces: OrganizationWorkspace[] }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:read');
  if (!access.ok) return access;
  return ok({ workspaces: await deps.organizationWorkspaces.list(access.value.organizationId) });
};

export const linkOrganizationWorkspace = async (
  octx: OrganizationCtx,
  input: WorkspaceChangeInput,
  deps: OrganizationWorkspaceDeps,
): Promise<Result<WorkspaceChangeOutput, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:workspace:link');
  if (!access.ok) return access;
  const prepared = prepareChange(octx, access.value.organizationId, input, deps, { organization: 'workspace.linked', tenant: 'organization.linked' });
  if (!prepared.ok) return prepared;
  const result = await deps.organizationWorkspaces.link(prepared.value.tenantId, prepared.value.change);
  switch (result.status) {
    case 'linked': return ok({ workspace: result.workspace, changed: true });
    case 'already_linked': return ok({ workspace: result.workspace, changed: false });
    case 'workspace_owner_required': return workspaceOwnerRequired();
    case 'organization_owner_required': return err(forbidden('organization:workspace:link is not permitted'));
    case 'linked_elsewhere': return linkedElsewhere();
  }
};

export const unlinkOrganizationWorkspace = async (
  octx: OrganizationCtx,
  input: WorkspaceChangeInput,
  deps: OrganizationWorkspaceDeps,
): Promise<Result<WorkspaceChangeOutput, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:workspace:link');
  if (!access.ok) return access;
  const prepared = prepareChange(octx, access.value.organizationId, input, deps, { organization: 'workspace.unlinked', tenant: 'organization.unlinked' });
  if (!prepared.ok) return prepared;
  const result = await deps.organizationWorkspaces.unlink(prepared.value.tenantId, prepared.value.change);
  switch (result.status) {
    case 'unlinked': return ok({ workspace: result.workspace, changed: true });
    case 'not_linked': return ok({ workspace: result.workspace, changed: false });
    case 'workspace_owner_required': return workspaceOwnerRequired();
    case 'organization_owner_required': return err(forbidden('organization:workspace:link is not permitted'));
    case 'linked_elsewhere': return linkedElsewhere();
    case 'config_sources_present':
      return err(appError('conflict', 'Workspace still takes configuration from the organization; switch every group back first'));
  }
};

export interface WorkspaceConfigSourceDeps {
  organizationWorkspaces: Pick<OrganizationWorkspaceRepository, 'list'>;
  tenantConfigSources: TenantConfigSourceRepository;
}

export const getWorkspaceConfigSources = async (
  octx: OrganizationCtx,
  input: { organizationId: string } & OrganizationWorkspaceSelection,
  deps: WorkspaceConfigSourceDeps,
): Promise<Result<{ workspace: OrganizationWorkspace; sources: WorkspaceConfigSource[] }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:read');
  if (!access.ok) return access;
  const selection = organizationWorkspaceSelectionSchema.safeParse({ tenantId: input.tenantId });
  if (!selection.success) return err(validation('Invalid workspace selection'));
  const workspaces = await deps.organizationWorkspaces.list(access.value.organizationId);
  const workspace = workspaces.find((candidate) => candidate.id === selection.data.tenantId);
  if (workspace === undefined) return err(notFound('Workspace not found in this organization'));
  return ok({ workspace, sources: workspaceConfigSourcesOf(await deps.tenantConfigSources.listByTenant(workspace.id)) });
};
