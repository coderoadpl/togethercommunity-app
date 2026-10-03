import { describe, expect, it, vi } from 'vitest';

import { createTelemetryEgressProbe } from './telemetry-egress.js';

describe('telemetry egress', () => {
  it('uses an operator declaration without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await createTelemetryEgressProbe({ declaredIp: '192.0.2.1', fetcher })()).toEqual({ mode: 'stable', ip: '192.0.2.1' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('detects changing addresses', async () => {
    let sample = 0;
    const fetcher: typeof fetch = async () => new Response(`192.0.2.${++sample}`);
    expect(await createTelemetryEgressProbe({ endpoint: 'https://echo.example.test', fetcher })()).toEqual({ mode: 'dynamic', ip: null });
  });
  it('does not mistake a short observation for guaranteed stability', async () => {
    expect(await createTelemetryEgressProbe({ endpoint: 'https://echo.example.test', fetcher: async () => new Response('192.0.2.1') })()).toEqual({ mode: 'unknown', ip: null });
  });
  it('returns unknown when unconfigured or unavailable', async () => {
    expect((await createTelemetryEgressProbe({})()).mode).toBe('unknown');
    expect((await createTelemetryEgressProbe({ endpoint: 'https://echo.example.test', fetcher: async () => new Response('invalid') })()).mode).toBe('unknown');
  });
});
