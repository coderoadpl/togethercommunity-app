import {
  err,
  grantProductToMemberInputSchema,
  notFound,
  ok,
  revokeGrantInputSchema,
  validation,
  type AppError,
  type GrantProductToMemberInput,
  type MemberGrant,
  type Result,
  type RevokeGrantInput,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { Clock, IdGenerator, MemberRepository, ProductGrantRepository, ProductRepository } from '../ports.js';
import { createOrRenewGrant } from './grant-window.js';

export interface MemberGrantsDeps {
  members: MemberRepository;
  grants: ProductGrantRepository;
  clock: Clock;
}

export interface GrantProductToMemberDeps extends MemberGrantsDeps {
  products: ProductRepository;
  ids: IdGenerator;
}

export interface RevokeGrantDeps {
  grants: ProductGrantRepository;
  clock: Clock;
}

export interface GrantMutationResult {
  memberId: string;
  grantId: string;
  renewed: boolean;
}

export interface RevokeGrantResult {
  grantId: string;
  expiresAt: string;
}

export const listMemberGrants = async (
  ctx: Ctx,
  memberId: string,
  deps: MemberGrantsDeps,
): Promise<Result<MemberGrant[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:grant:read');
  if (!tenant.ok) return tenant;
  if (!memberId) return err(validation('memberId is required'));

  const member = await deps.members.findById(tenant.value, memberId);
  if (!member) return err(notFound(`No member "${memberId}" in this tenant`));

  return ok(await deps.grants.listForMemberWithProductNames(tenant.value, memberId, deps.clock.nowIso()));
};

export const grantProductToMember = async (
  ctx: Ctx,
  input: GrantProductToMemberInput,
  deps: GrantProductToMemberDeps,
): Promise<Result<GrantMutationResult, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:grant:write');
  if (!tenant.ok) return tenant;

  const parsed = grantProductToMemberInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid grant payload', parsed.error.flatten()));

  const member = await deps.members.findById(tenant.value, parsed.data.memberId);
  if (!member) return err(notFound(`No member "${parsed.data.memberId}" in this tenant`));

  const product = await deps.products.findById(tenant.value, parsed.data.productId);
  if (!product) return err(notFound(`No product "${parsed.data.productId}" in this tenant`));

  const { grantId, renewed } = await createOrRenewGrant(
    tenant.value,
    { memberId: parsed.data.memberId, productId: parsed.data.productId, expiresAt: parsed.data.expiresAt ?? null },
    deps,
  );
  return ok({ memberId: parsed.data.memberId, grantId, renewed });
};

export const revokeGrant = async (
  ctx: Ctx,
  input: RevokeGrantInput,
  deps: RevokeGrantDeps,
): Promise<Result<RevokeGrantResult, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:grant:write');
  if (!tenant.ok) return tenant;

  const parsed = revokeGrantInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid revoke payload', parsed.error.flatten()));

  const existing = await deps.grants.findById(tenant.value, parsed.data.grantId);
  if (!existing) return err(notFound(`No grant "${parsed.data.grantId}" in this tenant`));

  const now = deps.clock.nowIso();
  const revoked = await deps.grants.revokeGrant(tenant.value, parsed.data.grantId, now);
  if (!revoked) return err(notFound(`No grant "${parsed.data.grantId}" in this tenant`));

  return ok({ grantId: revoked.id, expiresAt: now });
};
