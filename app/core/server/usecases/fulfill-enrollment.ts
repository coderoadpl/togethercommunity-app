import {
  emailBrandingFrom,
  err,
  notFound,
  ok,
  resolveEmailLanguage,
  type AppError,
  type GrantSource,
  type Member,
  type Order,
  type Product,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type {
  DevMagicLinkReader,
  EnrollmentTransactionPort,
  ProductGrantRepository,
  ProductRepository,
  TenantRepository,
  EmailOutboxRepository,
} from '../ports.js';
import { resolveTenantOrigin, type TenantOriginDeps } from '../tenant-url.js';
import { ensureMember, type EnsureMemberDeps } from './ensure-member.js';
import { orderVerificationUrl } from '../order-verification-url.js';
import { createOrRenewGrant } from './grant-window.js';

export interface FulfillEnrollmentDeps extends EnsureMemberDeps, TenantOriginDeps {
  products: ProductRepository;
  grants: ProductGrantRepository;
  tenants: TenantRepository;
  enrollmentTransaction: EnrollmentTransactionPort;
  dispatchEmail(): void;
  devMagicLinks: DevMagicLinkReader;
  exposeMagicLinks: boolean;
}

export interface FulfillEnrollmentResult {
  memberId: string;
  grantId: string;
  renewed: boolean;
  magicLink: { email: string; url: string; token: string } | null;
}

export const fulfillEnrollment = async (
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>,
  input: {
    mode?: 'live' | 'test';
    email: string;
    productId: string;
    expiresAt: string | null;
    language: string | null;
    source: GrantSource;
    sendEmail: boolean;
    allowUnpublished?: boolean;
  },
  deps: FulfillEnrollmentDeps,
): Promise<Result<FulfillEnrollmentResult, AppError>> => {
  const product = await deps.products.findById(tenant.id, input.productId);
  if (!product || (!product.published && input.allowUnpublished !== true)) {
    return err(notFound(`No published product "${input.productId}" in this tenant`));
  }

  const completed = await deps.enrollmentTransaction.run(async (transaction) => {
    const member = await ensureMember(tenant.id, input.email, { ...deps, members: transaction.members });
    if (!member.ok) return member;
    const grant = product.type === 'physical' ? { grantId: '', renewed: false } : await createOrRenewGrant(
      tenant.id,
      { mode: input.mode ?? 'live', memberId: member.value.id, productId: input.productId, expiresAt: input.expiresAt, source: input.source },
      { ...deps, grants: transaction.grants },
    );
    if (input.sendEmail && input.mode !== 'test') {
      const queued = await queueEnrollmentWelcome(tenant, member.value, product, input.language, transaction.emailOutbox, deps);
      if (!queued.ok) return queued;
    }
    return ok({ member: member.value, grant });
  });
  if (!completed.ok) return completed;
  if (input.sendEmail && input.mode !== 'test') deps.dispatchEmail();
  const magicLink = input.sendEmail && input.mode !== 'test' && deps.exposeMagicLinks
    ? await deps.devMagicLinks.findByEmail(completed.value.member.email)
    : null;
  return ok({ memberId: completed.value.member.id, grantId: completed.value.grant.grantId, renewed: completed.value.grant.renewed, magicLink });
};

export const queueEnrollmentWelcome = async (
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>,
  member: Member,
  product: Product,
  inputLanguage: string | null,
  outbox: EmailOutboxRepository,
  deps: FulfillEnrollmentDeps,
  order?: Order,
) => {
  const tenantBaseUrl = `${await resolveTenantOrigin(tenant, deps)}/`;
  const settings = await deps.tenants.findSettings(tenant.id);
  const language = resolveEmailLanguage(
    member.language,
    inputLanguage,
    settings?.defaultLanguage,
  );
  const created = await deps.authPort.createEnrollmentMagicLink({
    email: member.email,
    callbackURL: tenantBaseUrl,
    baseUrl: tenantBaseUrl,
    tenantName: tenant.name,
    language,
  });
  const queued = await outbox.enqueue({
    id: deps.ids.nextId(),
    tenantId: tenant.id,
    to: member.email,
    payload: {
      kind: 'welcome-sign-in',
      language,
      tenantName: tenant.name,
      actionUrl: created.url,
      productType: product.type,
      ...(order?.verificationToken === undefined ? {} : { purchase: {
        orderNumber: order.id,
        verificationUrl: orderVerificationUrl(tenantBaseUrl, order.verificationToken),
        qrImageUrl: new URL(`/api/public/orders/qr/${order.verificationToken}`, tenantBaseUrl).toString(),
        lines: order.lines?.map((line) => line.name) ?? [product.title],
      } }),
      ...(settings === null ? {} : { branding: emailBrandingFrom(settings, tenantBaseUrl) }),
    },
    now: deps.clock.nowIso(),
  });
  return queued;
};
