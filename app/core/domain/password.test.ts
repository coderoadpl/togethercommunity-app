import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH, passwordMeetsMinimumLength } from './password.js';

describe('password policy', () => {
  it('requires at least fifteen characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(15);
    expect(passwordMeetsMinimumLength('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(passwordMeetsMinimumLength('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });

  it('does not require character classes', () => {
    expect(passwordMeetsMinimumLength('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });
});
