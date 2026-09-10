import { ok, type AppError, type Result, type SignInMethod } from '#core/domain/index.js';

import type { SignInMethodReader } from '../ports.js';

export interface ResolveSignInMethodsDeps {
  signInMethods: SignInMethodReader;
}

export const resolveSignInMethods = async (
  tenantId: string | null,
  input: { email: string },
  deps: ResolveSignInMethodsDeps,
): Promise<Result<{ methods: SignInMethod[] }, AppError>> => {
  if (tenantId === null) return ok({ methods: ['magic-link'] });

  const [password, passkey] = await Promise.all([
    deps.signInMethods.hasCredentialAccount(tenantId, input.email),
    deps.signInMethods.hasPasskey(tenantId, input.email),
  ]);
  return ok({
    methods: [
      ...(password ? ['password' as const] : []),
      ...(passkey ? ['passkey' as const] : []),
      'magic-link',
    ],
  });
};
