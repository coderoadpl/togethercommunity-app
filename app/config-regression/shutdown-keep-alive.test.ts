import { Agent, request as httpRequest } from 'node:http';
import { connect, type Socket } from 'node:net';

import { serve, type ServerType } from '@hono/node-server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyConnectionTimeouts,
  createPendingWork,
  createSignalHandler,
  drainable,
  shutdownGracefully,
  type DrainableServer,
} from '../apps/server/src/graceful-shutdown.js';
import { SHUTDOWN_DRAIN_TIMEOUT_MS } from '../apps/server/src/node-server-limits.js';

interface Gate {
  promise: Promise<void>;
  open(): void;
}

const gate = (): Gate => {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

interface PooledResponse {
  status: number;
  connection: string | undefined;
  reusedSocket: boolean;
  body: Promise<string>;
}

const listening: ServerType[] = [];
const agents: Agent[] = [];
const sockets: Socket[] = [];

afterEach(() => {
  for (const server of listening.splice(0)) {
    if (server.listening) server.close();
    if ('closeAllConnections' in server) server.closeAllConnections();
  }
  for (const agent of agents.splice(0)) agent.destroy();
  for (const socket of sockets.splice(0)) socket.destroy();
});

const startServer = async (handler: (request: Request) => Promise<Response>): Promise<{ server: ServerType; url: string; handled: string[] }> => {
  const handled: string[] = [];
  let resolvePort: (port: number) => void = () => undefined;
  const port = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  const server = serve({
    fetch: (request) => {
      handled.push(new URL(request.url).pathname);
      return handler(request);
    },
    port: 0,
    hostname: '127.0.0.1',
  }, (info) => {
    resolvePort(info.port);
  });
  listening.push(server);
  applyConnectionTimeouts(server);
  return { server, url: `http://127.0.0.1:${String(await port)}`, handled };
};

const singleConnectionAgent = (): Agent => {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  agents.push(agent);
  return agent;
};

const send = (agent: Agent, url: string, method = 'GET'): Promise<PooledResponse> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(url, { agent, method }, (response) => {
      response.setEncoding('utf8');
      const chunks: string[] = [];
      resolve({
        status: response.statusCode ?? 0,
        connection: response.headers.connection,
        reusedSocket: request.reusedSocket,
        body: new Promise((resolveBody) => {
          response.on('data', (chunk: string) => { chunks.push(chunk); });
          response.on('end', () => { resolveBody(chunks.join('')); });
        }),
      });
    });
    request.on('error', reject);
    request.end();
  });

const outcome = (response: Promise<PooledResponse>): Promise<string> => response.then(
  (answered) => `served ${String(answered.status)}`,
  (error: unknown) => error instanceof Error && 'code' in error ? String(error.code) : String(error),
);

const settledWithin = async (work: Promise<unknown>, ms: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    work.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => { resolve(false); }, ms);
    }),
  ]);
  clearTimeout(timer);
  return settled;
};

interface RawConnection {
  write(text: string): void;
  closed: Promise<string>;
}

const openRaw = async (url: string): Promise<RawConnection> => {
  const { hostname, port } = new URL(url);
  const socket = connect(Number(port), hostname);
  sockets.push(socket);
  await new Promise<void>((resolve) => { socket.once('connect', resolve); });
  const chunks: string[] = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => { chunks.push(chunk); });
  socket.on('error', () => undefined);
  return {
    write: (text) => { socket.write(text); },
    closed: new Promise((resolve) => { socket.once('close', () => { resolve(chunks.join('')); }); }),
  };
};

const statusLines = (received: string): string[] => received.match(/HTTP\/1\.[01] \d{3}/gu) ?? [];

const signalHandler = (server: DrainableServer, events: string[]) => createSignalHandler(
  () => shutdownGracefully({
    servers: [server],
    tickers: { stop: async () => undefined },
    work: createPendingWork(),
    release: [{ name: 'database connections', run: async () => { events.push('database closed'); } }],
    drainTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
    releaseTimeoutMs: 1_000,
    log: (line) => { events.push(line); },
  }),
  (line) => { events.push(line); },
);

describe('shutdown of a pooled keep-alive connection from the edge', () => {
  it('answers the request in flight at SIGTERM with Connection: close, serves nothing more on that connection and ends the drain with the work', async () => {
    const entered = gate();
    const finish = gate();
    const { server, url, handled } = await startServer(async (request) => {
      if (new URL(request.url).pathname === '/payment') {
        entered.open();
        await finish.promise;
      }
      return new Response('ok');
    });
    const events: string[] = [];
    const onSignal = signalHandler(drainable(server), events);
    const edge = singleConnectionAgent();

    const warm = await send(edge, `${url}/warm`);
    expect(warm.connection).toBe('keep-alive');
    await warm.body;
    const inFlight = send(edge, `${url}/payment`, 'POST');
    await entered.promise;
    const shutdown = onSignal('SIGTERM');
    finish.open();

    const answered = await inFlight;
    expect(answered).toMatchObject({ status: 200, connection: 'close', reusedSocket: true });
    expect(await answered.body).toBe('ok');
    expect(await outcome(send(edge, `${url}/after-signal`))).toBe('ECONNREFUSED');
    expect(await settledWithin(shutdown, 5_000)).toBe(true);
    expect(handled).toEqual(['/warm', '/payment']);
    expect(events).toEqual(['[shutdown] SIGTERM received; draining', 'database closed']);
  });

  it('closes a connection whose streamed response began before SIGTERM as soon as that response ends', async () => {
    const finish = gate();
    const encoder = new TextEncoder();
    const { server, url, handled } = await startServer(async () => new Response(new ReadableStream<Uint8Array>({
      start: async (controller) => {
        controller.enqueue(encoder.encode('first;'));
        await finish.promise;
        controller.enqueue(encoder.encode('last'));
        controller.close();
      },
    })));
    const events: string[] = [];
    const onSignal = signalHandler(drainable(server), events);
    const edge = singleConnectionAgent();

    const streaming = await send(edge, `${url}/stream`);
    expect(streaming.connection).toBe('keep-alive');
    const shutdown = onSignal('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['[shutdown] SIGTERM received; draining']);
    finish.open();

    expect(await streaming.body).toBe('first;last');
    expect(await settledWithin(shutdown, 5_000)).toBe(true);
    expect(await outcome(send(edge, `${url}/after-stream`))).toMatch(/^ECONN(?:REFUSED|RESET)$/u);
    expect(handled).toEqual(['/stream']);
    expect(events).toEqual(['[shutdown] SIGTERM received; draining', 'database closed']);
  });
});

describe('shutdown of a pipelined HTTP/1.1 connection', () => {
  const pipelinedServer = async () => {
    const entered = gate();
    const finish = gate();
    const sideEffects: string[] = [];
    const started = await startServer(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/first') {
        entered.open();
        await finish.promise;
      }
      if (request.method === 'POST') sideEffects.push(path);
      return new Response('ok');
    });
    return { ...started, entered, finish, sideEffects };
  };

  it('never hands the application a request pipelined after SIGTERM behind a response still being answered', async () => {
    const { server, url, handled, entered, finish, sideEffects } = await pipelinedServer();
    const events: string[] = [];
    const onSignal = signalHandler(drainable(server), events);
    const client = await openRaw(url);

    client.write('GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
    await entered.promise;
    const shutdown = onSignal('SIGTERM');
    client.write('POST /after-signal HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nhi');
    await new Promise((resolve) => setTimeout(resolve, 20));
    finish.open();

    const received = await client.closed;
    expect(await settledWithin(shutdown, 5_000)).toBe(true);
    expect(handled).toEqual(['/first']);
    expect(sideEffects).toEqual([]);
    expect(statusLines(received)).toEqual(['HTTP/1.1 200']);
    expect(received).toContain('Connection: close');
  });

  it('answers in order every pipelined request accepted before SIGTERM and closes after the last one', async () => {
    const { server, url, handled, entered, finish, sideEffects } = await pipelinedServer();
    const events: string[] = [];
    const onSignal = signalHandler(drainable(server), events);
    const client = await openRaw(url);

    client.write([
      'GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n',
      'POST /before-signal HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nhi',
    ].join(''));
    await entered.promise;
    await vi.waitFor(() => { expect(handled).toEqual(['/first', '/before-signal']); });
    const shutdown = onSignal('SIGTERM');
    finish.open();

    const received = await client.closed;
    expect(await settledWithin(shutdown, 5_000)).toBe(true);
    expect(sideEffects).toEqual(['/before-signal']);
    expect(statusLines(received)).toEqual(['HTTP/1.1 200', 'HTTP/1.1 200']);
    const [first, second] = received.split(/(?=HTTP\/1\.1 \d{3} )/u);
    expect(first).toContain('Connection: keep-alive');
    expect(second).toContain('Connection: close');
  });

  it('answers an HTTP/1.0 request in flight at SIGTERM and closes its connection', async () => {
    const { server, url, handled, entered, finish } = await pipelinedServer();
    const events: string[] = [];
    const onSignal = signalHandler(drainable(server), events);
    const client = await openRaw(url);

    client.write('GET /first HTTP/1.0\r\nHost: localhost\r\n\r\n');
    await entered.promise;
    const shutdown = onSignal('SIGTERM');
    finish.open();

    const received = await client.closed;
    expect(await settledWithin(shutdown, 5_000)).toBe(true);
    expect(handled).toEqual(['/first']);
    expect(statusLines(received)).toEqual(['HTTP/1.1 200']);
    expect(received.endsWith('ok')).toBe(true);
  });
});
