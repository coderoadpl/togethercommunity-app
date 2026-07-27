import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createKsefClient } from './ksef.js';

const certificate = readFileSync(
  new URL('./fixtures/ksef-test-certificate.pem', import.meta.url),
  'utf8',
).replace(/-----[^-]+-----|\s/g, '');

const json = (value: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('KSeF API client', () => {
  it('authenticates with an encrypted BYO token, reuses a session, and refreshes an expired access token', async () => {
    const requests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    let statusCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const headers = new Headers(init?.headers);
      const rawBody = typeof init?.body === 'string' ? init.body : '';
      requests.push({
        path: url.pathname,
        authorization: headers.get('authorization'),
        body: rawBody === '' ? null : JSON.parse(rawBody),
      });
      if (url.pathname.endsWith('/auth/challenge')) {
        return json({ challenge: 'challenge-1', timestampMs: 1785186000000 });
      }
      if (url.pathname.endsWith('/security/public-key-certificates')) {
        return json([{
          certificate,
          certificateId: 'certificate-id',
          publicKeyId: 'public-key-id',
          validFrom: '2026-01-01T00:00:00Z',
          validTo: '2027-01-01T00:00:00Z',
          usage: ['KsefTokenEncryption', 'SymmetricKeyEncryption'],
        }]);
      }
      if (url.pathname.endsWith('/auth/ksef-token')) {
        return json({
          referenceNumber: 'auth-ref',
          authenticationToken: { token: 'operation-jwt', validUntil: '2026-07-27T11:00:00Z' },
        }, 202);
      }
      if (url.pathname.endsWith('/auth/auth-ref')) {
        return json({ status: { code: 200, description: 'ok' } });
      }
      if (url.pathname.endsWith('/auth/token/redeem')) {
        return json({
          accessToken: { token: 'access-1', validUntil: '2026-07-27T10:15:00Z' },
          refreshToken: { token: 'refresh-1', validUntil: '2026-08-03T10:00:00Z' },
        });
      }
      if (url.pathname.endsWith('/auth/token/refresh')) {
        return json({
          accessToken: { token: 'access-2', validUntil: '2026-07-27T10:30:00Z' },
        });
      }
      if (url.pathname.endsWith('/sessions/online')) {
        return json({ referenceNumber: 'session-ref', validUntil: '2026-07-27T22:00:00Z' }, 201);
      }
      if (url.pathname.endsWith('/sessions/session-ref/invoices/invoice-ref')) {
        statusCalls += 1;
        if (statusCalls === 1) return json({ title: 'expired' }, 401);
        return json({
          referenceNumber: 'invoice-ref',
          invoiceHash: 'hash',
          ksefNumber: '5555555555-20260727-ABC-01',
          acquisitionDate: '2026-07-27T10:01:00Z',
          invoicingDate: '2026-07-27T10:01:00Z',
          permanentStorageDate: '2026-07-27T10:02:00Z',
          status: { code: 200, description: 'Sukces' },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    const client = createKsefClient({
      fetcher,
      baseUrls: {
        test: 'https://api-test.ksef.mf.gov.pl/v2',
        production: 'https://api.ksef.mf.gov.pl/v2',
      },
      now: () => new Date('2026-07-27T10:00:00Z'),
      wait: async () => undefined,
    });
    const input = {
      environment: 'test' as const,
      credentials: { token: 'tenant-ksef-token', contextNip: '5555555555' },
    };

    expect((await client.validateCredentials(input)).ok).toBe(true);
    expect(await client.openSession(input)).toEqual({
      ok: true,
      value: { sessionReference: 'session-ref' },
    });
    expect(await client.openSession(input)).toEqual({
      ok: true,
      value: { sessionReference: 'session-ref' },
    });
    expect(await client.getInvoiceStatus({
      ...input,
      sessionReference: 'session-ref',
      invoiceReference: 'invoice-ref',
    })).toMatchObject({
      ok: true,
      value: { code: 200, ksefNumber: '5555555555-20260727-ABC-01' },
    });

    const authRequest = requests.find((request) => request.path.endsWith('/auth/ksef-token'));
    expect(authRequest?.body).toMatchObject({
      challenge: 'challenge-1',
      contextIdentifier: { type: 'Nip', value: '5555555555' },
      publicKeyId: 'public-key-id',
    });
    expect(authRequest?.body).not.toMatchObject({ encryptedToken: 'tenant-ksef-token' });
    expect(requests.filter((request) => request.path.endsWith('/sessions/online'))).toHaveLength(1);
    expect(requests.find((request) => request.path.endsWith('/auth/token/refresh'))?.authorization)
      .toBe('Bearer refresh-1');
    expect(requests.at(-1)?.authorization).toBe('Bearer access-2');
  });
});
