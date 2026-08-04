import { describe, expect, it, vi } from 'vitest';

import { runRemoteSmoke } from './remote-smoke.js';

describe('remote smoke', () => {
  it('checks health attestation, the public offer, and the public web page', async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return Response.json({
          ok: true,
          data: {
            status: 'ok',
            database: 'up',
            version: '0.1.0',
            sha: 'abc123',
            environment: 'production',
            production: true,
            commit: 'abc123',
            databaseFingerprint: 'b1bfbb98b4f7',
          },
        });
      }
      if (url.endsWith('/api/public/offer')) {
        expect(new Headers(init?.headers).get('x-tenant')).toBe('acme');
        return Response.json({
          ok: true,
          data: {
            tenant: {
              slug: 'acme',
              name: 'Acme',
              branding: { logoUrl: null, accentColor: null, faviconUrl: null },
              legal: { termsUrl: null, privacyUrl: null },
            },
            contentVersion: 1,
            products: [],
          },
        });
      }
      return new Response('<!doctype html><html><body>Together</body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });

    await expect(
      runRemoteSmoke(
        {
          baseUrl: 'https://together.example/',
          tenant: 'acme',
          expectedSha: 'abc123',
          publicPagePath: '/',
        },
        request,
      ),
    ).resolves.toBeUndefined();

    expect(request).toHaveBeenCalledTimes(3);
  });

  it('fails when a different deployment SHA answers', async () => {
    const request = vi.fn(async () =>
      Response.json({
        ok: true,
        data: {
          status: 'ok',
          database: 'up',
          version: '0.1.0',
          sha: 'old-sha',
          environment: 'production',
          production: true,
          commit: 'old-sha',
          databaseFingerprint: 'b1bfbb98b4f7',
        },
      }),
    );

    await expect(
      runRemoteSmoke(
        {
          baseUrl: 'https://together.example',
          tenant: 'acme',
          expectedSha: 'new-sha',
          publicPagePath: '/',
        },
        request,
      ),
    ).rejects.toThrow('expected SHA new-sha, received old-sha');
  });
});
