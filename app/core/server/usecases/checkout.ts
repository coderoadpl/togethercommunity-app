import {
  checkoutSessionInputSchema,
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type CheckoutSessionInput,
  type CheckoutConsentCapture,
  type Product,
  type ProductPrice,
  type Result,
  type Tenant,
} from '@core/domain/index.js';

import type {
  PaymentProvider,
  ProductPriceRepository,
  ProductRepository,
  TenantSecretRepository,
} from '../ports.js';

export interface CheckoutDeps {
  products: ProductRepository;
  prices: ProductPriceRepository;
  tenantSecrets: TenantSecretRepository;
  payment: PaymentProvider;
}

export interface CheckoutSelection {
  product: Product;
  price: ProductPrice | null;
}

export const getPaymentConfig = async (
  tenantId: string,
  deps: Pick<CheckoutDeps, 'tenantSecrets'>,
): Promise<Result<{ stripeConfigured: boolean }, AppError>> => {
  const [key, webhookSecret] = await Promise.all([
    deps.tenantSecrets.findByKey(tenantId, 'stripe.restrictedKey'),
    deps.tenantSecrets.findByKey(tenantId, 'stripe.webhookSecret'),
  ]);
  return ok({ stripeConfigured: key !== null && webhookSecret !== null });
};

export const validateCheckoutSelection = async (
  tenantId: string,
  input: Pick<CheckoutSessionInput, 'productId' | 'priceId'>,
  deps: Pick<CheckoutDeps, 'products' | 'prices'>,
): Promise<Result<CheckoutSelection, AppError>> => {
  const product = await deps.products.findById(tenantId, input.productId);
  if (!product || !product.published) {
    return err(notFound(`No published product "${input.productId}" in this tenant`));
  }

  let price: ProductPrice | null = null;
  if (input.priceId !== undefined) {
    price = await deps.prices.findById(tenantId, input.priceId);
    if (!price || price.productId !== product.id || !price.active) {
      return err(notFound(`No active price "${input.priceId}" for this product`));
    }
  }

  return ok({ product, price });
};

export const startCheckoutSession = async (
  tenant: Tenant,
  tenantBaseUrl: string,
  input: CheckoutSessionInput,
  selection: CheckoutSelection,
  deps: Pick<CheckoutDeps, 'payment'>,
  checkoutConsent?: CheckoutConsentCapture,
): Promise<Result<{ url: string }, AppError>> => {
  const { product, price } = selection;
  const checkoutPath = `${tenantBaseUrl}/checkout/${encodeURIComponent(product.id)}`;
  const purchaseKind = price?.kind === 'recurring' ? 'subscription' : 'one_time';
  const created = await deps.payment.createCheckoutSession({
    tenantId: tenant.id,
    productId: product.id,
    productName: product.title,
    priceCents: price?.amountCents ?? product.priceCents,
    currency: price?.currency ?? product.currency,
    successUrl: `${checkoutPath}?status=success&purchase_kind=${purchaseKind}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${checkoutPath}?status=cancelled`,
    ...(input.email === undefined ? {} : { customerEmail: input.email }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(price === null ? {} : { priceId: price.id }),
    ...(price !== null && price.kind === 'recurring' && price.interval !== null
      ? { recurringInterval: price.interval }
      : {}),
    ...(checkoutConsent === undefined ? {} : { checkoutConsent }),
  });
  return created.ok ? ok({ url: created.value.url }) : created;
};

export const createCheckoutSession = async (
  tenant: Tenant,
  tenantBaseUrl: string,
  input: CheckoutSessionInput,
  deps: CheckoutDeps,
): Promise<Result<{ url: string }, AppError>> => {
  const parsed = checkoutSessionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid checkout payload', parsed.error.flatten()));

  const configured = await getPaymentConfig(tenant.id, deps);
  if (!configured.ok) return configured;
  if (!configured.value.stripeConfigured) return err(validation('Stripe is not configured for this tenant'));

  const selection = await validateCheckoutSelection(tenant.id, parsed.data, deps);
  if (!selection.ok) return selection;
  return startCheckoutSession(tenant, tenantBaseUrl, parsed.data, selection.value, deps);
};
