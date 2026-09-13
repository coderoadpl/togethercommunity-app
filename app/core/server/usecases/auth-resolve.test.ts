import { describe, expect, it } from 'vitest';

import { resolveSignInMethods } from './auth-resolve.js';

describe('resolveSignInMethods', () => {
  it('offers every sign-in method without identifier or account dependencies', () => {
    expect(resolveSignInMethods()).toEqual({
      ok: true, value: { methods: ['password', 'passkey', 'magic-link'] },
    });
  });
});
