import {
  appError,
  err,
  notFound,
  ok,
  ORGANIZATION_SECRET_GROUP,
  organizationSecretKeySchema,
  setOrganizationSecretInputSchema,
  validation,
  type AppError,
  type OrganizationAuditEvent,
  type OrganizationSecret,
  type OrganizationSecretKey,
  type OrganizationSecretMasked,
  type Result,
  type SetOrganizationSecretInput,
} from '#core/domain/index.js';

import { authorizeOrganization } from '../authorize.js';
import type { OrganizationCtx } from '../context.js';
import type { Clock, IdGenerator, OrganizationSecretRepository, SecretCrypto } from '../ports.js';

export interface OrganizationSecretDeps {
  organizationSecrets: OrganizationSecretRepository;
  secretCrypto: SecretCrypto;
  ids: IdGenerator;
  clock: Clock;
}

const MASK = '••••';
const MIN_LENGTH_WITH_VISIBLE_SUFFIX = 12;

const maskOrganizationSecretValue = (value: string): string =>
  value.length >= MIN_LENGTH_WITH_VISIBLE_SUFFIX ? `${MASK}${value.slice(-4)}` : MASK;

const masked = (secret: OrganizationSecret): OrganizationSecretMasked => ({
  key: secret.key,
  maskedPreview: secret.maskedPreview,
  updatedAt: secret.updatedAt,
});

const auditOf = (
  octx: OrganizationCtx,
  deps: Pick<OrganizationSecretDeps, 'ids' | 'clock'>,
  kind: 'secret.set' | 'secret.deleted',
): Omit<OrganizationAuditEvent, 'organizationId' | 'data'> => ({
  id: deps.ids.nextId(),
  kind,
  actorUserId: octx.identity.userId,
  actorEmail: octx.identity.email,
  actorKeyId: null,
  subjectTenantId: null,
  subjectUserId: null,
  at: deps.clock.nowIso(),
});

export const listOrganizationSecrets = async (
  octx: OrganizationCtx,
  input: { organizationId: string },
  deps: Pick<OrganizationSecretDeps, 'organizationSecrets'>,
): Promise<Result<{ secrets: OrganizationSecretMasked[] }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:secret:read');
  if (!access.ok) return access;
  const rows = await deps.organizationSecrets.listByOrganization(access.value.organizationId);
  return ok({ secrets: rows.map(masked) });
};

export const setOrganizationSecret = async (
  octx: OrganizationCtx,
  input: { organizationId: string } & SetOrganizationSecretInput,
  deps: OrganizationSecretDeps,
): Promise<Result<{ secret: OrganizationSecretMasked }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:secret:write');
  if (!access.ok) return access;
  const parsed = setOrganizationSecretInputSchema.safeParse({ key: input.key, value: input.value });
  if (!parsed.success) return err(validation('Invalid organization secret', parsed.error.flatten()));
  const { key, value } = parsed.data;
  const audit = auditOf(octx, deps, 'secret.set');
  const stored = await deps.organizationSecrets.set(access.value.organizationId, {
    secret: {
      id: deps.ids.nextId(),
      key,
      ...deps.secretCrypto.encrypt(value),
      maskedPreview: maskOrganizationSecretValue(value),
      updatedAt: audit.at,
    },
    group: ORGANIZATION_SECRET_GROUP[key],
    audit,
  });
  return ok({ secret: masked(stored) });
};

export const deleteOrganizationSecret = async (
  octx: OrganizationCtx,
  input: { organizationId: string; key: OrganizationSecretKey },
  deps: Pick<OrganizationSecretDeps, 'organizationSecrets' | 'ids' | 'clock'>,
): Promise<Result<{ key: OrganizationSecretKey }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:secret:write');
  if (!access.ok) return access;
  const parsed = organizationSecretKeySchema.safeParse(input.key);
  if (!parsed.success) return err(validation('Invalid organization secret key', parsed.error.flatten()));
  const key = parsed.data;
  const result = await deps.organizationSecrets.delete(access.value.organizationId, {
    key,
    group: ORGANIZATION_SECRET_GROUP[key],
    audit: auditOf(octx, deps, 'secret.deleted'),
  });
  switch (result.status) {
    case 'deleted': return ok({ key });
    case 'not_found': return err(notFound(`No secret "${key}" in this organization`));
    case 'config_inherited':
      return err(appError('conflict', `A workspace takes ${ORGANIZATION_SECRET_GROUP[key]} from the organization; switch it back to its own values first`));
  }
};
