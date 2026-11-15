import type { Context, Hono } from 'hono';

import {
  API_PATHS,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  createOrganizationInputSchema,
  organizationAuditEventListQuerySchema,
  organizationLimitsSchema,
  organizationMemberInputSchema,
  organizationMemberSelectionSchema,
  organizationSecretKeySchema,
  organizationWorkspaceSelectionSchema,
  setOrganizationSecretInputSchema,
  updateOrganizationInputSchema,
} from '#core/contract/index.js';
import { err, unauthorized, validation, type AppError, type Result } from '#core/domain/index.js';
import {
  addOrganizationMember,
  createOrganization,
  deleteOrganizationSecret,
  getOrganization,
  getWorkspaceConfigSources,
  listOrganizationSecrets,
  listOrganizationAuditEvents,
  listOrganizationMembers,
  linkOrganizationWorkspace,
  listOrganizations,
  listOrganizationWorkspaces,
  organizationContext,
  removeOrganizationMember,
  unlinkOrganizationWorkspace,
  unlinkWorkspaceFromOrganization,
  setOrganizationLimits,
  setOrganizationMemberRole,
  setOrganizationSecret,
  updateOrganization,
  type OperatorOrganizationDeps,
  type OrganizationCtx,
  type OrganizationMemberDeps,
  type OrganizationMemberRepository,
  type OrganizationReadDeps,
  type OrganizationSecretDeps,
  type OrganizationSettingsDeps,
  type OrganizationWorkspaceDeps,
  type WorkspaceConfigSourceDeps,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { operatorContext } from './marketing-worker-context.js';
import { respond } from './respond.js';
import { secretEquals } from './secret-equals.js';

export const registerOperatorOrganizationRoutes = (
  app: Hono<AppVars>,
  deps: OperatorOrganizationDeps & { operatorSecret: string },
): void => {
  app.post(API_PATHS.operatorOrganizationCreate, async (c) => {
    if (!secretEquals(c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER), deps.operatorSecret)) {
      return respond(err(unauthorized('Invalid operator secret')));
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = createOrganizationInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid organization payload')));
    return respond(await createOrganization(operatorContext(), parsed.data, deps));
  });
  app.post(API_PATHS.operatorOrganizationLimits, async (c) => {
    if (!secretEquals(c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER), deps.operatorSecret)) {
      return respond(err(unauthorized('Invalid operator secret')));
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = organizationLimitsSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid organization limits')));
    return respond(await setOrganizationLimits(
      operatorContext(),
      { organizationId: c.req.param('organizationId'), ...parsed.data },
      deps,
    ));
  });
};

export const registerOrganizationRoutes = (
  app: Hono<AppVars>,
  deps: OrganizationReadDeps & OrganizationSettingsDeps & OrganizationWorkspaceDeps & OrganizationMemberDeps
    & OrganizationSecretDeps & WorkspaceConfigSourceDeps
    & { organizationMembers: Pick<OrganizationMemberRepository, 'find'> },
): void => {
  const withOrganization = async <T>(
    c: Context<AppVars>,
    organizationId: string,
    action: (octx: OrganizationCtx) => Promise<Result<T, AppError>>,
  ): Promise<Response> => {
    const octx = await organizationContext(ctxOf(c), organizationId, deps);
    return respond(octx.ok ? await action(octx.value) : octx);
  };

  app.get(API_PATHS.organizations, async (c) => respond(await listOrganizations(ctxOf(c), deps)));
  app.get(API_PATHS.organization, async (c) => {
    const organizationId = c.req.param('organizationId');
    return withOrganization(c, organizationId, (octx) => getOrganization(octx, { organizationId }, deps));
  });
  app.post(API_PATHS.organizationUpdate, async (c) => {
    const organizationId = c.req.param('organizationId');
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = updateOrganizationInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid organization settings', parsed.error.flatten())));
    return withOrganization(c, organizationId, (octx) => updateOrganization(octx, { organizationId, update: parsed.data }, deps));
  });
  app.get(API_PATHS.organizationSecrets, async (c) => {
    const organizationId = c.req.param('organizationId');
    return withOrganization(c, organizationId, (octx) => listOrganizationSecrets(octx, { organizationId }, deps));
  });
  app.post(API_PATHS.organizationSecrets, async (c) => {
    const organizationId = c.req.param('organizationId');
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = setOrganizationSecretInputSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid organization secret', parsed.error.flatten())));
    return withOrganization(c, organizationId, (octx) => setOrganizationSecret(octx, { organizationId, ...parsed.data }, deps));
  });
  app.delete(API_PATHS.organizationSecretDelete, async (c) => {
    const organizationId = c.req.param('organizationId');
    const key = organizationSecretKeySchema.safeParse(c.req.param('key'));
    if (!key.success) return respond(err(validation('Invalid organization secret key', key.error.flatten())));
    return withOrganization(c, organizationId, (octx) => deleteOrganizationSecret(octx, { organizationId, key: key.data }, deps));
  });
  app.get(API_PATHS.organizationMembers, async (c) => {
    const organizationId = c.req.param('organizationId');
    return withOrganization(c, organizationId, (octx) => listOrganizationMembers(octx, { organizationId }, deps));
  });
  for (const [path, change] of [
    [API_PATHS.organizationMemberAdd, addOrganizationMember],
    [API_PATHS.organizationMemberRole, setOrganizationMemberRole],
  ] as const) {
    app.post(path, async (c) => {
      const organizationId = c.req.param('organizationId');
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = organizationMemberInputSchema.safeParse(body);
      if (!parsed.success) return respond(err(validation('Invalid organization member', parsed.error.flatten())));
      return withOrganization(c, organizationId, (octx) => change(octx, { organizationId, ...parsed.data }, deps));
    });
  }
  app.post(API_PATHS.organizationMemberRemove, async (c) => {
    const organizationId = c.req.param('organizationId');
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = organizationMemberSelectionSchema.safeParse(body);
    if (!parsed.success) return respond(err(validation('Invalid organization member', parsed.error.flatten())));
    return withOrganization(c, organizationId, (octx) => removeOrganizationMember(octx, { organizationId, ...parsed.data }, deps));
  });
  app.get(API_PATHS.organizationAuditEvents, async (c) => {
    const organizationId = c.req.param('organizationId');
    const query = organizationAuditEventListQuerySchema.safeParse({
      ...(c.req.query('limit') === undefined ? {} : { limit: c.req.query('limit') }),
    });
    if (!query.success) return respond(err(validation('Invalid organization audit query', query.error.flatten())));
    return withOrganization(c, organizationId, (octx) =>
      listOrganizationAuditEvents(octx, { organizationId, ...query.data }, deps));
  });
  app.get(API_PATHS.organizationWorkspaces, async (c) => {
    const organizationId = c.req.param('organizationId');
    return withOrganization(c, organizationId, (octx) => listOrganizationWorkspaces(octx, { organizationId }, deps));
  });
  for (const [path, change] of [
    [API_PATHS.organizationWorkspaceLink, linkOrganizationWorkspace],
    [API_PATHS.organizationWorkspaceUnlink, unlinkOrganizationWorkspace],
  ] as const) {
    app.post(path, async (c) => {
      const organizationId = c.req.param('organizationId');
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = organizationWorkspaceSelectionSchema.safeParse(body);
      if (!parsed.success) return respond(err(validation('Invalid workspace selection', parsed.error.flatten())));
      return withOrganization(c, organizationId, (octx) => change(octx, { organizationId, ...parsed.data }, deps));
    });
  }
  app.post(API_PATHS.tenantOrganizationUnlink, async (c) => respond(await unlinkWorkspaceFromOrganization(ctxOf(c), deps)));
  app.get(API_PATHS.organizationWorkspaceSources, async (c) => {
    const organizationId = c.req.param('organizationId');
    const tenantId = c.req.param('tenantId');
    return withOrganization(c, organizationId, (octx) => getWorkspaceConfigSources(octx, { organizationId, tenantId }, deps));
  });
};
