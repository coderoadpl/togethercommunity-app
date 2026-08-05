import { afterEach, describe, expect, it, vi } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { createAuthE2eClient, type AuthE2eTransport } from './e2e-http.js';

const PASSWORD = 'x'.repeat(PASSWORD_MIN_LENGTH);

const transport: AuthE2eTransport = {
  connectUrl: 'http://127.0.0.1:48999',
  origin: 'http://acme.localhost:48730',
};

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

const stubFetch = (response: {
  status?: number;
  token?: string | null;
  json?: unknown;
  throwOnJson?: boolean;
}) => {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({
      url: input instanceof URL ? input.toString() : String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const headers = new Headers();
    if (response.token !== undefined && response.token !== null) headers.set('set-auth-token', response.token);
    const body = response.throwOnJson ? 'not-json{' : JSON.stringify(response.json ?? {});
    return new Response(body, { status: response.status ?? 200, headers });
  };
  vi.stubGlobal('fetch', impl);
  return calls;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createAuthE2eClient', () => {
  it('posts sign-up with the trusted origin and returns status + token + json', async () => {
    const calls = stubFetch({ status: 201, token: 'sess-token', json: { user: { id: 'u1' } } });
    const client = createAuthE2eClient(transport);

    const result = await client.signUpEmail({ name: 'Ada', email: 'ada@together.dev', password: PASSWORD });

    expect(result).toEqual({ status: 201, token: 'sess-token', json: { user: { id: 'u1' } } });
    expect(calls[0]?.url).toBe('http://127.0.0.1:48999/api/auth/sign-up/email');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('origin')).toBe('http://acme.localhost:48730');
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '')).toMatchObject({ email: 'ada@together.dev' });
  });

  it('attaches the bearer token on authenticated calls (enable / verify / session)', async () => {
    const calls = stubFetch({ token: null, json: { ok: true } });
    const client = createAuthE2eClient(transport);

    await client.enableTwoFactor('tok-1', PASSWORD);
    await client.verifyTotp('tok-1', '123456');
    await client.getSession('tok-1');

    expect(calls.map((c) => c.url)).toEqual([
      'http://127.0.0.1:48999/api/auth/two-factor/enable',
      'http://127.0.0.1:48999/api/auth/two-factor/verify-totp',
      'http://127.0.0.1:48999/api/auth/get-session',
    ]);
    expect(calls.every((c) => c.headers.get('authorization') === 'Bearer tok-1')).toBe(true);
    expect(calls[2]?.method).toBe('GET');
    expect(calls[2]?.body).toBeNull();
  });

  it('returns a null token and null json when the response has neither', async () => {
    stubFetch({ status: 500, throwOnJson: true });
    const client = createAuthE2eClient(transport);

    const result = await client.getSession('tok-1');

    expect(result).toEqual({ status: 500, token: null, json: null });
  });
});
