import {
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type MemberSubscriptionListItem,
  type OrderListItem,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  MemberRepository,
  MemberOrderListReader,
  MemberSubscriptionRepository,
  ProductBatchReader,
} from '../ports.js';

export interface MemberCommerceOverview {
  purchases: OrderListItem[];
  activeSubscriptions: MemberSubscriptionListItem[];
}

export const getMemberCommerceOverview = async (
  ctx: Ctx,
  input: { memberId: string },
  deps: {
    members: MemberRepository;
    orders: MemberOrderListReader;
    products: ProductBatchReader;
    subscriptions: MemberSubscriptionRepository;
  },
): Promise<Result<MemberCommerceOverview, AppError>> => {
  const tenantId = authorizeTenant(ctx, 'member:commerce:read');
  if (!tenantId.ok) return tenantId;
  if (input.memberId.trim().length === 0) return err(validation('memberId is required'));

  const member = await deps.members.findById(tenantId.value, input.memberId);
  if (member === null) return err(notFound('Member was not found'));

  const [purchases, subscriptions] = await Promise.all([
    deps.orders.listForMember(tenantId.value, member.id),
    deps.subscriptions.listForMember(tenantId.value, member.id),
  ]);
  const currentSubscriptions = subscriptions.filter((subscription) => subscription.status !== 'canceled');
  const products = await deps.products.findByIds(
    tenantId.value,
    [...new Set(currentSubscriptions.map((subscription) => subscription.productId))],
  );
  const productTitles = new Map(products.map((product) => [product.id, product.title]));

  return ok({
    purchases,
    activeSubscriptions: currentSubscriptions.flatMap((subscription) => {
      const productTitle = productTitles.get(subscription.productId);
      return productTitle === undefined ? [] : [{ ...subscription, productTitle }];
    }),
  });
};
