import {
  err,
  normalizeEmail,
  ok,
  validation,
  type AppError,
  type Result,
  type BillingData,
} from '#core/domain/index.js';

import type { AuthPort, MemberRepository, ProductRepository, PurchaseRepository, TenantRepository } from '../ports.js';
import type { SalesLinkRepository } from '../sales-link-ports.js';
import { buildCheckoutLines } from './checkout-lines.js';
import { validateCheckoutSelection } from './checkout.js';
import { createOrRenewGrant } from './grant-window.js';
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
  tenants?: TenantRepository;
  salesLinks?: SalesLinkRepository;
  paymentTransaction?: {
    run<T>(operation: (transaction: Pick<SimulatePurchaseDeps, 'members' | 'orders' | 'grants'>) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
  };
}

export interface SimulatePurchaseInputData {
  email: string;
  productId: string;
  salesLinkId?: string;
  salesLinkSlug?: string;
  priceId?: string;
  billing?: BillingData;
}

export const simulatePurchase = async (
  tenantId: string,
  input: SimulatePurchaseInputData,
  deps: SimulatePurchaseDeps,
): Promise<Result<SimulatePurchaseResult, AppError>> => {
  const selection = await validateCheckoutSelection(tenantId, input, deps);
  if (!selection.ok) return selection;
  const { product, price } = selection.value;
  const built = await buildCheckoutLines(tenantId, selection.value, deps);
  if (!built.ok) return built;
  if (selection.value.salesLinkId !== undefined || product.type === 'physical') {
    if (deps.paymentTransaction === undefined) return err(validation('Simulated purchase transaction is not configured'));
    return deps.paymentTransaction.run(async (transaction) => {
      const member = await ensureMember(tenantId, input.email, { ...deps, members: transaction.members });
      if (!member.ok) return member;
      for (const line of built.value.lines) {
        if (line.productType === 'physical') continue;
        await createOrRenewGrant(tenantId, { memberId: member.value.id, productId: line.productId, expiresAt: null, source: 'simulated' }, { ...deps, grants: transaction.grants });
      }
      const order = await appendOrder(tenantId, {
        memberId: member.value.id, productId: product.id, priceId: price?.id ?? null,
        kind: 'one_time', status: 'paid', amountCents: built.value.totalCents, currency: built.value.currency,
        provider: 'simulated', providerObjectIds: { checkoutSession: `sim_cs_${deps.ids.nextId()}` },
        billing: input.billing ?? null, salesLinkId: selection.value.salesLinkId ?? null, lines: built.value.lines,
      }, { ...deps, orders: transaction.orders });
      return ok({ memberId: member.value.id, productId: product.id, alreadyOwned: false, subscriptionId: null, orderId: order.id });
    });
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
        amountCents: built.value.totalCents,
        lines: built.value.lines,
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
