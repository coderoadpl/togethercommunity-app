import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBetterAuthClientAdapter, createCliAuthAdapter } from './client-adapter.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CLI sign-out', () => {
  it('revokes the active bearer session server-side', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const auth = createCliAuthAdapter(
      'https://api.example/path',
      () => undefined,
      () => 'session-token',
    );

    expect(await auth.signOut()).toEqual({ ok: true, value: undefined });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL('https://api.example/api/auth/sign-out'),
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer session-token',
          'content-type': 'application/json',
          origin: 'https://api.example',
        },
        body: '{}',
      },
    );
  });

  it('stays local when no session token exists', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const auth = createCliAuthAdapter(
      'https://api.example',
      () => undefined,
      () => null,
    );

    expect(await auth.signOut()).toEqual({ ok: true, value: undefined });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('browser password change', () => {
  it('uses the Better Auth change-password endpoint and maps the request', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const auth = createBetterAuthClientAdapter('https://api.example');

    expect(await auth.changePassword({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    })).toEqual({ ok: true, value: undefined });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toEqual(new URL('https://api.example/api/auth/change-password'));
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    });
  });

  it('preserves the Better Auth error code for localized provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'INVALID_PASSWORD', message: 'Invalid password' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ));
    const auth = createBetterAuthClientAdapter('https://api.example');

    expect(await auth.changePassword({
      currentPassword: 'wrong-password',
      newPassword: 'new-password',
      revokeOtherSessions: false,
    })).toEqual({
      ok: false,
      error: {
        code: 'validation',
        message: 'Invalid password',
        details: { providerCode: 'INVALID_PASSWORD' },
      },
    });
  });
});

describe('browser password reset request', () => {
  it('sends the absolute provider callback and language header', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const auth = createBetterAuthClientAdapter('https://studio.example');

    expect(await auth.requestPasswordReset({
      email: 'member@example.com',
      redirectTo: 'https://studio.example/reset-password',
      language: 'en',
    })).toEqual({ ok: true, value: undefined });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toEqual(new URL('https://studio.example/api/auth/request-password-reset'));
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'member@example.com',
      redirectTo: 'https://studio.example/reset-password',
    });
    expect(new Headers(init?.headers).get('x-together-language')).toBe('en');
  });

  it('maps provider failures without changing their code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'RESET_PASSWORD_DISABLED', message: 'Unavailable' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ));
    const auth = createBetterAuthClientAdapter('https://studio.example');

    expect(await auth.requestPasswordReset({
      email: 'member@example.com',
      redirectTo: 'https://studio.example/reset-password',
    })).toEqual({
      ok: false,
      error: {
        code: 'validation',
        message: 'Unavailable',
        details: { providerCode: 'RESET_PASSWORD_DISABLED' },
      },
    });
  });
});

describe('CLI password reset request', () => {
  it('preserves the absolute callback and uses the canonical API origin', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const auth = createCliAuthAdapter('https://api.example/path', () => undefined);

    expect(await auth.requestPasswordReset({
      email: 'member@example.com',
      redirectTo: 'https://api.example/reset-password',
      language: 'pl',
    })).toEqual({ ok: true, value: undefined });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL('https://api.example/api/auth/request-password-reset'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://api.example',
          'x-together-language': 'pl',
        },
        body: JSON.stringify({
          email: 'member@example.com',
          redirectTo: 'https://api.example/reset-password',
        }),
      },
    );
  });
});

describe('CLI password change', () => {
  it('omits authorization when no session token exists', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const auth = createCliAuthAdapter('https://api.example/path', () => undefined);

    expect(await auth.changePassword({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: false,
    })).toEqual({ ok: true, value: undefined });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL('https://api.example/api/auth/change-password'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://api.example',
        },
        body: JSON.stringify({
          currentPassword: 'old-password',
          newPassword: 'new-password',
          revokeOtherSessions: false,
        }),
      },
    );
  });

  it('persists the replacement token when other sessions are revoked', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-auth-token': 'replacement-token' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const onToken = vi.fn();
    const auth = createCliAuthAdapter(
      'https://api.example/path',
      onToken,
      () => 'current-token',
    );

    expect(await auth.changePassword({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    })).toEqual({ ok: true, value: undefined });
    expect(onToken).toHaveBeenCalledExactlyOnceWith('replacement-token');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL('https://api.example/api/auth/change-password'),
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer current-token',
          'content-type': 'application/json',
          origin: 'https://api.example',
        },
        body: JSON.stringify({
          currentPassword: 'old-password',
          newPassword: 'new-password',
          revokeOtherSessions: true,
        }),
      },
    );
  });

  it('leaves the stored token unchanged when the provider does not rotate it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));
    const onToken = vi.fn();
    const auth = createCliAuthAdapter('https://api.example', onToken, () => 'current-token');

    expect(await auth.changePassword({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: false,
    })).toEqual({ ok: true, value: undefined });
    expect(onToken).not.toHaveBeenCalled();
  });
});
