import {
  err,
  internal,
  m2mEnrollInputSchema,
  notFound,
  ok,
  unauthorized,
  validation,
  welcomeSetPassword,
  type AppError,
  type M2mEnrollInput,
  type ProductGrant,
  type Result,
  type Tenant,
  type TenantApiKey,
} from '@core/domain/index.js';

import type {
  ApiKeyCrypto,
  DevMagicLinkReader,
  EmailPort,
  ProductGrantRepository,
  ProductRepository,
  TenantApiKeyRepository,
} from '../ports.js';
import { ensureMember, type EnsureMemberDeps } from './ensure-member.js';

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

export interface M2mEnrollDeps extends EnsureMemberDeps {
  products: ProductRepository;
  grants: ProductGrantRepository;
  email: EmailPort;
  devMagicLinks: DevMagicLinkReader;
  appBaseUrl: string;
  exposeMagicLinks: boolean;
}

export interface M2mEnrollResult {
  memberId: string;
  grantId: string;
  renewed: boolean;
  magicLink: { email: string; url: string; token: string } | null;
}

const isActive = (grant: ProductGrant, now: string): boolean =>
  grant.startsAt <= now && (grant.expiresAt === null || grant.expiresAt >= now);

export const m2mEnroll = async (
  tenant: Pick<Tenant, 'id' | 'name'>,
  input: M2mEnrollInput,
  deps: M2mEnrollDeps,
): Promise<Result<M2mEnrollResult, AppError>> => {
  const parsed = m2mEnrollInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid enrollment payload', parsed.error.flatten()));

  const product = await deps.products.findById(tenant.id, parsed.data.productId);
  if (!product || !product.published) {
    return err(notFound(`No published product "${parsed.data.productId}" in this tenant`));
  }

  const member = await ensureMember(tenant.id, parsed.data.email, deps);
  if (!member.ok) return member;

  const now = deps.clock.nowIso();
  const newExpiresAt = parsed.data.expiresAt ?? null;
  const existing = await deps.grants.findGrant(tenant.id, member.value.id, parsed.data.productId);

  let grantId: string;
  let renewed: boolean;
  if (existing && isActive(existing, now)) {
    await deps.grants.setGrantWindow(tenant.id, existing.id, {
      startsAt: existing.startsAt,
      expiresAt: newExpiresAt,
    });
    grantId = existing.id;
    renewed = true;
  } else if (existing) {
    await deps.grants.setGrantWindow(tenant.id, existing.id, { startsAt: now, expiresAt: newExpiresAt });
    grantId = existing.id;
    renewed = false;
  } else {
    const grant: ProductGrant = {
      id: deps.ids.nextId(),
      tenantId: tenant.id,
      memberId: member.value.id,
      productId: parsed.data.productId,
      source: 'manual',
      startsAt: now,
      expiresAt: newExpiresAt,
      legacyId: null,
      createdAt: now,
    };
    await deps.grants.createGrant(tenant.id, grant);
    grantId = grant.id;
    renewed = false;
  }

  const language = parsed.data.language ?? 'pl';
  let magicLink: M2mEnrollResult['magicLink'] = null;
  if (parsed.data.doNotSendEmail !== true) {
    const { url } = await deps.authPort.createEnrollmentMagicLink({
      email: member.value.email,
      callbackURL: deps.appBaseUrl,
      tenantName: tenant.name,
      language,
    });
    const message = welcomeSetPassword(language, { tenantName: tenant.name, actionUrl: url });
    const sent = await deps.email.send({ to: member.value.email, ...message });
    if (!sent.ok) return err(internal('Could not send the enrollment email'));
    if (deps.exposeMagicLinks) magicLink = await deps.devMagicLinks.findByEmail(member.value.email);
  }

  return ok({ memberId: member.value.id, grantId, renewed, magicLink });
};
