import { z } from 'zod';
import { META_CAPI_GATEWAY_TIMEOUT_MS } from '#core/domain/index.js';
import type { MetaCapiGateway } from '#core/server/meta-capi-ports.js';

export const META_GRAPH_API_VERSION = 'v27.0';
const responseSchema = z.object({ events_received: z.literal(1), fbtrace_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional() });

export const createMetaCapiGateway = (fetcher: typeof fetch = fetch): MetaCapiGateway => ({
  send: async (tenantId, { pixelId, accessToken, payload, testEventCode }) => {
    if (tenantId.length === 0) return { ok: false, retryable: false, error: 'invalid_tenant' };
    if (!/^[0-9]{8,20}$/.test(pixelId)) return { ok: false, retryable: false, error: 'invalid_pixel_id' };
    try {
      const response = await fetcher(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${pixelId}/events`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(META_CAPI_GATEWAY_TIMEOUT_MS),
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ data: [payload], ...(testEventCode === undefined ? {} : { test_event_code: testEventCode }) }),
      });
      if (!response.ok) return { ok: false, retryable: response.status >= 500, error: `http_${String(response.status)}` };
      const text = await response.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { return { ok: false, retryable: false, error: 'invalid_response' }; }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) return { ok: false, retryable: false, error: 'invalid_response' };
      const trace = parsed.data.fbtrace_id;
      return { ok: true, fbtraceId: trace === undefined || trace.includes(accessToken) ? null : trace };
    } catch {
      return { ok: false, retryable: true, error: 'network_or_timeout' };
    }
  },
});
