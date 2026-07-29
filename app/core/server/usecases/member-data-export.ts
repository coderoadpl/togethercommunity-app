import {
  err,
  forbidden,
  memberDataExportSchema,
  notFound,
  ok,
  type AppError,
  type MemberExportFile,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock,
  MarketingConsentRepository,
  MemberCourseProgressRepository,
  MemberRepository,
  MemberSubscriptionRepository,
  InvoiceRepository,
  OrderRepository,
  PostRepository,
  ProductGrantRepository,
  TermsConsentRepository,
} from '../ports.js';

export interface MemberDataExportDeps {
  members: MemberRepository;
  grants: ProductGrantRepository;
  subscriptions: MemberSubscriptionRepository;
  orders: OrderRepository;
  invoices: InvoiceRepository;
  progress: MemberCourseProgressRepository;
  posts: PostRepository;
  consents: TermsConsentRepository;
  marketingConsents: MarketingConsentRepository;
  clock: Clock;
}

export const exportMyData = async (
  ctx: Ctx,
  deps: MemberDataExportDeps,
): Promise<Result<MemberExportFile, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:data-export:self-read');
  if (!tenant.ok) return tenant;
  if (ctx.identity.memberId === null) {
    return err(forbidden('Only tenant members can export their data'));
  }

  const member = await deps.members.findById(tenant.value, ctx.identity.memberId);
  if (member === null || member.deletedAt !== null) {
    return err(notFound(`No member "${ctx.identity.memberId}" in this tenant`));
  }

  const [grants, subscriptions, orders, invoices, courseProgress, posts, terms, marketing] =
    await Promise.all([
      deps.grants.listForMemberWithProductNames(
        tenant.value,
        member.id,
        deps.clock.nowIso(),
      ),
      deps.subscriptions.listForMember(tenant.value, member.id),
      deps.orders.listForMember?.(tenant.value, member.id) ?? Promise.resolve([]),
      deps.invoices.listForMember?.(tenant.value, member.id) ?? Promise.resolve([]),
      deps.progress.listByMember(tenant.value, member.id),
      deps.posts.listByAuthor(tenant.value, member.userId),
      deps.consents.listByEmail(tenant.value, member.email),
      deps.marketingConsents.listByEmail(tenant.value, member.email),
    ]);
  const exportedAt = deps.clock.nowIso();
  const pkg = memberDataExportSchema.parse({
    formatVersion: 1,
    exportedAt,
    tenant: {
      id: tenant.value,
      slug: ctx.identity.tenantSlug,
      name: ctx.identity.tenantName,
    },
    profile: {
      memberId: member.id,
      email: member.email,
      displayName: member.displayName,
      tags: member.tags,
      marketingConsents: member.marketingConsents,
      externalCustomerIds: member.externalCustomerIds,
      createdAt: member.createdAt,
    },
    consents: { terms, marketing },
    grants,
    subscriptions,
    orders,
    invoices,
    courseProgress,
    posts: posts.map((post) => ({
      id: post.id,
      contextKind: post.contextKind,
      contextId: post.contextId,
      body: post.body,
      createdAt: post.createdAt,
      editedAt: post.editedAt,
      deletedAt: post.deletedAt,
    })),
  });
  const date = exportedAt.slice(0, 10);
  const tenantSlug = ctx.identity.tenantSlug ?? tenant.value;
  return ok({
    filename: `moje-dane-${tenantSlug}-${date}.json`,
    mimeType: 'application/json; charset=utf-8',
    content: JSON.stringify(pkg),
  });
};
