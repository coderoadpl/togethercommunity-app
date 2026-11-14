import { checkoutShippingSnapshotSchema, err, ok, resolveProductVat, SHIPPING_LINE_TYPE, splitProductGross, validation, type AppError, type CheckoutShippingSnapshot, type OrderAttribution, type OrderLine, type Result } from '#core/domain/index.js';
import { resolveSalesLinkPrices, type CheckoutSelection } from './checkout-selection.js';
import type { TenantRepository, IdGenerator, Clock } from '../ports.js';
import type { CheckoutSnapshotRepository } from '../checkout-snapshot-ports.js';

interface CheckoutLineDeps {
  tenants?: TenantRepository;
  checkoutSnapshots?: CheckoutSnapshotRepository;
  ids?: IdGenerator;
  clock?: Clock;
}

interface CheckoutLines {
  lines: OrderLine[];
  totalCents: number;
  currency: string;
  shippingCents?: number;
}

const shippingLine = (shipping: CheckoutShippingSnapshot): OrderLine => ({
  productId: `shipping:${shipping.rateId}`,
  name: shipping.label,
  productType: SHIPPING_LINE_TYPE,
  ...splitProductGross(shipping.amountCents, shipping.vatRatePercent),
  vatRate: shipping.vatRatePercent,
  vatExemptionBasis: null,
  vatExemptionBasisKind: null,
  issuedCount: null,
});

export const buildCheckoutLines = async (
  tenantId: string,
  selection: CheckoutSelection,
  deps: Pick<CheckoutLineDeps, 'tenants'>,
): Promise<Result<CheckoutLines, AppError>> => {
  const { product, price } = selection;
  const selectedProducts = selection.products ?? [product];
  const resolvedPrices = selection.products === undefined ? null : resolveSalesLinkPrices(selectedProducts, selection.productPrices ?? []);
  if (resolvedPrices !== null && !resolvedPrices.ok) return resolvedPrices;
  const productPrices = resolvedPrices?.value;
  const totalCents = productPrices?.reduce((total, item) => total + item.amountCents, 0) ?? price?.amountCents ?? product.priceCents;
  const settings = await deps.tenants?.findSettings(tenantId);
  const lines: OrderLine[] = selectedProducts.map((item) => {
    const vat = resolveProductVat(item, settings ?? null);
    const linePrice = productPrices?.find((selectedPrice) => selectedPrice.productId === item.id);
    const snapshotVat = selection.salesLinkId === undefined && item.vatRate == null ? null : vat;
    return {
      productId: item.id, name: item.title, productType: item.type,
      ...(linePrice === undefined ? {} : { priceId: linePrice.id }),
      ...splitProductGross(linePrice?.amountCents ?? totalCents, vat?.kind === 'rate' ? vat.percent : 'exempt'),
      vatRate: snapshotVat === null ? null : snapshotVat.kind === 'rate' ? snapshotVat.percent : 'exempt',
      vatExemptionBasis: snapshotVat?.kind === 'exempt' ? snapshotVat.basis : null,
      vatExemptionBasisKind: snapshotVat?.kind === 'exempt' ? snapshotVat.basisKind : null,
      issuedCount: item.type === 'physical' ? 0 : null,
    };
  });
  if (selection.salesLinkId !== undefined && lines.some((line) => line.vatRate === null)) return err(validation('Configure a VAT rate for every sales-link product'));
  const currency = productPrices?.[0]?.currency ?? price?.currency ?? product.currency;
  if (selection.shipping === undefined) return ok({ lines, totalCents, currency });
  return ok({ lines: [...lines, shippingLine(selection.shipping)], totalCents, currency, shippingCents: selection.shipping.amountCents });
};

export const captureCheckoutSelection = async (
  tenantId: string,
  selection: CheckoutSelection,
  deps: CheckoutLineDeps,
  attribution?: OrderAttribution,
): Promise<Result<CheckoutLines & { checkoutSnapshotId?: string }, AppError>> => {
  const built = await buildCheckoutLines(tenantId, selection, deps);
  if (!built.ok) return built;
  if (deps.checkoutSnapshots === undefined || deps.ids === undefined || deps.clock === undefined) {
    return selection.salesLinkId === undefined ? built : err(validation('Sales link checkout is not configured'));
  }
  const shipping = selection.shipping === undefined ? undefined : checkoutShippingSnapshotSchema.safeParse(selection.shipping);
  if (shipping?.success === false) return err(validation('Checkout shipping selection is invalid'));
  const checkoutSnapshotId = deps.ids.nextId();
  await deps.checkoutSnapshots.create(tenantId, {
    attribution: attribution ?? null, id: checkoutSnapshotId, tenantId, salesLinkId: selection.salesLinkId ?? null,
    lines: built.value.lines, ...(shipping === undefined ? {} : { shipping: shipping.data }), currency: built.value.currency, createdAt: deps.clock.nowIso(),
  });
  return ok({ ...built.value, checkoutSnapshotId });
};
