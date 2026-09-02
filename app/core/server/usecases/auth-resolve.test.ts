import { describe, expect, it } from 'vitest';

import type { SignInMethodReader } from '../ports.js';
import { resolveSignInMethods } from './auth-resolve.js';

const reader = (accountsWithPassword: readonly string[], calls: string[] = []): SignInMethodReader => ({
  hasCredentialAccount: async (tenantId, email) => {
    calls.push(`${tenantId}:${email}`);
    return accountsWithPassword.includes(email);
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

  it('answers a passwordless member and an unknown address identically', async () => {
    const deps = { signInMethods: reader(withPassword) };

    const passwordless = await resolveSignInMethods(
      't-acme',
      { email: 'kursant@together.dev' },
      deps,
    );
    const unknown = await resolveSignInMethods('t-acme', { email: 'nobody@example.com' }, deps);

    expect(passwordless).toEqual({ ok: true, value: { methods: ['magic-link'] } });
    expect(unknown).toEqual(passwordless);
  });

  it('does the same single lookup whichever address is asked about', async () => {
    const calls: string[] = [];
    const deps = { signInMethods: reader(withPassword, calls) };

    await resolveSignInMethods('t-acme', { email: 'creator@together.dev' }, deps);
    await resolveSignInMethods('t-acme', { email: 'nobody@example.com' }, deps);

    expect(calls).toEqual(['t-acme:creator@together.dev', 't-acme:nobody@example.com']);
  });

  it('normalizes the identifier before the lookup', async () => {
    const calls: string[] = [];

    const result = await resolveSignInMethods(
      't-acme',
      { email: '  Creator@Together.dev ' },
      { signInMethods: reader(withPassword, calls) },
    );

    expect(calls).toEqual(['t-acme:creator@together.dev']);
    expect(result).toEqual({ ok: true, value: { methods: ['password', 'magic-link'] } });
  });

  it('keeps the platform surface on the magic link without reading tenant data', async () => {
    const calls: string[] = [];

    const result = await resolveSignInMethods(
      null,
      { email: 'creator@together.dev' },
      { signInMethods: reader(withPassword, calls) },
    );

    expect(result).toEqual({ ok: true, value: { methods: ['magic-link'] } });
    expect(calls).toEqual([]);
  });
});
