import {
  err,
  m2mEnrollInputSchema,
  ok,
  unauthorized,
  validation,
  type AppError,
  type M2mEnrollInput,
  type Result,
  type Tenant,
  type TenantApiKey,
} from '@core/domain/index.js';

import type {
  ApiKeyCrypto,
  OrderRepository,
  ProductPriceRepository,
  TenantApiKeyRepository,
} from '../ports.js';
import { fulfillEnrollment, type FulfillEnrollmentDeps } from './fulfill-enrollment.js';
import { appendOrder } from './subscription-lifecycle.js';

export interface ApiKeyAuthDeps {
  tenantApiKeys: TenantApiKeyRepository;
  apiKeyCrypto: ApiKeyCrypto;
}

export const authenticateApiKey = async (
  tenantId: string,
  presentedSecret: string,
  deps: ApiKeyAuthDeps,
): Promise<Result<TenantApiKey, AppError>> => {
  const secret = presentedSecret.trim();
  if (!secret) return err(unauthorized('Missing API key'));
  const found = await deps.tenantApiKeys.findActiveByHash(tenantId, deps.apiKeyCrypto.hash(secret));
  if (!found) return err(unauthorized('Invalid API key'));
  return ok(found);
};

export interface M2mEnrollDeps extends FulfillEnrollmentDeps {
  prices: ProductPriceRepository;
  orders: OrderRepository;
}

export interface M2mEnrollResult {
  memberId: string;
  grantId: string;
  renewed: boolean;
  magicLink: { email: string; url: string; token: string } | null;
}

export const m2mEnroll = async (
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>,
  input: M2mEnrollInput,
  deps: M2mEnrollDeps,
): Promise<Result<M2mEnrollResult, AppError>> => {
  const parsed = m2mEnrollInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid enrollment payload', parsed.error.flatten()));

  const price = parsed.data.priceId ? await deps.prices.findById(tenant.id, parsed.data.priceId) : null;
  if (parsed.data.priceId && (!price || price.productId !== parsed.data.productId)) {
    return err(validation(`No price "${parsed.data.priceId}" for product "${parsed.data.productId}"`));
  }

  const fulfilled = await fulfillEnrollment(
    tenant,
    {
      email: parsed.data.email,
      productId: parsed.data.productId,
      expiresAt: parsed.data.expiresAt ?? null,
      language: parsed.data.language ?? 'pl',
      source: 'manual',
      sendEmail: parsed.data.doNotSendEmail !== true,
    },
    deps,
  );
  if (!fulfilled.ok) return fulfilled;

  await appendOrder(
    tenant.id,
    {
      memberId: fulfilled.value.memberId,
      productId: parsed.data.productId,
      priceId: price?.id ?? null,
      kind: price?.kind ?? 'one_time',
      status: 'paid',
      amountCents: price?.amountCents ?? 0,
      currency: price?.currency ?? 'PLN',
      provider: 'simulated',
      providerObjectIds: { m2m: 'enroll', grant: fulfilled.value.grantId },
    },
    deps,
  );
  return fulfilled;
};
