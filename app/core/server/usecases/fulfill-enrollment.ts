import {
  err,
  notFound,
  ok,
  type AppError,
  type GrantSource,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type {
  DevMagicLinkReader,
  EnrollmentTransactionPort,
  ProductGrantRepository,
  ProductRepository,
  TenantRepository,
} from '../ports.js';
import { tenantUrl, type TenantUrlDeps } from '../tenant-url.js';
import { ensureMember, type EnsureMemberDeps } from './ensure-member.js';
import { createOrRenewGrant } from './grant-window.js';

export interface FulfillEnrollmentDeps extends EnsureMemberDeps, TenantUrlDeps {
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
    email: string;
    productId: string;
    expiresAt: string | null;
    language: string;
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
    const grant = await createOrRenewGrant(
      tenant.id,
      { memberId: member.value.id, productId: input.productId, expiresAt: input.expiresAt, source: input.source },
      { ...deps, grants: transaction.grants },
    );
    if (input.sendEmail) {
      const tenantBaseUrl = tenantUrl(tenant.slug, '/', deps);
      const created = await deps.authPort.createEnrollmentMagicLink({
        email: member.value.email,
        callbackURL: tenantBaseUrl,
        baseUrl: tenantBaseUrl,
        tenantName: tenant.name,
        language: input.language,
      });
      const settings = await deps.tenants.findSettings(tenant.id);
      const queued = await transaction.emailOutbox.enqueue({
        id: deps.ids.nextId(),
        tenantId: tenant.id,
        to: member.value.email,
        payload: {
          kind: 'welcome-set-password',
          language: input.language,
          tenantName: tenant.name,
          actionUrl: created.url,
          ...(settings === null ? {} : { branding: { logoUrl: settings.logoUrl, accentColor: settings.accentColor } }),
        },
        now: deps.clock.nowIso(),
      });
      if (!queued.ok) return queued;
    }
    return ok({ member: member.value, grant });
  });
  if (!completed.ok) return completed;
  if (input.sendEmail) deps.dispatchEmail();
  const magicLink = input.sendEmail && deps.exposeMagicLinks
    ? await deps.devMagicLinks.findByEmail(completed.value.member.email)
    : null;
  return ok({ memberId: completed.value.member.id, grantId: completed.value.grant.grantId, renewed: completed.value.grant.renewed, magicLink });
};
