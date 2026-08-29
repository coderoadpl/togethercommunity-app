import { describe, expect, it } from 'vitest';

import { secretEquals } from './secret-equals.js';

describe('secretEquals', () => {
  it('accepts an identical secret', () => {
    expect(secretEquals('s3cret-value', 's3cret-value')).toBe(true);
  });

  it('rejects a different secret of the same length', () => {
    expect(secretEquals('s3cret-value', 's3cret-valuf')).toBe(false);
  });

  it('rejects a secret of a different length', () => {
    expect(secretEquals('s3cret', 's3cret-value')).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(secretEquals(undefined, 's3cret-value')).toBe(false);
  });
});
