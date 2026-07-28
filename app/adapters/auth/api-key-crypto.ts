import { createHash, randomBytes } from 'node:crypto';

import type { ApiKeyCrypto } from '#core/server/index.js';

export const createApiKeyCrypto = (): ApiKeyCrypto => ({
  generateSecret: () => randomBytes(32).toString('base64url'),
  hash: (secret) => createHash('sha256').update(secret).digest('hex'),
});
