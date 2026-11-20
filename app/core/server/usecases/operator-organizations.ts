import {
  appError,
  createOrganizationInputSchema,
  err,
  isReservedTenantSlug,
  notFound,
  ok,
  organizationLimitsSchema,
  slugReserved,
  validation,
  type AppError,
  type CreateOrganizationInput,
  type Organization,
  type OrganizationLimits,
  type Result,
} from '#core/domain/index.js';

import { authorize } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { AuthPort, Clock, IdGenerator, OrganizationRepository } from '../ports.js';

export interface OperatorOrganizationDeps {
  organizations: Pick<OrganizationRepository, 'createWithOwner' | 'setMaxWorkspaces'>;
  authPort: Pick<AuthPort, 'findUserByEmail'>;
  ids: IdGenerator;
  clock: Clock;
}

const ownerRefused = () => err(validation('Owner account not found or not verified'));

export const createOrganization = async (
  ctx: Ctx,
  input: CreateOrganizationInput,
  deps: OperatorOrganizationDeps,
): Promise<Result<{ organization: Organization; created: boolean; ownerUserId: string }, AppError>> => {
  const denial = authorize(ctx, 'tenant:provision');
  if (denial !== null) return err(denial);
  const parsed = createOrganizationInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid organization payload'));
  const { slug, name, ownerEmail, maxWorkspaces } = parsed.data;
  if (isReservedTenantSlug(slug)) return err(slugReserved('Organization slug is reserved'));
  const owner = await deps.authPort.findUserByEmail(ownerEmail);
  if (owner === null || !owner.emailVerified) return ownerRefused();
  const organizationId = deps.ids.nextId();
  const at = deps.clock.nowIso();
  const actor = { actorUserId: ctx.identity.userId, actorEmail: ctx.identity.email, actorKeyId: null, subjectTenantId: null, at };
  const result = await deps.organizations.createWithOwner({
    organization: { id: organizationId, slug, name, status: 'active', maxWorkspaces: maxWorkspaces ?? 0, createdAt: at, updatedAt: at },
    owner: { id: deps.ids.nextId(), userId: owner.userId, role: 'owner', createdAt: at, createdByUserId: ctx.identity.userId },
    audit: [
      { ...actor, id: deps.ids.nextId(), kind: 'organization.created', subjectUserId: null, data: { slug, name, maxWorkspaces: maxWorkspaces ?? 0 } },
      { ...actor, id: deps.ids.nextId(), kind: 'member.added', subjectUserId: owner.userId, data: { role: 'owner' } },
    ],
  });
  if (result.status === 'owner_unverified') return ownerRefused();
  if (result.status === 'conflict') return err(appError('conflict', 'Organization slug belongs to another owner'));
  return ok({ organization: result.organization, created: result.status === 'created', ownerUserId: owner.userId });
};

export const setOrganizationLimits = async (
  ctx: Ctx,
  input: { organizationId: string } & OrganizationLimits,
  deps: Pick<OperatorOrganizationDeps, 'organizations' | 'ids' | 'clock'>,
): Promise<Result<{ organization: Organization }, AppError>> => {
  const denial = authorize(ctx, 'tenant:provision');
  if (denial !== null) return err(denial);
  const limits = organizationLimitsSchema.safeParse({ maxWorkspaces: input.maxWorkspaces });
  if (!limits.success) return err(validation('Invalid organization limits'));
  const at = deps.clock.nowIso();
  const organization = await deps.organizations.setMaxWorkspaces(input.organizationId, {
    maxWorkspaces: limits.data.maxWorkspaces,
    updatedAt: at,
    audit: {
      id: deps.ids.nextId(), kind: 'organization.updated', actorUserId: ctx.identity.userId, actorEmail: ctx.identity.email,
      actorKeyId: null, subjectTenantId: null, subjectUserId: null, data: { maxWorkspaces: limits.data.maxWorkspaces }, at,
    },
  });
  return organization === null ? err(notFound('Organization not found')) : ok({ organization });
};
