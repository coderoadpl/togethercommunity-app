import { describe, expect, it } from 'vitest';

import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER, operatorTenantReadinessSchema } from '#core/contract/index.js';
import { createApiClient } from './http.js';

const readiness = operatorTenantReadinessSchema.parse({
  tenantExists: false, ownerGrantPresent: false, storageConfigured: false,
  lastProbeOk: false, lastProbeAt: null, stripeConfigured: false, mode: null,
  webhookEndpointRegistered: false, legalUrlsSet: false, publishedProducts: 0,
});

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

  it('rejects unexpected credential fields in a response', async () => {
    const api = createApiClient({ baseUrl: '', fetchImpl: async () => Response.json({ ok: true, data: { ...readiness, secret: 'hidden-secret' } }) });
    const result = await api.getOperatorTenantReadiness('acme', 'hidden-secret');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hidden-secret');
  });
});
