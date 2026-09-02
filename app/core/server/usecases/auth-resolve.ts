import { normalizeEmail, ok, type AppError, type Result, type SignInMethod } from '#core/domain/index.js';

import type { SignInMethodReader } from '../ports.js';

export interface ResolveSignInMethodsDeps {
  signInMethods: SignInMethodReader;
}

/**
 * Passwordless is the answer for every identity the current tenant cannot
 * confirm holds a password, so an unknown address is indistinguishable from a
 * migrated member and the endpoint stays useless for enumeration.
 */
export const resolveSignInMethods = async (
  tenantId: string | null,
  input: { email: string },
  deps: ResolveSignInMethodsDeps,
): Promise<Result<{ methods: SignInMethod[] }, AppError>> => {
  const password = tenantId === null
    ? false
    : await deps.signInMethods.hasCredentialAccount(tenantId, normalizeEmail(input.email));
  return ok({ methods: password ? ['password', 'magic-link'] : ['magic-link'] });
};
