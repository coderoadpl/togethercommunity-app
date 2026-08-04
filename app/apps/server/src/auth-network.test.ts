import { describe, expect, it } from 'vitest';

import { createAuthAttributionFailureReporter, trustedAuthHeaders } from './auth-network.js';

describe('trusted auth client address', () => {
  it('uses the direct socket and overwrites client forwarding input without proxy configuration', () => {
    const headers = trustedAuthHeaders(
      new Headers({ 'x-forwarded-for': '198.51.100.1' }),
      null,
      '::ffff:203.0.113.5',
    );

    expect(headers.get('x-forwarded-for')).toBe('203.0.113.5');
  });

  it('uses only the configured proxy header when one is configured', () => {
    const headers = trustedAuthHeaders(
      new Headers({
        'x-forwarded-for': '198.51.100.1',
        'x-vercel-forwarded-for': '203.0.113.5',
      }),
      'x-vercel-forwarded-for',
      '10.0.0.2',
    );

    expect(headers.get('x-forwarded-for')).toBe('203.0.113.5');
  });

  it('rejects spoofed chains and unknown addresses instead of trusting a fallback header', () => {
    const report = () => undefined;
    const spoofed = trustedAuthHeaders(
      new Headers({
        'x-forwarded-for': '198.51.100.1',
        'x-vercel-forwarded-for': '198.51.100.1, 203.0.113.5',
      }),
      'x-vercel-forwarded-for',
      '10.0.0.2',
      report,
    );
    const unknown = trustedAuthHeaders(
      new Headers({ 'x-forwarded-for': '198.51.100.1' }),
      'x-vercel-forwarded-for',
      undefined,
      report,
    );

    expect(spoofed.has('x-forwarded-for')).toBe(false);
    expect(unknown.has('x-forwarded-for')).toBe(false);
  });

  it('reports failed configured proxy attribution only once', () => {
    const messages: string[] = [];
    const report = createAuthAttributionFailureReporter((message) => { messages.push(message); });

    trustedAuthHeaders(new Headers(), 'x-vercel-forwarded-for', '10.0.0.2', report);
    trustedAuthHeaders(
      new Headers({ 'x-vercel-forwarded-for': '198.51.100.1, 203.0.113.5' }),
      'x-vercel-forwarded-for',
      '10.0.0.2',
      report,
    );

    expect(messages).toEqual([
      '[auth-network] x-vercel-forwarded-for did not provide one valid client IP; auth rate limiting will use its shared fallback bucket\n',
    ]);
  });
});
