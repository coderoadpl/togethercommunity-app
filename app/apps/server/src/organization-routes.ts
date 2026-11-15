import type { Context, Hono } from 'hono';

import {
  API_PATHS,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  createOrganizationInputSchema,
  organizationAuditEventListQuerySchema,
  organizationLimitsSchema,
} from '#core/contract/index.js';
import { err, unauthorized, validation, type AppError, type Result } from '#core/domain/index.js';
import {
  createOrganization,
  getOrganization,
  listOrganizationAuditEvents,
  listOrganizationMembers,
  listOrganizations,
  organizationContext,
  setOrganizationLimits,
  type OperatorOrganizationDeps,
  type OrganizationCtx,
  type OrganizationMemberRepository,
  type OrganizationReadDeps,
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
  deps: OrganizationReadDeps & { organizationMembers: Pick<OrganizationMemberRepository, 'find'> },
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
  app.get(API_PATHS.organizationMembers, async (c) => {
    const organizationId = c.req.param('organizationId');
    return withOrganization(c, organizationId, (octx) => listOrganizationMembers(octx, { organizationId }, deps));
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
};
