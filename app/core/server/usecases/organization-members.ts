import {
  appError,
  err,
  forbidden,
  notFound,
  ok,
  organizationMemberInputSchema,
  organizationMemberSelectionSchema,
  validation,
  type AppError,
  type OrganizationAuditEvent,
  type OrganizationMemberAccount,
  type OrganizationMemberInput,
  type OrganizationMemberSelection,
  type Result,
} from '#core/domain/index.js';

import { authorizeOrganization } from '../authorize.js';
import type { OrganizationCtx } from '../context.js';
import type { AuthPort, Clock, IdGenerator, OrganizationMemberRepository } from '../ports.js';

export interface OrganizationMemberDeps {
  organizationMembers: Pick<OrganizationMemberRepository, 'addAccount' | 'changeRole' | 'remove'>;
  authPort: Pick<AuthPort, 'findUserByEmail'>;
  ids: IdGenerator;
  clock: Clock;
}

type MemberChangeOutput = { member: OrganizationMemberAccount; changed: boolean };

const accountRefused = () => err(validation('Account not found or not verified'));
const memberNotFound = () => err(notFound('Organization member not found'));
const ownerRequired = () => err(forbidden('organization:member:write is not permitted'));
const lastOwner = () => err(appError('conflict', 'The last owner of an organization cannot be demoted or removed'));

const auditOf = (
  octx: OrganizationCtx,
  deps: Pick<OrganizationMemberDeps, 'ids' | 'clock'>,
  kind: 'member.added' | 'member.role_changed' | 'member.removed',
  subjectUserId: string,
): Omit<OrganizationAuditEvent, 'organizationId' | 'data'> => ({
  id: deps.ids.nextId(),
  kind,
  actorUserId: octx.identity.userId,
  actorEmail: octx.identity.email,
  actorKeyId: null,
  subjectTenantId: null,
  subjectUserId,
  at: deps.clock.nowIso(),
});

export const addOrganizationMember = async (
  octx: OrganizationCtx,
  input: { organizationId: string } & OrganizationMemberInput,
  deps: OrganizationMemberDeps,
): Promise<Result<MemberChangeOutput, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:member:write');
  if (!access.ok) return access;
  const parsed = organizationMemberInputSchema.safeParse({ email: input.email, role: input.role });
  if (!parsed.success) return err(validation('Invalid organization member', parsed.error.flatten()));
  const account = await deps.authPort.findUserByEmail(parsed.data.email);
  if (account === null || !account.emailVerified) return accountRefused();
  const result = await deps.organizationMembers.addAccount(access.value.organizationId, {
    actorUserId: octx.identity.userId,
    member: {
      id: deps.ids.nextId(), userId: account.userId, role: parsed.data.role,
      createdAt: deps.clock.nowIso(), createdByUserId: octx.identity.userId,
    },
    audit: auditOf(octx, deps, 'member.added', account.userId),
  });
  switch (result.status) {
    case 'added': return ok({ member: result.member, changed: true });
    case 'already_member':
      return result.member.role === parsed.data.role
        ? ok({ member: result.member, changed: false })
        : err(appError('conflict', 'Account is already a member with another role; change its role instead'));
    case 'account_unverified': return accountRefused();
    case 'organization_owner_required': return ownerRequired();
  }
};

export const setOrganizationMemberRole = async (
  octx: OrganizationCtx,
  input: { organizationId: string } & OrganizationMemberInput,
  deps: OrganizationMemberDeps,
): Promise<Result<MemberChangeOutput, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:member:write');
  if (!access.ok) return access;
  const parsed = organizationMemberInputSchema.safeParse({ email: input.email, role: input.role });
  if (!parsed.success) return err(validation('Invalid organization member', parsed.error.flatten()));
  const account = await deps.authPort.findUserByEmail(parsed.data.email);
  if (account === null) return memberNotFound();
  const result = await deps.organizationMembers.changeRole(access.value.organizationId, {
    actorUserId: octx.identity.userId,
    userId: account.userId,
    role: parsed.data.role,
    audit: auditOf(octx, deps, 'member.role_changed', account.userId),
  });
  switch (result.status) {
    case 'changed': return ok({ member: result.member, changed: true });
    case 'unchanged': return ok({ member: result.member, changed: false });
    case 'not_member': return memberNotFound();
    case 'last_owner': return lastOwner();
    case 'organization_owner_required': return ownerRequired();
  }
};

export const removeOrganizationMember = async (
  octx: OrganizationCtx,
  input: { organizationId: string } & OrganizationMemberSelection,
  deps: OrganizationMemberDeps,
): Promise<Result<MemberChangeOutput, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:member:write');
  if (!access.ok) return access;
  const parsed = organizationMemberSelectionSchema.safeParse({ email: input.email });
  if (!parsed.success) return err(validation('Invalid organization member', parsed.error.flatten()));
  const account = await deps.authPort.findUserByEmail(parsed.data.email);
  if (account === null) return memberNotFound();
  const result = await deps.organizationMembers.remove(access.value.organizationId, {
    actorUserId: octx.identity.userId,
    userId: account.userId,
    audit: auditOf(octx, deps, 'member.removed', account.userId),
  });
  switch (result.status) {
    case 'removed': return ok({ member: result.member, changed: true });
    case 'not_member': return memberNotFound();
    case 'last_owner': return lastOwner();
    case 'organization_owner_required': return ownerRequired();
  }
};
