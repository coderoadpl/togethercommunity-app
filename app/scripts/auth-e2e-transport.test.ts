import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

import { createAuthE2eClient } from '#adapters/auth/e2e-http.js';
import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { createAuthE2eTransport } from './auth-e2e-transport.js';

const password = 'x'.repeat(PASSWORD_MIN_LENGTH);

describe('auth E2E transport', () => {
  it('preserves the browser host and credentials over a real loopback connection', async () => {
    const calls: { host: string | undefined; origin: string | undefined; authorization: string | undefined; body: string }[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        calls.push({ host: request.headers.host, origin: request.headers.origin, authorization: request.headers.authorization, body });
        response.writeHead(200, { 'content-type': 'application/json', 'set-auth-token': 'session-token' });
        response.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Missing server port');
      const origin = `http://acme.localhost:${address.port}`;
      const client = createAuthE2eClient(createAuthE2eTransport(`http://127.0.0.1:${address.port}`, origin));
      const credentials = { email: 'ada@together.dev', password };
      expect(await client.signInEmail(credentials)).toEqual({ status: 200, token: 'session-token', json: { ok: true } });
      await client.enableTwoFactor('session-token', password);
      expect(calls).toEqual([
        { host: new URL(origin).host, origin, authorization: undefined, body: JSON.stringify(credentials) },
        { host: new URL(origin).host, origin, authorization: 'Bearer session-token', body: JSON.stringify({ password }) },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
