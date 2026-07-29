import { createHash } from 'node:crypto';

import type { BunnyEmbedTokenSigner } from '#core/server/index.js';

export const createBunnyEmbedTokenSigner = (): BunnyEmbedTokenSigner => ({
  sign: ({ securityKey, videoId, expires }) =>
    createHash('sha256').update(`${securityKey}${videoId}${expires}`).digest('hex'),
});
