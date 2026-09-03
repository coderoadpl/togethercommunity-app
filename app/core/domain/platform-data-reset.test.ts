import { describe, expect, it } from 'vitest';

import { isPlatformOwner, parsePlatformOwnerEmails, resettableEnvironment } from './platform-data-reset.js';

describe('resettableEnvironment', () => {
  it.each(['staging', 'preview'])('accepts %s', (appEnv) => {
    expect(resettableEnvironment(appEnv)).toBe(appEnv);
  });

  it.each([undefined, '', 'production', 'self-host', 'development', 'Staging'])(
    'refuses %s',
    (appEnv) => {
      expect(resettableEnvironment(appEnv)).toBeNull();
    },
  );
});

describe('platform owner allowlist', () => {
  it('parses, trims, lowercases and de-duplicates the list', () => {
    expect(parsePlatformOwnerEmails(' Owner@Example.test , owner@example.test ,, second@example.test'))
      .toEqual(['owner@example.test', 'second@example.test']);
  });

  it('is empty when unset, so nobody holds the platform-owner principal', () => {
    expect(parsePlatformOwnerEmails(undefined)).toEqual([]);
    expect(isPlatformOwner('owner@example.test', parsePlatformOwnerEmails(undefined))).toBe(false);
  });

  it('matches regardless of the casing the session carries', () => {
    const owners = parsePlatformOwnerEmails('owner@example.test');
    expect(isPlatformOwner('OWNER@Example.test', owners)).toBe(true);
    expect(isPlatformOwner('other@example.test', owners)).toBe(false);
  });
});
