import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCliAuthAdapter } from './client-adapter.js';

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
