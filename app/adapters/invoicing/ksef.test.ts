import { createHash } from 'node:crypto';
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
  it('authenticates with an encrypted BYO token, isolates tenant sessions, and refreshes access', async () => {
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
          validFrom: '1998-01-01T00:00:00Z',
          validTo: '1999-01-01T00:00:00Z',
          usage: ['KsefTokenEncryption', 'SymmetricKeyEncryption'],
        }]);
      }
      if (url.pathname.endsWith('/auth/ksef-token')) {
        return json({
          referenceNumber: 'auth-ref',
          authenticationToken: { token: 'operation-jwt', validUntil: '1998-07-27T11:00:00Z' },
        }, 202);
      }
      if (url.pathname.endsWith('/auth/auth-ref')) {
        return json({ status: { code: 200, description: 'ok' } });
      }
      if (url.pathname.endsWith('/auth/token/redeem')) {
        return json({
          accessToken: { token: 'access-1', validUntil: '1998-07-27T10:15:00Z' },
          refreshToken: { token: 'refresh-1', validUntil: '1998-08-03T10:00:00Z' },
        });
      }
      if (url.pathname.endsWith('/auth/token/refresh')) {
        return json({
          accessToken: { token: 'access-2', validUntil: '1998-07-27T10:30:00Z' },
        });
      }
      if (url.pathname.endsWith('/sessions/online')) {
        return json({ referenceNumber: 'session-ref', validUntil: '1998-07-27T22:00:00Z' }, 201);
      }
      if (url.pathname.endsWith('/sessions/session-ref/invoices/invoice-ref')) {
        statusCalls += 1;
        if (statusCalls === 1) return json({ title: 'expired' }, 401);
        return json({
          referenceNumber: 'invoice-ref',
          invoiceHash: 'hash',
          ksefNumber: '5555555555-20260727-ABC-01',
          acquisitionDate: '1998-07-27T10:01:00Z',
          invoicingDate: '1998-07-27T10:01:00Z',
          permanentStorageDate: '1998-07-27T10:02:00Z',
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
      now: () => new Date('1998-07-27T10:00:00Z'),
      wait: async () => undefined,
    });
    const input = {
      environment: 'test' as const,
      credentials: { tenantId: 'tenant-1', token: 'tenant-ksef-token', contextNip: '5555555555' },
    };

    expect((await client.validateCredentials(input)).ok).toBe(true);
    expect(await client.openSession(input)).toEqual({
      ok: true,
      value: { sessionReference: 'session-ref' },
    });
    expect(await client.openSession({
      ...input,
      credentials: { ...input.credentials, tenantId: 'tenant-2' },
    })).toEqual({
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
    expect(requests.filter((request) => request.path.endsWith('/sessions/online'))).toHaveLength(2);
    expect(requests.find((request) => request.path.endsWith('/auth/token/refresh'))?.authorization)
      .toBe('Bearer refresh-1');
    expect(requests.at(-1)?.authorization).toBe('Bearer access-2');
  });

  it('submits encrypted XML, follows correlation pages, downloads UPO, and closes the session', async () => {
    const requests: Array<{ path: string; headers: Headers; body: unknown }> = [];
    let sessionOpenCount = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const headers = new Headers(init?.headers);
      const rawBody = typeof init?.body === 'string' ? init.body : '';
      requests.push({
        path: url.pathname,
        headers,
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
          validFrom: '1998-01-01T00:00:00Z',
          validTo: '1999-01-01T00:00:00Z',
          usage: ['KsefTokenEncryption', 'SymmetricKeyEncryption'],
        }]);
      }
      if (url.pathname.endsWith('/auth/ksef-token')) {
        return json({
          referenceNumber: 'auth-ref',
          authenticationToken: { token: 'operation-jwt', validUntil: '1998-07-27T11:00:00Z' },
        }, 202);
      }
      if (url.pathname.endsWith('/auth/auth-ref')) {
        return json({ status: { code: 200, description: 'ok' } });
      }
      if (url.pathname.endsWith('/auth/token/redeem')) {
        return json({
          accessToken: { token: 'access-1', validUntil: '1998-07-27T10:15:00Z' },
          refreshToken: { token: 'refresh-1', validUntil: '1998-08-03T10:00:00Z' },
        });
      }
      if (url.pathname.endsWith('/sessions/online')) {
        sessionOpenCount += 1;
        return json({
          referenceNumber: `session-ref-${String(sessionOpenCount)}`,
          validUntil: '1998-07-27T22:00:00Z',
        }, 201);
      }
      if (url.pathname.endsWith('/sessions/online/session-ref-1/invoices')) {
        return json({ referenceNumber: 'invoice-ref' }, 202);
      }
      if (url.pathname.endsWith('/sessions/session-ref-1/invoices')) {
        return headers.get('x-continuation-token') === null
          ? json({ invoices: [], continuationToken: 'next-page' })
          : json({
              invoices: [{
                referenceNumber: 'invoice-ref',
                invoiceHash: 'hash',
                status: { code: 150, description: 'processing' },
              }],
              continuationToken: null,
            });
      }
      if (url.pathname.endsWith('/sessions/session-ref-1/invoices/invoice-ref/upo')) {
        return new Response('<UPO>signed</UPO>', {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        });
      }
      if (url.pathname.endsWith('/sessions/session-ref-1/invoices/rate-limited')) {
        return json({ title: 'slow down' }, 429, { 'retry-after': '12' });
      }
      if (url.pathname.endsWith('/sessions/online/session-ref-1/close')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    const client = createKsefClient({
      fetcher,
      baseUrls: {
        test: 'https://api-test.ksef.mf.gov.pl/v2',
        production: 'https://api.ksef.mf.gov.pl/v2',
      },
      now: () => new Date('1998-07-27T10:00:00Z'),
      wait: async () => undefined,
    });
    const input = {
      environment: 'test' as const,
      credentials: {
        tenantId: 'tenant-1',
        token: 'tenant-ksef-token',
        contextNip: '5555555555',
      },
    };
    const xml = '<Faktura>frozen</Faktura>\n';
    const invoiceHashHex = createHash('sha256').update(xml).digest('hex');

    const opened = await client.openSession(input);
    expect(opened).toEqual({
      ok: true,
      value: { sessionReference: 'session-ref-1' },
    });
    expect(await client.submitInvoice({
      ...input,
      sessionReference: 'session-ref-1',
      xml,
      invoiceHashHex,
    })).toEqual({
      ok: true,
      value: { invoiceReference: 'invoice-ref' },
    });
    expect(await client.listSessionInvoices({
      ...input,
      sessionReference: 'session-ref-1',
    })).toMatchObject({
      ok: true,
      value: [{ invoiceReference: 'invoice-ref' }],
    });
    expect(await client.downloadUpo({
      ...input,
      sessionReference: 'session-ref-1',
      invoiceReference: 'invoice-ref',
      ksefNumber: null,
    })).toEqual({ ok: true, value: '<UPO>signed</UPO>' });
    expect(await client.getInvoiceStatus({
      ...input,
      sessionReference: 'session-ref-1',
      invoiceReference: 'rate-limited',
    })).toMatchObject({
      ok: false,
      error: {
        code: 'rate_limited',
        details: { retryAfterMs: 12_000 },
      },
    });
    expect(await client.closeSession({
      ...input,
      sessionReference: 'session-ref-1',
    })).toEqual({ ok: true, value: undefined });
    expect(await client.openSession(input)).toEqual({
      ok: true,
      value: { sessionReference: 'session-ref-2' },
    });

    const submitted = requests.find((request) =>
      request.path.endsWith('/sessions/online/session-ref-1/invoices'));
    expect(submitted?.body).toMatchObject({
      invoiceHash: Buffer.from(invoiceHashHex, 'hex').toString('base64'),
      invoiceSize: Buffer.byteLength(xml),
      offlineMode: false,
    });
    expect(submitted?.body).not.toMatchObject({
      encryptedInvoiceContent: Buffer.from(xml).toString('base64'),
    });
    expect(requests.filter((request) =>
      request.path.endsWith('/sessions/session-ref-1/invoices'))[1]?.headers
      .get('x-continuation-token')).toBe('next-page');
  });
});
