import {
  appError,
  createSignInClientInputSchema,
  err,
  listSignInClientsInputSchema,
  ok,
  rotateSignInClientSecretInputSchema,
  signInClientCredentialSchema,
  signInClientIdSchema,
  validation,
  type AppError,
  type CreateSignInClientInput,
  type ListSignInClientsInput,
  type Result,
  type RotateSignInClientSecretInput,
  type SignInClientCredential,
  type SignInClientHosts,
  type SignInClientPage,
  type SignInClientPublic,
} from '#core/domain/index.js';

import { authorizeTenant, requireDirectGrant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { ownerSessionTenant } from '../owner-session.js';
import type { Clock, IdGenerator, SignInClientCrypto, SignInClientRepository, SignInClientWriteRefusal } from '../ports.js';

export interface SignInClientDeps {
  signInClients: SignInClientRepository;
  signInClientHosts: SignInClientHosts;
  signInClientCrypto: SignInClientCrypto;
  ids: IdGenerator;
  clock: Clock;
}

const ownerRefusal = 'Sign-in clients require a verified owner session with a direct workspace grant';
const ownerTenant = (ctx: Ctx, tenant: Result<string, AppError>): Result<string, AppError> =>
  requireDirectGrant(ctx, ownerSessionTenant(ctx, tenant, ownerRefusal), ownerRefusal);

const permittedHost = (hosts: SignInClientHosts, tenantId: string, host: string): AppError | null => {
  if (hosts.size === 0) return appError('forbidden', 'Sign-in client registration is disabled', { reason: 'registry_disabled' });
  if (hosts.get(tenantId)?.has(host) !== true) {
    return appError('forbidden', 'The return host is not approved for this workspace', { reason: 'host_not_preapproved' });
  }
  return null;
};

const refusal = (reason: SignInClientWriteRefusal): AppError => {
  switch (reason) {
    case 'host_unavailable': return appError('conflict', 'The return host is unavailable', { reason });
    case 'workspace_unavailable': return appError('forbidden', 'The workspace is not active', { reason });
    case 'client_not_found': return appError('not_found', 'Sign-in client not found', { reason });
    case 'credential_version_changed': return appError('conflict', 'The credential version changed', { reason });
    case 'client_retired': return appError('conflict', 'The sign-in client is retired', { reason });
  }
};

const mutation = (deps: Pick<SignInClientDeps, 'ids' | 'clock'>) => ({
  at: deps.clock.nowIso(),
  eventId: deps.ids.nextId(),
});

const issueSecret = (crypto: SignInClientCrypto, at: string) => {
  const secret = crypto.generateSecret();
  const secretExpiresAt = new Date(Date.parse(at) + 90 * 24 * 60 * 60 * 1000).toISOString();
  return { secret, stored: { secretHash: crypto.hash(secret), secretExpiresAt } };
};

const invalidInput = () => err(validation('Invalid sign-in client request'));

export const createSignInClient = async (
  ctx: Ctx,
  input: CreateSignInClientInput,
  deps: SignInClientDeps,
): Promise<Result<SignInClientCredential, AppError>> => {
  const tenant = ownerTenant(ctx, authorizeTenant(ctx, 'sign-in-client:write'));
  if (!tenant.ok) return tenant;
  const parsed = createSignInClientInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const redirectHost = URL.parse(parsed.data.redirectUris[0] ?? '')?.hostname;
  if (redirectHost === undefined) return invalidInput();
  const denied = permittedHost(deps.signInClientHosts, tenant.value, redirectHost);
  if (denied !== null) return err(denied);

  const stamp = mutation(deps);
  const { secret, stored } = issueSecret(deps.signInClientCrypto, stamp.at);
  const created = await deps.signInClients.create(tenant.value, {
    ...parsed.data, ...stored, ...stamp, redirectHost, id: deps.signInClientCrypto.generateId(),
  });
  return created.ok ? ok(signInClientCredentialSchema.parse({ client: created.value, secret })) : err(refusal(created.error));
};

export const listSignInClients = async (
  ctx: Ctx,
  input: ListSignInClientsInput,
  deps: Pick<SignInClientDeps, 'signInClients'>,
): Promise<Result<SignInClientPage, AppError>> => {
  const tenant = ownerTenant(ctx, authorizeTenant(ctx, 'sign-in-client:read'));
  if (!tenant.ok) return tenant;
  const parsed = listSignInClientsInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const { cursor, limit } = parsed.data;
  return ok(await deps.signInClients.list(tenant.value, { limit, ...(cursor === undefined ? {} : { cursor }) }));
};

export const rotateSignInClientSecret = async (
  ctx: Ctx,
  input: RotateSignInClientSecretInput & { id: string },
  deps: SignInClientDeps,
): Promise<Result<SignInClientCredential, AppError>> => {
  const tenant = ownerTenant(ctx, authorizeTenant(ctx, 'sign-in-client:write'));
  if (!tenant.ok) return tenant;
  const parsed = rotateSignInClientSecretInputSchema.extend({ id: signInClientIdSchema }).safeParse(input);
  if (!parsed.success) return invalidInput();
  const { id, expectedCredentialVersion } = parsed.data;
  const client = await deps.signInClients.findById(tenant.value, id);
  if (client === null) return err(refusal('client_not_found'));
  if (client.state === 'retired') return err(refusal('client_retired'));
  const denied = permittedHost(deps.signInClientHosts, tenant.value, client.redirectHost);
  if (denied !== null) return err(denied);
  const stamp = mutation(deps);
  const { secret, stored } = issueSecret(deps.signInClientCrypto, stamp.at);
  const rotated = await deps.signInClients.rotate(tenant.value, id, { expectedCredentialVersion, ...stored, ...stamp });
  return rotated.ok ? ok(signInClientCredentialSchema.parse({ client: rotated.value, secret })) : err(refusal(rotated.error));
};

export const disableSignInClient = async (
  ctx: Ctx,
  input: { id: string },
  deps: Pick<SignInClientDeps, 'signInClients' | 'clock' | 'ids'>,
): Promise<Result<SignInClientPublic, AppError>> => {
  const tenant = ownerTenant(ctx, authorizeTenant(ctx, 'sign-in-client:write'));
  if (!tenant.ok) return tenant;
  const parsed = signInClientIdSchema.safeParse(input.id);
  if (!parsed.success) return invalidInput();
  const disabled = await deps.signInClients.disable(tenant.value, parsed.data, mutation(deps));
  return disabled.ok ? disabled : err(refusal(disabled.error));
};
