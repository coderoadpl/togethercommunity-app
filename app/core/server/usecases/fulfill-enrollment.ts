import {
  err,
  internal,
  notFound,
  ok,
  welcomeSetPassword,
  type AppError,
  type GrantSource,
  type Result,
  type Tenant,
} from '@core/domain/index.js';

import type {
  DevMagicLinkReader,
  EmailPort,
  ProductGrantRepository,
  ProductRepository,
  TenantRepository,
} from '../ports.js';
import { ensureMember, type EnsureMemberDeps } from './ensure-member.js';
import { createOrRenewGrant } from './grant-window.js';

export interface FulfillEnrollmentDeps extends EnsureMemberDeps {
  products: ProductRepository;
  grants: ProductGrantRepository;
  tenants: TenantRepository;
  email: EmailPort;
  devMagicLinks: DevMagicLinkReader;
  appBaseUrl: string;
  baseDomain: string;
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
  },
  deps: FulfillEnrollmentDeps,
): Promise<Result<FulfillEnrollmentResult, AppError>> => {
  const product = await deps.products.findById(tenant.id, input.productId);
  if (!product || !product.published) return err(notFound(`No published product "${input.productId}" in this tenant`));

  const member = await ensureMember(tenant.id, input.email, deps);
  if (!member.ok) return member;

  const grant = await createOrRenewGrant(
    tenant.id,
    { memberId: member.value.id, productId: input.productId, expiresAt: input.expiresAt, source: input.source },
    deps,
  );

  let magicLink: FulfillEnrollmentResult['magicLink'] = null;
  if (input.sendEmail) {
    const tenantBaseUrl = new URL(deps.appBaseUrl);
    tenantBaseUrl.hostname = `${tenant.slug}.${deps.baseDomain}`;
    const created = await deps.authPort.createEnrollmentMagicLink({
      email: member.value.email,
      callbackURL: tenantBaseUrl.toString(),
      baseUrl: tenantBaseUrl.toString(),
      tenantName: tenant.name,
      language: input.language,
    });
    const settings = await deps.tenants.findSettings(tenant.id);
    const message = welcomeSetPassword(input.language, {
      tenantName: tenant.name,
      actionUrl: created.url,
      ...(settings === null
        ? {}
        : { branding: { logoUrl: settings.logoUrl, accentColor: settings.accentColor } }),
    });
    const sent = await deps.email.send({ to: member.value.email, ...message });
    if (!sent.ok) return err(internal('Could not send the enrollment email'));
    if (deps.exposeMagicLinks) magicLink = await deps.devMagicLinks.findByEmail(member.value.email);
  }

  return ok({ memberId: member.value.id, grantId: grant.grantId, renewed: grant.renewed, magicLink });
};
