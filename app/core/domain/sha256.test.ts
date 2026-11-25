import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256.js';

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['café ☕ 𝄞', '30ec1cbccafc39251eaa999b7dcd27fd57c0b4cc04d8d5e6b55037c57f9005b4'],
  ])('is the SHA-256 of the UTF-8 bytes of %j', (text, digest) => {
    expect(sha256Hex(text)).toBe(digest);
  });
});
