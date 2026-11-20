import {
  ENTITLEMENT_CHECK_VERSION,
  entitlementCheckInputSchema,
  entitlementSourceOf,
  err,
  forbidden,
  memberTombstone,
  ok,
  validation,
  type AppError,
  type EntitlementCheckOutput,
  type EntitlementCheckResult,
  type EntitlementSubject,
  type Member,
  type MemberSubscription,
  type ProductEntitlement,
  type ProductGrant,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, EntitlementSubjectReader } from '../ports.js';
import { activeMemberGrants } from './entitlements.js';

export interface EntitlementCheckDeps {
  entitlementSubjects: EntitlementSubjectReader;
  clock: Clock;
}

export interface EntitlementKeyProductScope {
  productIds: readonly string[] | null;
}

// A subject that matches nobody still runs every lookup against ids no row can carry, so the query sequence does not reveal whether the person exists.
const NO_USER_ID = 'entitlement-check:no-user';
const NO_MEMBER_ID = 'entitlement-check:no-member';

interface SubjectLookup {
  member: Member | null;
  grants: ProductGrant[];
  subscriptions: MemberSubscription[];
}

const isErased = (member: Member): boolean => member.userId === memberTombstone(member.id).userId;

const usableMember = (member: Member | null): Member | null =>
  member !== null && member.deletedAt === null && !isErased(member) ? member : null;

const findCandidate = async (tenantId: string, subject: EntitlementSubject, deps: EntitlementCheckDeps): Promise<Member | null> => {
  const reader = deps.entitlementSubjects;
  if ('memberId' in subject) return usableMember(await reader.findMemberById(tenantId, subject.memberId));
  const account = await reader.findAccountByEmail(subject.email);
  const verifiedUserId = account !== null && account.emailVerified ? account.userId : NO_USER_ID;
  const member = usableMember(await reader.findMemberByUser(tenantId, verifiedUserId));
  return member !== null && member.userId === verifiedUserId ? member : null;
};

// An import sets the account's verified flag without the person, so only a sign-in to this workspace proves the address is theirs.
const findSubjectMember = async (tenantId: string, subject: EntitlementSubject, deps: EntitlementCheckDeps): Promise<Member | null> => {
  const candidate = await findCandidate(tenantId, subject, deps);
  const signedIn = await deps.entitlementSubjects.hasSignedIn(tenantId, candidate?.id ?? NO_MEMBER_ID);
  return signedIn ? candidate : null;
};

const lookupSubject = async (
  tenantId: string,
  subject: EntitlementSubject,
  now: string,
  deps: EntitlementCheckDeps,
): Promise<SubjectLookup> => {
  const member = await findSubjectMember(tenantId, subject, deps);
  const scope = { tenantId, memberId: member?.id ?? NO_MEMBER_ID };
  const grants = await activeMemberGrants(scope, now, { grants: { listActiveForMember: deps.entitlementSubjects.listActiveGrants } });
  const subscriptions = await deps.entitlementSubjects.listSubscriptions(tenantId, scope.memberId);
  return member === null
    ? { member: null, grants: [], subscriptions: [] }
    : { member, grants, subscriptions: subscriptions.filter((subscription) => subscription.mode === 'live') };
};

const newestSubscriptionFor = (productId: string, subscriptions: readonly MemberSubscription[]): MemberSubscription | null =>
  subscriptions
    .filter((subscription) => subscription.productId === productId)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;

const productEntitlement = (
  productId: string,
  lookup: SubjectLookup,
  readsMembers: boolean,
  checkedAt: string,
): ProductEntitlement => {
  const grant = lookup.grants.find((candidate) => candidate.productId === productId);
  const subscription = newestSubscriptionFor(productId, lookup.subscriptions);
  // A subscription keeps its grant window moving, so an open-ended grant next to an old subscription is a one-time purchase.
  const backedBySubscription = subscription !== null && grant !== undefined && grant.expiresAt !== null;
  const reportsSubscription = subscription !== null && (backedBySubscription || readsMembers);
  return {
    productId,
    access: grant !== undefined,
    source: grant === undefined ? null : entitlementSourceOf(grant.source, backedBySubscription),
    subscription: reportsSubscription
      ? { status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd }
      : null,
    checkedAt,
  };
};

const answeredProductIds = (requested: readonly string[] | null, lookup: SubjectLookup): readonly string[] =>
  requested ?? [...new Set(lookup.grants.map((grant) => grant.productId))].toSorted();

const requestedProducts = (
  input: readonly string[] | undefined,
  scope: EntitlementKeyProductScope,
): Result<readonly string[] | null, AppError> => {
  if (input === undefined) return ok(scope.productIds);
  const allowed = scope.productIds;
  if (allowed !== null && input.some((productId) => !allowed.includes(productId))) {
    return err(forbidden('This key cannot check one of the requested products'));
  }
  return ok([...new Set(input)]);
};

const isEntitlementKey = (ctx: Ctx): boolean => ctx.machineActor?.kind === 'entitlement_key';

const keyReadsMembers = (ctx: Ctx): boolean => authorizeTenant(ctx, 'entitlement:member:read').ok;

export const checkEntitlements = async (
  ctx: Ctx,
  input: unknown,
  scope: EntitlementKeyProductScope,
  deps: EntitlementCheckDeps,
): Promise<Result<EntitlementCheckOutput, AppError>> => {
  const tenant = authorizeTenant(ctx, 'entitlement:check');
  if (!tenant.ok) return tenant;
  if (!isEntitlementKey(ctx)) return err(forbidden('Entitlements are checked only with an entitlement key'));
  const parsed = entitlementCheckInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid entitlement check', parsed.error.flatten()));
  const products = requestedProducts(parsed.data.productIds, scope);
  if (!products.ok) return products;
  const readsMembers = keyReadsMembers(ctx);
  if (!readsMembers && parsed.data.subjects.some((subject) => 'memberId' in subject)) {
    return err(forbidden('A member id lookup needs a key with entitlements:members:read'));
  }
  const checkedAt = deps.clock.nowIso();
  const results: EntitlementCheckResult[] = [];
  for (const subject of parsed.data.subjects) {
    const lookup = await lookupSubject(tenant.value, subject, checkedAt, deps);
    results.push({
      subject,
      products: answeredProductIds(products.value, lookup).map((productId) => productEntitlement(productId, lookup, readsMembers, checkedAt)),
      member: readsMembers && lookup.member !== null ? { id: lookup.member.id } : null,
    });
  }
  return ok({ version: ENTITLEMENT_CHECK_VERSION, results });
};
