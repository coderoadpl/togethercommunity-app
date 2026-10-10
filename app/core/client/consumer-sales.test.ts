import { describe, expect, it } from 'vitest';

import { createApiClient } from './http.js';

const query = { from: '2026-09-01', to: '2026-09-30' };
const csv = '"rate","net_cents"\n"TOTAL","0"';

describe('consumer sales client contracts', () => {
  it('requests the date range and parses JSON through the summary schema', async () => {
    const client = createApiClient({ baseUrl: 'http://localhost', fetchImpl: async (input, init) => {
      expect(input).toBe('http://localhost/api/orders/consumer-sales-summary?from=2026-09-01&to=2026-09-30');
      expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
      return Response.json({ ok: true, data: { ...query, timezone: 'Europe/Warsaw', currency: 'PLN', rates: [], totals: { orderCount: 0, lineCount: 0, netCents: 0, vatCents: 0, grossCents: 0 }, orderIds: [], orders: [] } });
    } });
    expect(await client.consumerSalesSummary(query)).toMatchObject({ ok: true, value: { ...query, orderIds: [] } });
  });
  it('requests raw CSV with workspace headers and returns a download file', async () => {
    const client = createApiClient({ baseUrl: 'http://localhost', headers: () => ({ 'X-Tenant': 'workspace' }), fetchImpl: async (input, init) => {
      expect(input).toBe('http://localhost/api/orders/consumer-sales-summary?from=2026-09-01&to=2026-09-30&format=csv');
      expect(init).toMatchObject({ method: 'GET', credentials: 'include', headers: { 'X-Tenant': 'workspace' } });
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8' } });
    } });
    expect(await client.exportConsumerSales(query)).toEqual({ ok: true, value: { filename: 'consumer-sales-2026-09-01-2026-09-30.csv', mimeType: 'text/csv; charset=utf-8', content: csv } });
  });
  it('preserves forbidden error envelopes from CSV requests', async () => {
    const client = createApiClient({ baseUrl: 'http://localhost', fetchImpl: async () => Response.json({ ok: false, error: { code: 'forbidden', message: 'Export is not permitted' } }, { status: 403 }) });
    expect(await client.exportConsumerSales(query)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
  it('rejects a successful response with the wrong CSV content type', async () => {
    const client = createApiClient({ baseUrl: 'http://localhost', fetchImpl: async () => Response.json({ ok: true, data: {} }) });
    expect(await client.exportConsumerSales(query)).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});
