import { ok, type AppError, type Result, type SignInMethod } from '#core/domain/index.js';

export const resolveSignInMethods = (): Result<{ methods: SignInMethod[] }, AppError> =>
  ok({ methods: ['password', 'passkey', 'magic-link'] });
