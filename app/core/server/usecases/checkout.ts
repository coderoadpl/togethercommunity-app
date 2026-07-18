import {
  checkoutSessionInputSchema,
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type CheckoutSessionInput,
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

  const product = await deps.products.findById(tenant.id, parsed.data.productId);
  if (!product || !product.published) return err(notFound(`No published product "${parsed.data.productId}" in this tenant`));

  let price: ProductPrice | null = null;
  if (parsed.data.priceId !== undefined) {
    price = await deps.prices.findById(tenant.id, parsed.data.priceId);
    if (!price || price.productId !== product.id || !price.active) {
      return err(notFound(`No active price "${parsed.data.priceId}" for this product`));
    }
  }

  const checkoutPath = `${tenantBaseUrl}/checkout/${encodeURIComponent(product.id)}`;
  const created = await deps.payment.createCheckoutSession({
    tenantId: tenant.id,
    productId: product.id,
    productName: product.title,
    priceCents: price?.amountCents ?? product.priceCents,
    currency: price?.currency ?? product.currency,
    successUrl: `${checkoutPath}?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${checkoutPath}?status=cancelled`,
    ...(parsed.data.email === undefined ? {} : { customerEmail: parsed.data.email }),
    ...(parsed.data.language === undefined ? {} : { language: parsed.data.language }),
    ...(price === null ? {} : { priceId: price.id }),
    ...(price !== null && price.kind === 'recurring' && price.interval !== null
      ? { recurringInterval: price.interval }
      : {}),
  });
  return created.ok ? ok({ url: created.value.url }) : created;
};
