import { serve, type ServerType } from '@hono/node-server';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyConnectionTimeouts,
  createPendingWork,
  createSignalHandler,
  drainable,
  shutdownGracefully,
  startBackgroundTickers,
  trackRequests,
  type BackgroundTickers,
} from './graceful-shutdown.js';
import { SERVER_HEADERS_TIMEOUT_MS, SERVER_KEEP_ALIVE_TIMEOUT_MS } from './node-server-limits.js';

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

const idleTickers: BackgroundTickers = { stop: async () => undefined };

const listening: ServerType[] = [];

const startServer = async (handler: (request: Request) => Promise<Response>): Promise<{ server: ServerType; url: string }> => {
  let resolvePort: (port: number) => void = () => undefined;
  const port = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  const server = serve({ fetch: handler, port: 0, hostname: '127.0.0.1' }, (info) => {
    resolvePort(info.port);
  });
  listening.push(server);
  return { server, url: `http://127.0.0.1:${String(await port)}` };
};

afterEach(() => {
  for (const server of listening.splice(0)) {
    if (server.listening) server.close();
  }
});

describe('graceful shutdown', () => {
  it('lets an in-flight request finish, refuses new connections, then releases resources in order', async () => {
    const entered = gate();
    const release = gate();
    const { server, url } = await startServer(async () => {
      entered.open();
      await release.promise;
      return new Response('finished');
    });
    const events: string[] = [];

    const inFlight = fetch(`${url}/slow`);
    await entered.promise;
    const shutdown = shutdownGracefully({
      servers: [drainable(server)],
      tickers: { stop: async () => { events.push('tickers stopped'); } },
      work: createPendingWork(),
      release: [
        { name: 'auth e-mail flush', run: async () => { events.push('auth e-mail flushed'); } },
        { name: 'database connections', run: async () => { events.push('database closed'); } },
      ],
      drainTimeoutMs: 5_000,
      releaseTimeoutMs: 1_000,
      log: (line) => { events.push(line); },
    });

    await expect(fetch(`${url}/late`)).rejects.toThrow();
    expect(events).toEqual(['tickers stopped']);

    release.open();
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('finished');

    await shutdown;
    expect(events).toEqual(['tickers stopped', 'auth e-mail flushed', 'database closed']);
    expect(server.listening).toBe(false);
  });

  it('closes connections that outlive the drain budget and still releases resources', async () => {
    const entered = gate();
    const { server, url } = await startServer(async () => {
      entered.open();
      return new Promise<Response>(() => undefined);
    });
    const log: string[] = [];
    let databaseClosed = false;

    const stuck = fetch(`${url}/stuck`);
    await entered.promise;
    await shutdownGracefully({
      servers: [drainable(server)],
      tickers: idleTickers,
      work: createPendingWork(),
      release: [{ name: 'database connections', run: async () => { databaseClosed = true; } }],
      drainTimeoutMs: 50,
      releaseTimeoutMs: 1_000,
      log: (line) => { log.push(line); },
    });

    await expect(stuck).rejects.toThrow();
    expect(log).toEqual(['[shutdown] work still running after 50 ms; closing remaining connections']);
    expect(databaseClosed).toBe(true);
  });

  it('reports a failing or hanging release step and continues with the next one', async () => {
    const { server } = await startServer(async () => new Response('ok'));
    const log: string[] = [];
    let databaseClosed = false;

    await shutdownGracefully({
      servers: [drainable(server)],
      tickers: idleTickers,
      work: createPendingWork(),
      release: [
        { name: 'auth e-mail flush', run: () => Promise.reject(new Error('transport offline')) },
        { name: 'trace export', run: () => new Promise<void>(() => undefined) },
        { name: 'database connections', run: async () => { databaseClosed = true; } },
      ],
      drainTimeoutMs: 1_000,
      releaseTimeoutMs: 20,
      log: (line) => { log.push(line); },
    });

    expect(log).toEqual([
      '[shutdown] auth e-mail flush failed: transport offline',
      '[shutdown] trace export did not finish within 20 ms',
    ]);
    expect(databaseClosed).toBe(true);
  });
});

describe('graceful shutdown of work outside the connection', () => {
  it('waits for a handler whose client already disconnected before releasing the database', async () => {
    const entered = gate();
    const finish = gate();
    const work = createPendingWork();
    const events: string[] = [];
    const disconnected = gate();
    const { server, url } = await startServer(trackRequests(async () => {
      entered.open();
      await finish.promise;
      events.push('handler wrote its result');
      return new Response('done');
    }, work));
    server.on('connection', (socket) => {
      socket.on('close', disconnected.open);
    });

    const client = new AbortController();
    const request = fetch(`${url}/api/internal/dispatch-email`, { signal: client.signal }).catch(() => undefined);
    await entered.promise;
    client.abort();
    await request;
    await disconnected.promise;

    const shutdown = shutdownGracefully({
      servers: [drainable(server)],
      tickers: idleTickers,
      work,
      release: [{ name: 'database connections', run: async () => { events.push('database closed'); } }],
      drainTimeoutMs: 5_000,
      releaseTimeoutMs: 1_000,
      log: (line) => { events.push(line); },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual([]);

    finish.open();
    await shutdown;
    expect(events).toEqual(['handler wrote its result', 'database closed']);
  });

  it('waits for background work started after the response, including work it starts in turn', async () => {
    const work = createPendingWork();
    const events: string[] = [];
    const firstBatch = gate();
    const followUp = gate();
    work.track(firstBatch.promise.then(() => {
      events.push('e-mail batch sent');
      work.track(followUp.promise.then(() => { events.push('follow-up batch sent'); }));
    }));
    const { server } = await startServer(async () => new Response('ok'));

    const shutdown = shutdownGracefully({
      servers: [drainable(server)],
      tickers: idleTickers,
      work,
      release: [{ name: 'database connections', run: async () => { events.push('database closed'); } }],
      drainTimeoutMs: 5_000,
      releaseTimeoutMs: 1_000,
      log: (line) => { events.push(line); },
    });
    firstBatch.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['e-mail batch sent']);

    followUp.open();
    await shutdown;
    expect(events).toEqual(['e-mail batch sent', 'follow-up batch sent', 'database closed']);
  });

  it('stops waiting for background work at the drain budget and still releases', async () => {
    const work = createPendingWork();
    work.track(new Promise(() => undefined));
    work.track(Promise.reject(new Error('dispatch failed')));
    const { server } = await startServer(async () => new Response('ok'));
    const log: string[] = [];
    let databaseClosed = false;

    await shutdownGracefully({
      servers: [drainable(server)],
      tickers: idleTickers,
      work,
      release: [{ name: 'database connections', run: async () => { databaseClosed = true; } }],
      drainTimeoutMs: 30,
      releaseTimeoutMs: 1_000,
      log: (line) => { log.push(line); },
    });

    expect(log).toEqual(['[shutdown] work still running after 30 ms; closing remaining connections']);
    expect(databaseClosed).toBe(true);
  });
});

describe('shutdown signals', () => {
  it('runs one shutdown for repeated signals and hands every caller the same promise', async () => {
    const done = gate();
    let runs = 0;
    const log: string[] = [];
    const onSignal = createSignalHandler(async () => {
      runs += 1;
      await done.promise;
    }, (line) => { log.push(line); });

    const first = onSignal('SIGTERM');
    const second = onSignal('SIGTERM');
    const third = onSignal('SIGINT');

    expect(runs).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(log).toEqual([
      '[shutdown] SIGTERM received; draining',
      '[shutdown] SIGTERM received again; still draining',
      '[shutdown] SIGINT received again; still draining',
    ]);
    done.open();
    await first;
  });
});

describe('connection timeouts', () => {
  it('keeps idle connections open longer than the edge proxy and waits longer still for headers', async () => {
    const { server } = await startServer(async () => new Response('ok'));

    applyConnectionTimeouts(server);

    expect('keepAliveTimeout' in server && server.keepAliveTimeout).toBe(SERVER_KEEP_ALIVE_TIMEOUT_MS);
    expect('headersTimeout' in server && server.headersTimeout).toBe(SERVER_HEADERS_TIMEOUT_MS);
    expect(SERVER_HEADERS_TIMEOUT_MS).toBeGreaterThan(SERVER_KEEP_ALIVE_TIMEOUT_MS);
  });
});

describe('background tickers', () => {
  it('stops scheduling new runs and waits for the run already in progress', async () => {
    const running = gate();
    const finish = gate();
    let started = 0;
    let finished = 0;
    const tickers = startBackgroundTickers([{
      intervalMs: 5,
      run: async () => {
        started += 1;
        running.open();
        await finish.promise;
        finished += 1;
      },
    }]);

    await running.promise;
    let stopped = false;
    const stopping = tickers.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);

    finish.open();
    await stopping;
    expect(finished).toBe(started);
    const startedAtStop = started;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(started).toBe(startedAtStop);
  });

  it('keeps ticking after a run rejects', async () => {
    let runs = 0;
    const tickers = startBackgroundTickers([{
      intervalMs: 5,
      run: async () => {
        runs += 1;
        throw new Error('database unavailable');
      },
    }]);

    await expect.poll(() => runs).toBeGreaterThanOrEqual(2);
    await tickers.stop();
  });
});
