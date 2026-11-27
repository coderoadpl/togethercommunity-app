import { createHash, randomBytes } from 'node:crypto';

import type { SignInClientCrypto } from '#core/server/index.js';

export const createSignInClientCrypto = (): SignInClientCrypto => ({
  generateId: () => `sc_${randomBytes(16).toString('base64url')}`,
  generateSecret: () => `tc_sc_${randomBytes(32).toString('base64url')}`,
  hash: (secret) => `v1:${createHash('sha256').update('together:sign-in-client').update(Buffer.from([0])).update(secret).digest('base64url')}`,
});
