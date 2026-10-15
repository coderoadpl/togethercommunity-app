import { checkoutSessionStatusInputSchema, err, ok, validation, type AppError, type Result, type CheckoutPurchaseAnalytics } from '#core/domain/index.js';

import type { PaymentRefundRepository, TenantRepository, ProductRepository } from '../ports.js';
import type { SalesLinkRepository } from '../sales-link-ports.js';

export const getCheckoutSessionStatus = async (
  tenantId: string,
  sessionId: string,
  deps: {
    paymentRefunds: Pick<PaymentRefundRepository, 'findOrderByProviderObjectIds'>;
    tenants: Pick<TenantRepository, 'findSettings'>;
    products: Pick<ProductRepository, 'findById'>;
    salesLinks?: Pick<SalesLinkRepository, 'findById'>;
  },
): Promise<Result<{ status: 'pending' | 'paid'; analytics?: CheckoutPurchaseAnalytics }, AppError>> => {
  const parsed = checkoutSessionStatusInputSchema.safeParse({ session_id: sessionId });
  if (!parsed.success) return err(validation('Invalid checkout session id'));
  const mode = parsed.data.session_id.startsWith('cs_test_') ? 'test' : 'live';
  const order = await deps.paymentRefunds.findOrderByProviderObjectIds(
    tenantId, { checkoutSession: parsed.data.session_id }, mode,
  );
  const paid = order !== null && order.tenantId === tenantId && order.mode === mode &&
    order.providerObjectIds.checkoutSession === parsed.data.session_id &&
    ['paid', 'partially_refunded', 'refunded'].includes(order.status);
  if (!paid || order === null) return ok({ status: 'pending' });
  const settings = await deps.tenants.findSettings(tenantId);
  if (!settings?.analyticsTagId && !settings?.analyticsMetaPixelId) return ok({ status: 'paid' });
  const lines = order.lines ?? [];
  const product = lines.length === 0 ? await deps.products.findById(tenantId, order.productId) : null;
  const salesLink = order.salesLinkId == null ? null : await deps.salesLinks?.findById(tenantId, order.salesLinkId);
  return ok({
    status: 'paid',
    analytics: {
      transactionId: order.id,
      fbclid: order.attribution?.fbclid ?? null,
      attributionAt: order.attribution?.capturedAt ?? null,
      value: order.amountCents / 100,
      currency: order.currency,
      offerSlug: salesLink?.tenantId === tenantId ? salesLink.slug : null,
      items: lines.length > 0
        ? lines.map((line) => ({ itemId: line.productId, itemName: line.name, price: line.grossCents / 100 }))
        : product === null ? [] : [{ itemId: product.id, itemName: product.title, price: order.amountCents / 100 }],
    },
  });
};
