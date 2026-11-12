import {
  err,
  isShippingLine,
  normalizeEmail,
  ok,
  orderShippingFrom,
  SIMULATED_SHIPPING_DETAILS,
  tenantNotFound,
  validation,
  type AppError,
  type Result,
  type BillingData,
  type SalesLinkVariantSelection,
  type CheckoutShippingInput,
} from '#core/domain/index.js';

import type { AuthPort, EmailOutboxRepository, MemberRepository, ProductRepository, PurchaseRepository, TenantRepository } from '../ports.js';
import type { SalesLinkRepository } from '../sales-link-ports.js';
import type { StockRepository } from '../stock-ports.js';
import { buildCheckoutLines } from './checkout-lines.js';
import { validateCheckoutSelection } from './checkout.js';
import { createOrRenewGrant } from './grant-window.js';
import { ensureMember } from './ensure-member.js';
import { appendOrder, startSubscription, type SubscriptionLifecycleDeps } from './subscription-lifecycle.js';
import { commitCheckoutStock, reserveCheckoutStock, type CommitCheckoutStockDeps } from './stock.js';

export interface SimulatePurchaseResult {
  memberId: string;
  productId: string;
  alreadyOwned: boolean;
  subscriptionId: string | null;
  orderId: string | null;
}

export interface SimulatePurchaseDeps extends SubscriptionLifecycleDeps, Omit<CommitCheckoutStockDeps, 'stock' | 'emailOutbox'> {
  products: ProductRepository;
  purchases: PurchaseRepository;
  members: MemberRepository;
  authPort: AuthPort;
  tenants: TenantRepository;
  salesLinks?: SalesLinkRepository;
  stock?: StockRepository;
  paymentTransaction?: {
    run<T>(operation: (transaction: Pick<SimulatePurchaseDeps, 'members' | 'orders' | 'grants' | 'stock'> & { emailOutbox: Pick<EmailOutboxRepository, 'enqueue'> }) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
  };
}

export interface SimulatePurchaseInputData {
  email: string;
  productId: string;
  salesLinkId?: string;
  salesLinkSlug?: string;
  variantSelections?: SalesLinkVariantSelection[];
  priceId?: string;
  billing?: BillingData;
  shipping?: CheckoutShippingInput;
}

export const simulatePurchase = async (
  tenantId: string,
  input: SimulatePurchaseInputData,
  deps: SimulatePurchaseDeps,
): Promise<Result<SimulatePurchaseResult, AppError>> => {
  await deps.authPort.initialize();
  const selection = await validateCheckoutSelection(tenantId, input, deps);
  if (!selection.ok) return selection;
  const { product, price } = selection.value;
  const built = await buildCheckoutLines(tenantId, selection.value, deps);
  if (!built.ok) return built;
  const shipping = selection.value.shipping === undefined ? null : orderShippingFrom(selection.value.shipping, SIMULATED_SHIPPING_DETAILS);
  if (shipping !== null && !shipping.ok) return shipping;
  const selectedProducts = selection.value.products ?? [product];
  const tracked = price?.kind !== 'recurring' && deps.stock !== undefined &&
    (await deps.stock.listByProducts(tenantId, selectedProducts.map((item) => item.id))).length > 0;
  if (selection.value.salesLinkId !== undefined || product.type === 'physical' || tracked) {
    if (deps.paymentTransaction === undefined) return err(validation('Simulated purchase transaction is not configured'));
    return deps.paymentTransaction.run(async (transaction) => {
      const checkoutSession = `sim_cs_${deps.ids.nextId()}`;
      const member = await ensureMember(tenantId, input.email, { ...deps, members: transaction.members });
      if (!member.ok) return member;
      for (const line of built.value.lines) {
        if (line.productType === 'physical' || isShippingLine(line)) continue;
        await createOrRenewGrant(tenantId, { memberId: member.value.id, productId: line.productId, expiresAt: null, source: 'simulated' }, { ...deps, grants: transaction.grants });
      }
      const order = await appendOrder(tenantId, {
        memberId: member.value.id, productId: product.id, priceId: price?.id ?? null,
        kind: 'one_time', status: 'paid', amountCents: built.value.totalCents + (built.value.shippingCents ?? 0), currency: built.value.currency,
        provider: 'simulated', providerObjectIds: { checkoutSession },
        billing: input.billing ?? null, salesLinkId: selection.value.salesLinkId ?? null, lines: built.value.lines,
        ...(shipping === null ? {} : { shipping: shipping.value, fulfilmentStatus: 'to_pack' as const }),
      }, { ...deps, orders: transaction.orders });
      const hold = await reserveCheckoutStock(tenantId, { checkoutSnapshotId: checkoutSession, products: selectedProducts }, { stock: transaction.stock, clock: deps.clock });
      if (!hold.ok) return hold;
      if (hold.value !== null) {
        const tenant = await deps.tenants.findById(tenantId);
        if (tenant === null) return err(tenantNotFound());
        await commitCheckoutStock(tenant, { checkoutSnapshotId: checkoutSession, orderId: order.id, productIds: selectedProducts.map((item) => item.id) }, { ...deps, stock: transaction.stock, emailOutbox: transaction.emailOutbox });
      }
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
