import { describe, expect, it, vi } from 'vitest';
import type { MetaCapiPayload } from '#core/domain/meta-capi.js';
import { createMetaCapiGateway, META_GRAPH_API_VERSION } from './meta-capi.js';

const payload: MetaCapiPayload = { event_name: 'Purchase', action_source: 'website', event_time: 1793527200, event_id: 'purchase',
  event_source_url: 'https://example.org/offer/book', user_data: { em: ['a'.repeat(64)] },
  custom_data: { value: 99, currency: 'PLN', content_type: 'product', content_ids: ['book'], contents: [{ id: 'book', quantity: 1, item_price: 99 }], num_items: 1, order_id: 'purchase' } };
const input = { pixelId: '1234567890', accessToken: 'secret-token', payload, testEventCode: 'TEST123' };

describe('Meta Graph adapter', () => {
  it('uses a fixed version and host, a bearer header, deduplication id and a bounded request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ events_received: 1, fbtrace_id: 'trace-id' }));
    expect(await createMetaCapiGateway(fetcher).send('workspace', input)).toEqual({ ok: true, fbtraceId: 'trace-id' });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/1234567890/events`);
    const options = fetcher.mock.calls[0]?.[1];
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: 'Bearer secret-token' } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.body).toBe(JSON.stringify({ data: [payload], test_event_code: 'TEST123' }));
  });
  it.each([400, 401, 403, 429, 500, 503])('classifies HTTP %i without returning its raw body', async (status) => {
    const fetcher: typeof fetch = async () => Response.json({ error: { message: 'secret-token buyer@example.org' } }, { status });
    expect(await createMetaCapiGateway(fetcher).send('workspace', input)).toEqual({ ok: false, retryable: status >= 500, error: `http_${String(status)}` });
  });
  it('redacts exceptions and traces containing the token', async () => {
    const failed: typeof fetch = async () => { throw new Error('secret-token buyer@example.org'); };
    expect(await createMetaCapiGateway(failed).send('workspace', input)).toEqual({ ok: false, retryable: true, error: 'network_or_timeout' });
    const echoed: typeof fetch = async () => Response.json({ events_received: 1, fbtrace_id: 'secret-token' });
    expect(await createMetaCapiGateway(echoed).send('workspace', input)).toEqual({ ok: true, fbtraceId: null });
  });
  it('rejects invalid identifiers before making a request and does not accept zero events', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ events_received: 0 }));
    expect(await createMetaCapiGateway(fetcher).send('workspace', { ...input, pixelId: '../redirect' })).toMatchObject({ ok: false, retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await createMetaCapiGateway(fetcher).send('workspace', input)).toMatchObject({ ok: false, retryable: false, error: 'invalid_response' });
  });
});
