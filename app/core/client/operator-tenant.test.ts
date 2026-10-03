import { describe, expect, it } from 'vitest';

import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER, operatorTenantReadinessSchema } from '#core/contract/index.js';
import { createApiClient } from './http.js';

const { createServer } = process.getBuiltinModule('node:http');

const readiness = operatorTenantReadinessSchema.parse({
  tenantExists: false, ownerGrantPresent: false, storageConfigured: false,
  lastProbeOk: false, lastProbeAt: null, stripeConfigured: false, mode: null,
  webhookEndpointRegistered: false, legalUrlsSet: false, publishedProducts: 0,
});

const listen = async (
  server: ReturnType<typeof createServer>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP test server');
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
};

describe('operator tenant client', () => {
  it('sends the secret only in its dedicated header and parses both strict responses', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ ok: true, data: init?.method === 'POST'
        ? { tenant: { id: 't-1', slug: 'acme', name: 'Acme' }, created: true, ownerUserId: 'u-1', readiness }
        : readiness });
    } });
    expect(await api.provisionOperatorTenant({ slug: 'acme', name: 'Acme', ownerEmail: 'owner@example.test' }, 'hidden')).toMatchObject({ ok: true });
    expect(await api.getOperatorTenantReadiness('acme', 'hidden')).toEqual({ ok: true, value: readiness });
    expect(calls[0]?.url).toBe(`http://localhost:48730${API_PATHS.operatorTenantProvision}`);
    expect(calls[1]?.url).toBe('http://localhost:48730/api/internal/tenants/acme/readiness');
    for (const call of calls) {
      expect(new Headers(call.init?.headers).get(SCHEDULER_OPERATOR_SECRET_HEADER)).toBe('hidden');
      expect(call.url).not.toContain('hidden');
      expect(call.init?.body ?? '').not.toContain('hidden');
    }
  });

  it('does not expose a thrown transport diagnostic containing credentials', async () => {
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async () => { throw new Error('hidden-secret'); } });
    const result = await api.getOperatorTenantReadiness('acme', 'hidden-secret');
    expect(result).toMatchObject({ ok: false, error: { code: 'internal', message: 'Operator request failed' } });
  });

  it('refuses real cross-origin GET and POST redirects without reaching the target', async () => {
    let targetRequests = 0;
    const target = await listen(createServer((_request, response) => {
      targetRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, data: readiness }));
    }));
    const sourceMethods: string[] = [];
    const source = await listen(createServer((request, response) => {
      sourceMethods.push(request.method ?? '');
      response.writeHead(307, { location: `${target.baseUrl}/redirected` });
      response.end();
    }));
    try {
      const api = createApiClient({ baseUrl: source.baseUrl });

      await expect(api.getOperatorTenantReadiness('acme', 'hidden-secret')).resolves.toMatchObject({
        ok: false,
        error: { code: 'internal', message: 'Operator request refused a redirect' },
      });
      await expect(api.provisionOperatorTenant(
        { slug: 'acme', name: 'Acme', ownerEmail: 'owner@example.test' },
        'hidden-secret',
      )).resolves.toMatchObject({
        ok: false,
        error: { code: 'internal', message: 'Operator request refused a redirect' },
      });
      expect(sourceMethods).toEqual(['GET', 'POST']);
      expect(targetRequests).toBe(0);
    } finally {
      await source.close();
      await target.close();
    }
  });

  it('rejects unexpected credential fields in a response', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => Response.json({ ok: true, data: { ...readiness, secret: 'hidden-secret' } }) });
    const result = await api.getOperatorTenantReadiness('acme', 'hidden-secret');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hidden-secret');
  });
});
