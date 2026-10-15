import {
  addTenantAdminInputSchema,
  emailBrandingFrom,
  err,
  forbidden,
  notFound,
  ok,
  removeTenantAdminInputSchema,
  resolveEmailLanguage,
  validation,
  type AddTenantAdminInput,
  type AppError,
  type Result,
  type TenantTeamMember,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  AuthPort,
  Clock,
  IdGenerator,
  TenantRepository,
  TenantTeamRepository,
} from '../ports.js';
import { resolveTenantOrigin, type TenantOriginDeps } from '../tenant-url.js';

export interface TenantTeamDeps extends TenantOriginDeps {
  team: TenantTeamRepository;
  authPort: Pick<AuthPort, 'ensureUser' | 'requestMagicLink'>;
  tenants: Pick<TenantRepository, 'findSettings'>;
  ids: IdGenerator;
  clock: Clock;
}

export const listTenantTeam = async (
  ctx: Ctx,
  deps: TenantTeamDeps,
): Promise<Result<{ members: TenantTeamMember[] }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  return ok({ members: await deps.team.list(tenant.value) });
};

export const addTenantAdmin = async (
  ctx: Ctx,
  input: AddTenantAdminInput,
  deps: TenantTeamDeps,
): Promise<Result<{ status: 'invitation_sent' }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const parsed = addTenantAdminInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid administrator email', parsed.error.flatten()));
  const { userId } = await deps.authPort.ensureUser(parsed.data.email);
  await deps.team.inviteAdmin(tenant.value, userId, parsed.data.email, deps.ids.nextId(), {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    kind: 'team.admin_invited',
    actorUserId: ctx.identity.userId,
    actorEmail: ctx.identity.email,
    subjectMemberId: null,
    reason: userId,
    at: deps.clock.nowIso(),
  });
  const settings = await deps.tenants.findSettings(tenant.value);
  const baseUrl = `${await resolveTenantOrigin({ id: tenant.value, slug: ctx.identity.tenantSlug }, deps)}/`;
  await deps.authPort.requestMagicLink({
    email: parsed.data.email,
    callbackURL: baseUrl,
    tenantId: tenant.value,
    tenantName: ctx.identity.tenantName ?? '',
    language: resolveEmailLanguage(settings?.defaultLanguage),
    baseUrl,
    ...(settings === null ? {} : { branding: emailBrandingFrom(settings, baseUrl) }),
  });
  return ok({ status: 'invitation_sent' });
};

export const removeTenantAdmin = async (
  ctx: Ctx,
  input: { userId: string },
  deps: TenantTeamDeps,
): Promise<Result<{ userId: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const parsed = removeTenantAdminInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid administrator', parsed.error.flatten()));
  if (parsed.data.userId === ctx.identity.userId) {
    return err(forbidden('You cannot remove yourself from the team'));
  }
  const member = (await deps.team.list(tenant.value)).find((row) => row.userId === parsed.data.userId);
  if (member === undefined) return err(notFound('Team member not found'));
  if (member.role === 'owner') return err(forbidden('An owner cannot be removed from the team'));
  const remove = member.status === 'invited' ? deps.team.revokeInvitation : deps.team.removeAdmin;
  const removed = await remove(tenant.value, parsed.data.userId, {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    kind: member.status === 'invited' ? 'team.invitation_revoked' : 'team.admin_removed',
    actorUserId: ctx.identity.userId,
    actorEmail: ctx.identity.email,
    subjectMemberId: null,
    reason: parsed.data.userId,
    at: deps.clock.nowIso(),
  });
  if (!removed) return err(notFound('Administrator not found'));
  return ok({ userId: parsed.data.userId });
};
