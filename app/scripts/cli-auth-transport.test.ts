import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCliAuthAdapter } from '#adapters/auth/client-adapter.js';
import { BETTER_AUTH_SIGN_UP_PATH, createAuth, createAuthPort } from '#adapters/auth/create-auth.js';
import { createEmailOutboxRepository, createPlatformAuthSendLog } from '#adapters/db/email-outbox.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createDevEmailPort } from '#adapters/email/dev.js';
import { ok, PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase(
    'together_cli_auth_transport_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together',
  );
});
afterAll(async () => { await database?.close(); });

const password = 'cli-transport-password'.padEnd(PASSWORD_MIN_LENGTH, 'x');

const buildAuth = (origin: string) => {
  const db = database.db;
  const auth = createAuth(db, {
    secret: 'cli-auth-transport-test-secret-32-characters',
    baseUrl: origin,
    baseDomain: 'localhost',
    singleTenantMode: true,
    trustedOrigins: [origin],
    secureCookies: false,
    exposeMagicLinks: true,
    emailOutbox: createEmailOutboxRepository(db),
    emailSender: {
      send: async (message) => {
        const sent = await createDevEmailPort(db).send(message);
        return sent.ok ? ok({ ...sent.value, transport: 'platform' as const }) : sent;
      },
    },
    authSendLog: createPlatformAuthSendLog(db),
    ids: { nextId: () => crypto.randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    dispatchEmail: () => undefined,
    defaultTenantName: 'Together',
    google: null,
  });
  return { auth, authPort: createAuthPort(auth) };
};

const readBody = (request: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => { body += chunk; });
  request.on('end', () => { resolve(body); });
  request.on('error', reject);
});

const toRequest = async (incoming: IncomingMessage): Promise<Request> => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = incoming.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(incoming);
  return new Request(`http://${incoming.headers.host ?? ''}${incoming.url ?? ''}`, {
    method, headers, ...(body === undefined ? {} : { body }),
  });
};

describe('CLI auth transport', () => {
  it('receives the session token from the real auth handler over a loopback connection with global fetch', async () => {
    let forward: (request: Request) => Promise<Response> = async () => new Response(null, { status: 503 });
    const fetchMetadata: (string | string[] | undefined)[] = [];
    const server = createServer((incoming, outgoing) => {
      void (async () => {
        fetchMetadata.push(incoming.headers['sec-fetch-site']);
        const response = await forward(await toRequest(incoming));
        const headers: Record<string, string | string[]> = {};
        response.headers.forEach((value, name) => { if (name !== 'set-cookie') headers[name] = value; });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) headers['set-cookie'] = cookies;
        outgoing.writeHead(response.status, headers);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      })();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Missing server port');
      const baseUrl = `http://127.0.0.1:${String(address.port)}`;
      const { auth, authPort } = buildAuth(baseUrl);
      forward = auth.handler;
      const email = `cli-transport-${crypto.randomUUID()}@together.dev`;
      const signedUp = await auth.handler(new Request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ name: 'Ada', email, password }),
      }));
      expect(signedUp.status).toBe(200);
      const stored: string[] = [];

      const signedIn = await createCliAuthAdapter(baseUrl, (token) => { stored.push(token); }).signIn({ email, password });

      expect(signedIn.ok).toBe(true);
      expect(fetchMetadata).toEqual([undefined]);
      expect(stored).toHaveLength(1);
      expect(await authPort.getAuthenticatedUser(new Headers({ authorization: `Bearer ${stored[0] ?? ''}` })))
        .toMatchObject({ email });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
