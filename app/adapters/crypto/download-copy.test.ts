import { describe, expect, it } from 'vitest';

import { copyIdentifierSchema } from '#core/domain/index.js';

import { createDownloadCopyCrypto } from './download-copy.js';

describe('copy identifiers', () => {
  it('encodes fresh random 128-bit identifiers as canonical base32', () => {
    const crypto = createDownloadCopyCrypto();
    const identifiers = Array.from({ length: 1000 }, () => crypto.identifier());
    expect(new Set(identifiers).size).toBe(1000);
    for (const identifier of identifiers) expect(copyIdentifierSchema.safeParse(identifier).success).toBe(true);
    expect(crypto.hash(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
