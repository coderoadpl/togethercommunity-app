import { describe, expect, it } from 'vitest';

import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER, SECRET_FINGERPRINT_READ_SECRET_HEADER } from '#core/contract/index.js';

import { createApiClient, REDACTED_OPERATOR_SECRET, REDACTED_SECRET_FINGERPRINT_READ_SECRET } from './http.js';

const secrets = [
  { name: 'CRON_SECRET', set: true, fingerprint: '0123456789abcdef' },
  { name: 'SMTP_PASSWORD', set: false, fingerprint: null },
];

describe('secret fingerprints client', () => {
  it('sends the read secret only in its own header, refuses redirects and parses the strict response', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ ok: true, data: { secrets } });
    } });
    expect(await api.getSecretFingerprints('hidden-secret')).toEqual({ ok: true, value: { secrets } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`http://localhost:48730${API_PATHS.secretFingerprints}`);
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.redirect).toBe('error');
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get(SECRET_FINGERPRINT_READ_SECRET_HEADER)).toBe('hidden-secret');
    expect(headers.has(SCHEDULER_OPERATOR_SECRET_HEADER)).toBe(false);
  });

  it.each([
    { secrets: [{ name: 'CRON_SECRET', set: true, fingerprint: '0123456789abcdef', value: 'hidden-secret' }] },
    { secrets: [{ name: 'CRON_SECRET', set: true, fingerprint: null }] },
    { secrets: [{ name: 'CRON_SECRET', set: false, fingerprint: '0123456789abcdef' }] },
    { secrets: [{ name: 'CRON_SECRET', set: true, fingerprint: 'hidden-secret' }] },
  ])('rejects a response that does not match the fingerprint contract', async (data) => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => Response.json({ ok: true, data }) });
    const result = await api.getSecretFingerprints('hidden-secret');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hidden-secret');
  });

  it('replaces the sent secret in a server error envelope and keeps the rest of the server message', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => Response.json({
      ok: false,
      error: {
        code: 'unauthorized',
        message: 'Invalid operator secret: hidden-secret',
        details: { header: 'hidden-secret', seen: ['prefix hidden-secret suffix', 7, null], 'hidden-secret': true },
      },
    }, { status: 401 }) });
    const result = await api.getSecretFingerprints('hidden-secret');
    expect(JSON.stringify(result)).not.toContain('hidden-secret');
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unauthorized',
        message: `Invalid operator secret: ${REDACTED_SECRET_FINGERPRINT_READ_SECRET}`,
        details: {
          header: REDACTED_SECRET_FINGERPRINT_READ_SECRET,
          seen: [`prefix ${REDACTED_SECRET_FINGERPRINT_READ_SECRET} suffix`, 7, null],
          [REDACTED_SECRET_FINGERPRINT_READ_SECRET]: true,
        },
      },
    });
  });

  it.each([' hidden-secret', 'hidden-secret\n', '\t hidden-secret\r\n'])(
    'replaces the header-normalized form of a sent secret %j that the server echoes back', async (secret) => {
      const api = createApiClient({ baseUrl: '', fetchImpl: async (_url, init) => {
        const received = new Headers(init?.headers).get(SECRET_FINGERPRINT_READ_SECRET_HEADER) ?? '';
        return Response.json({
          ok: false,
          error: { code: 'unauthorized', message: `Rejected <${received}>`, details: { received, [received]: [`seen <${received}>`] } },
        }, { status: 401 });
      } });
      const result = await api.getSecretFingerprints(secret);
      expect(JSON.stringify(result)).not.toContain('hidden-secret');
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'unauthorized',
          message: `Rejected <${REDACTED_SECRET_FINGERPRINT_READ_SECRET}>`,
          details: {
            received: REDACTED_SECRET_FINGERPRINT_READ_SECRET,
            [REDACTED_SECRET_FINGERPRINT_READ_SECRET]: [`seen <${REDACTED_SECRET_FINGERPRINT_READ_SECRET}>`],
          },
        },
      });
    },
  );

  it('replaces both the raw and the normalized form of a sent operator secret', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => Response.json(
      { ok: false, error: { code: 'unauthorized', message: 'raw " hidden-secret\n" normalized "hidden-secret"' } }, { status: 401 },
    ) });
    expect(await api.getOperatorTenantReadiness('acme', ' hidden-secret\n')).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: `raw "${REDACTED_OPERATOR_SECRET}" normalized "${REDACTED_OPERATOR_SECRET}"` },
    });
  });

  it('leaves a server message unchanged when the sent secret is only whitespace', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => Response.json(
      { ok: false, error: { code: 'unauthorized', message: 'Invalid operator secret' } }, { status: 401 },
    ) });
    expect(await api.getSecretFingerprints(' \t ')).toEqual({
      ok: false, error: { code: 'unauthorized', message: 'Invalid operator secret' },
    });
  });

  it.each([
    ['getOperatorTenantReadiness', (api: ReturnType<typeof createApiClient>) => api.getOperatorTenantReadiness('acme', 'hidden-secret')],
    ['provisionOperatorTenant', (api: ReturnType<typeof createApiClient>) =>
      api.provisionOperatorTenant({ slug: 'acme', name: 'Acme', ownerEmail: 'owner@example.test' }, 'hidden-secret')],
  ] as const)('replaces the sent secret in the server error of %s', async (_name, call) => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => Response.json(
      { ok: false, error: { code: 'unauthorized', message: 'hidden-secret', details: ['hidden-secret'] } }, { status: 401 },
    ) });
    expect(await call(api)).toEqual({
      ok: false, error: { code: 'unauthorized', message: REDACTED_OPERATOR_SECRET, details: [REDACTED_OPERATOR_SECRET] },
    });
  });

  it('passes a server message that does not carry the secret through unchanged', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => Response.json(
      { ok: false, error: { code: 'unauthorized', message: 'Invalid operator secret' } }, { status: 401 },
    ) });
    expect(await api.getSecretFingerprints('hidden-secret')).toEqual({
      ok: false, error: { code: 'unauthorized', message: 'Invalid operator secret' },
    });
  });

  it('redacts a thrown transport diagnostic', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => { throw new Error('hidden-secret'); } });
    expect(await api.getSecretFingerprints('hidden-secret')).toMatchObject({
      ok: false, error: { code: 'internal', message: 'Operator request failed' },
    });
  });
});
