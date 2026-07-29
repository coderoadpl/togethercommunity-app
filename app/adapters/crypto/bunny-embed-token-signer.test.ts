import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createBunnyEmbedTokenSigner } from './bunny-embed-token-signer.js';

describe('Bunny embed token signer', () => {
  it('hashes the security key, video id and expiry in Bunny order', () => {
    const signer = createBunnyEmbedTokenSigner();
    const input = { securityKey: 'security-key', videoId: 'video-1', expires: 1782900000 };

    expect(signer.sign(input)).toBe(
      createHash('sha256')
        .update(`${input.securityKey}${input.videoId}${input.expires}`)
        .digest('hex'),
    );
    expect(signer.sign({ ...input, videoId: 'video-2' })).not.toBe(signer.sign(input));
    expect(signer.sign({ ...input, expires: input.expires + 1 })).not.toBe(signer.sign(input));
  });
});
