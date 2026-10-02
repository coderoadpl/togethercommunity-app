import { stripeTestSessionEncryptedSchema, stripeTestSessionPayloadSchema, err, forbidden, ok, type AppError, type Identity, type Result } from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, SecretCrypto } from '../ports.js';

export const createStripeTestSession = (
  ctx: Ctx,
  deps: { secretCrypto: SecretCrypto; clock: Clock },
): Result<string, AppError> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  if (ctx.identity.staffRole === null || ctx.impersonation !== undefined) return err(forbidden());
  return ok(JSON.stringify(deps.secretCrypto.encrypt(JSON.stringify({
    userId: ctx.identity.userId, tenantId: tenant.value,
    expiresAt: Date.parse(deps.clock.nowIso()) + 60 * 60 * 1000,
  }))));
};

export const hasStripeTestSession = (
  identity: Identity | null,
  cookie: string | undefined,
  deps: { secretCrypto: SecretCrypto; clock: Clock },
): boolean => {
  if (identity === null || identity.staffRole === null || cookie === undefined) return false;
  let raw: unknown;
  try { raw = JSON.parse(cookie); } catch { return false; }
  const encrypted = stripeTestSessionEncryptedSchema.safeParse(raw);
  if (!encrypted.success) return false;
  const decrypted = deps.secretCrypto.decrypt(encrypted.data);
  if (!decrypted.ok) return false;
  let payload: unknown;
  try { payload = JSON.parse(decrypted.value); } catch { return false; }
  const session = stripeTestSessionPayloadSchema.safeParse(payload);
  return session.success && session.data.userId === identity.userId &&
    session.data.tenantId === identity.tenantId && session.data.expiresAt > Date.parse(deps.clock.nowIso());
};
