import { serve, type ServerType } from '@hono/node-server';
import { afterEach, describe, expect, it } from 'vitest';

import { shutdownGracefully, startBackgroundTickers, type BackgroundTickers } from './graceful-shutdown.js';

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
      servers: [server],
      tickers: { stop: async () => { events.push('tickers stopped'); } },
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
      servers: [server],
      tickers: idleTickers,
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
      servers: [server],
      tickers: idleTickers,
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
