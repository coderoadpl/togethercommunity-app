import { checkoutSessionStatusInputSchema, err, ok, resolveCheckoutReturnUrl, orderLineQuantity, productLines, validation, type AppError, type Result, type CheckoutPurchaseAnalytics, type Language, type OrderLine, type TenantSettings } from '#core/domain/index.js';

import type { PaymentRefundRepository, TenantRepository, ProductRepository, SalesLinkRepository } from '../ports.js';
import type { CheckoutSnapshotRepository } from '../checkout-snapshot-ports.js';
import type { MetaCapiConfig } from '#core/domain/meta-capi.js';
import { getMetaCapiConfig, type MetaCapiDeps } from './meta-capi.js';

const analyticsItem = (line: OrderLine): CheckoutPurchaseAnalytics['items'][number] => {
  const quantity = orderLineQuantity(line);
  const item = { itemId: line.productId, itemName: line.name, price: line.grossCents / quantity / 100 };
  return quantity === 1 ? item : { ...item, quantity };
};

type ShopReturn = { returnUrl: string; checkoutRef: string };

const shopReturn = async (
  tenantId: string,
  sessionId: string,
  settings: TenantSettings | null,
  checkoutSnapshots: Pick<CheckoutSnapshotRepository, 'findByProviderSession'> | undefined,
): Promise<ShopReturn | Record<string, never>> => {
  const origins = settings?.checkoutReturnOrigins ?? [];
  if (origins.length === 0 || checkoutSnapshots === undefined) return {};
  const snapshot = await checkoutSnapshots.findByProviderSession(tenantId, sessionId);
  if (snapshot?.tenantId !== tenantId || snapshot.providerSessionId !== sessionId || snapshot.returnUrl == null) return {};
  const returnUrl = resolveCheckoutReturnUrl(snapshot.returnUrl, origins);
  return returnUrl === null ? {} : { returnUrl, checkoutRef: snapshot.id };
};

export const getCheckoutSessionStatus = async (
  tenantId: string,
  sessionId: string,
  deps: {
    paymentRefunds: Pick<PaymentRefundRepository, 'findOrderByProviderObjectIds'>;
    tenants: Pick<TenantRepository, 'findSettings'>;
    products: Pick<ProductRepository, 'findById'>;
    salesLinks?: Pick<SalesLinkRepository, 'findById'>;
    checkoutSnapshots?: Pick<CheckoutSnapshotRepository, 'findByProviderSession'>;
    metaCapi?: MetaCapiDeps;
  },
  locale?: Language,
): Promise<Result<{ status: 'pending' | 'paid' | 'cancelled'; charged?: boolean; clientReference?: string; returnUrl?: string; checkoutRef?: string; analytics?: CheckoutPurchaseAnalytics; metaCapi?: MetaCapiConfig }, AppError>> => {
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
  if (order.cancelReason != null) return ok({ status: 'cancelled', charged: order.amountCents > 0 });
  const settings = await deps.tenants.findSettings(tenantId);
  const metaCapiEnabled = settings?.analyticsMetaCapiEnabled === true && !!settings.analyticsMetaPixelId;
  const metaCapi = deps.metaCapi && metaCapiEnabled ? await getMetaCapiConfig(tenantId, sessionId, deps.metaCapi, locale) : undefined;
  const capi = metaCapi === undefined ? {} : { metaCapi };
  const reference = {
    ...(order.clientReference == null ? {} : { clientReference: order.clientReference }),
    ...await shopReturn(tenantId, parsed.data.session_id, settings, deps.checkoutSnapshots),
  };
  if (!settings?.analyticsTagId && !settings?.analyticsMetaPixelId) return ok({ status: 'paid', ...reference, ...capi });
  const lines = productLines(order.lines ?? []);
  const product = lines.length === 0 ? await deps.products.findById(tenantId, order.productId) : null;
  const salesLink = order.salesLinkId == null ? null : await deps.salesLinks?.findById(tenantId, order.salesLinkId);
  return ok({
    status: 'paid',
    ...reference,
    ...capi,
    analytics: {
      transactionId: order.id,
      fbclid: order.attribution?.fbclid ?? null,
      attributionAt: order.attribution?.capturedAt ?? null,
      value: order.amountCents / 100,
      currency: order.currency,
      offerSlug: salesLink?.tenantId === tenantId ? salesLink.slug : null,
      items: lines.length > 0
        ? lines.map(analyticsItem)
        : product === null ? [] : [{ itemId: product.id, itemName: product.title, price: order.amountCents / 100 }],
    },
  });
};
