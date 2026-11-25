import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256.js';

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['zażółć', '7eefe5e3046c86cec19ce1215e0a04724124d948468005a1ebc4adf2643bea13'],
  ])('is the SHA-256 of the UTF-8 bytes of %j', (text, digest) => {
    expect(sha256Hex(text)).toBe(digest);
  });
});
