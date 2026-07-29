import {
  err,
  normalizeEmail,
  notFound,
  ok,
  validation,
  type AppError,
  type ProductPrice,
  type Result,
  type BillingData,
} from '#core/domain/index.js';

import type { AuthPort, MemberRepository, ProductRepository, PurchaseRepository } from '../ports.js';
import { ensureMember } from './ensure-member.js';
import { appendOrder, startSubscription, type SubscriptionLifecycleDeps } from './subscription-lifecycle.js';

export interface SimulatePurchaseResult {
  memberId: string;
  productId: string;
  alreadyOwned: boolean;
  subscriptionId: string | null;
  orderId: string | null;
}

export interface SimulatePurchaseDeps extends SubscriptionLifecycleDeps {
  products: ProductRepository;
  purchases: PurchaseRepository;
  members: MemberRepository;
  authPort: AuthPort;
}

export interface SimulatePurchaseInputData {
  email: string;
  productId: string;
  priceId?: string;
  billing?: BillingData;
}

export const simulatePurchase = async (
  tenantId: string,
  input: SimulatePurchaseInputData,
  deps: SimulatePurchaseDeps,
): Promise<Result<SimulatePurchaseResult, AppError>> => {
  const product = await deps.products.findById(tenantId, input.productId);
  if (!product || !product.published) {
    return err(notFound(`No published product "${input.productId}" in this tenant`));
  }

  let price: ProductPrice | null = null;
  if (input.priceId !== undefined) {
    price = await deps.prices.findById(tenantId, input.priceId);
    if (!price || price.productId !== product.id) {
      return err(notFound(`No price "${input.priceId}" for this product`));
    }
    if (!price.active) return err(validation('This price is no longer active'));
  }

  if (price?.kind === 'recurring') {
    const member = await ensureMember(tenantId, input.email, deps);
    if (!member.ok) return member;

    const existing = (await deps.subscriptions.listForMember(tenantId, member.value.id)).find(
      (subscription) => subscription.productId === product.id && subscription.status !== 'canceled',
    );
    if (existing) {
      return ok({
        memberId: member.value.id,
        productId: product.id,
        alreadyOwned: true,
        subscriptionId: existing.id,
        orderId: null,
      });
    }

    const started = await startSubscription(
      tenantId,
      {
        memberId: member.value.id,
        price,
        provider: 'simulated',
        providerSubscriptionId: `sim_sub_${deps.ids.nextId()}`,
        providerObjectIds: { checkoutSession: `sim_cs_${deps.ids.nextId()}` },
        billing: input.billing ?? null,
      },
      deps,
    );
    return ok({
      memberId: member.value.id,
      productId: product.id,
      alreadyOwned: false,
      subscriptionId: started.subscription.id,
      orderId: started.order.id,
    });
  }

  const normalizedEmail = normalizeEmail(input.email);
  const { userId } = await deps.authPort.ensureUser(normalizedEmail);
  const purchase = await deps.purchases.createMemberGrant({
    tenantId,
    userId,
    email: normalizedEmail,
    memberId: deps.ids.nextId(),
    grantId: deps.ids.nextId(),
    productId: input.productId,
    createdAt: deps.clock.nowIso(),
  });

  let orderId: string | null = null;
  if (purchase.grantCreated) {
    const order = await appendOrder(
      tenantId,
      {
        memberId: purchase.member.id,
        productId: product.id,
        priceId: price?.id ?? null,
        kind: 'one_time',
        status: 'paid',
        amountCents: price?.amountCents ?? product.priceCents,
        currency: price?.currency ?? product.currency,
        provider: 'simulated',
        providerObjectIds: { checkoutSession: `sim_cs_${deps.ids.nextId()}` },
        billing: input.billing ?? null,
      },
      deps,
    );
    orderId = order.id;
  }
  return ok({
    memberId: purchase.member.id,
    productId: input.productId,
    alreadyOwned: !purchase.grantCreated,
    subscriptionId: null,
    orderId,
  });
};
