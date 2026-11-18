import { describe, expect, it } from 'vitest';

import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER } from '#core/contract/index.js';

import { createApiClient } from './http.js';

const secrets = [
  { name: 'CRON_SECRET', set: true, fingerprint: '0123456789abcdef' },
  { name: 'SMTP_PASSWORD', set: false, fingerprint: null },
];

describe('secret fingerprints client', () => {
  it('sends the operator secret only in its header, refuses redirects and parses the strict response', async () => {
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
    expect(new Headers(calls[0]?.init?.headers).get(SCHEDULER_OPERATOR_SECRET_HEADER)).toBe('hidden-secret');
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

  it('redacts a thrown transport diagnostic', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => { throw new Error('hidden-secret'); } });
    expect(await api.getSecretFingerprints('hidden-secret')).toMatchObject({
      ok: false, error: { code: 'internal', message: 'Operator request failed' },
    });
  });
});
