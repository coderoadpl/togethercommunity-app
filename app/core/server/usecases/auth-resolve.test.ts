import { describe, expect, it } from 'vitest';

import type { SignInMethodReader } from '../ports.js';
import { resolveSignInMethods } from './auth-resolve.js';

const reader = (
  accountsWithPassword: readonly string[],
  accountsWithPasskey: readonly string[] = [],
  calls: string[] = [],
): SignInMethodReader => ({
  hasCredentialAccount: async (tenantId, email) => {
    calls.push(`password:${tenantId}:${email}`);
    return accountsWithPassword.includes(email);
  },
  hasPasskey: async (tenantId, email) => {
    calls.push(`passkey:${tenantId}:${email}`);
    return accountsWithPasskey.includes(email);
  },
});

const withPassword = ['creator@together.dev'];

describe('resolveSignInMethods', () => {
  it('offers the password form plus the magic link to an account with a credential', async () => {
    const result = await resolveSignInMethods(
      't-acme',
      { email: 'creator@together.dev' },
      { signInMethods: reader(withPassword) },
    );

    expect(result).toEqual({ ok: true, value: { methods: ['password', 'magic-link'] } });
  });

  it('offers passkey plus the magic link to an account with a registered passkey', async () => {
    const result = await resolveSignInMethods(
      't-acme',
      { email: 'creator@together.dev' },
      { signInMethods: reader([], ['creator@together.dev']) },
    );

    expect(result).toEqual({ ok: true, value: { methods: ['passkey', 'magic-link'] } });
  });

  it('offers password and passkey before the magic link when both are present', async () => {
    const result = await resolveSignInMethods(
      't-acme',
      { email: 'creator@together.dev' },
      { signInMethods: reader(withPassword, ['creator@together.dev']) },
    );

    expect(result).toEqual({ ok: true, value: { methods: ['password', 'passkey', 'magic-link'] } });
  });

  it('answers a passwordless member and an unknown address identically', async () => {
    const deps = { signInMethods: reader(withPassword) };

    const passwordless = await resolveSignInMethods(
      't-acme',
      { email: 'student@together.dev' },
      deps,
    );
    const unknown = await resolveSignInMethods('t-acme', { email: 'nobody@example.com' }, deps);

    expect(passwordless).toEqual({ ok: true, value: { methods: ['magic-link'] } });
    expect(unknown).toEqual(passwordless);
  });

  it('does the same lookups whichever address is asked about', async () => {
    const calls: string[] = [];
    const deps = { signInMethods: reader(withPassword, [], calls) };

    await resolveSignInMethods('t-acme', { email: 'creator@together.dev' }, deps);
    await resolveSignInMethods('t-acme', { email: 'nobody@example.com' }, deps);

    expect(calls).toEqual([
      'password:t-acme:creator@together.dev',
      'passkey:t-acme:creator@together.dev',
      'password:t-acme:nobody@example.com',
      'passkey:t-acme:nobody@example.com',
    ]);
  });

  it('hands the identifier to the reader untouched so normalisation happens once', async () => {
    const calls: string[] = [];

    const result = await resolveSignInMethods(
      't-acme',
      { email: '  Creator@Together.dev ' },
      { signInMethods: reader(['  Creator@Together.dev '], [], calls) },
    );

    expect(calls).toEqual([
      'password:t-acme:  Creator@Together.dev ',
      'passkey:t-acme:  Creator@Together.dev ',
    ]);
    expect(result).toEqual({ ok: true, value: { methods: ['password', 'magic-link'] } });
  });

  it('keeps the platform surface on the magic link without reading tenant data', async () => {
    const calls: string[] = [];

    const result = await resolveSignInMethods(
      null,
      { email: 'creator@together.dev' },
      { signInMethods: reader(withPassword, [], calls) },
    );

    expect(result).toEqual({ ok: true, value: { methods: ['magic-link'] } });
    expect(calls).toEqual([]);
  });
});
