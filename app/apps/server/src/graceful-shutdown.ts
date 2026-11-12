import type { HttpBindings, ServerType } from '@hono/node-server';

import { safeErrorMessage } from '#core/server/log-safety.js';

import { SERVER_HEADERS_TIMEOUT_MS, SERVER_KEEP_ALIVE_TIMEOUT_MS } from './node-server-limits.js';

export interface BackgroundTicker {
  intervalMs: number;
  run(): Promise<void>;
}

export interface BackgroundTickers {
  stop(): Promise<void>;
}

export const startBackgroundTickers = (tickers: readonly BackgroundTicker[]): BackgroundTickers => {
  const inFlight = new Set<Promise<void>>();
  const timers = tickers.map((ticker) => setInterval(() => {
    const running: Promise<void> = ticker.run()
      .catch(() => undefined)
      .finally(() => {
        inFlight.delete(running);
      });
    inFlight.add(running);
  }, ticker.intervalMs).unref());
  return {
    stop: async () => {
      for (const timer of timers) clearInterval(timer);
      await Promise.all(inFlight);
    },
  };
};

export interface PendingWork {
  track(task: Promise<unknown>): void;
  settled(): Promise<void>;
}

export const createPendingWork = (): PendingWork => {
  const pending = new Set<Promise<void>>();
  return {
    track: (task) => {
      const tracked: Promise<void> = task
        .then(() => undefined, () => undefined)
        .finally(() => {
          pending.delete(tracked);
        });
      pending.add(tracked);
    },
    settled: async () => {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
};

export const trackRequests = <Args extends unknown[], Result>(
  fetch: (...args: Args) => Result,
  work: PendingWork,
): ((...args: Args) => Result) => (...args) => {
  const response = fetch(...args);
  work.track(Promise.resolve(response));
  return response;
};

export const applyConnectionTimeouts = (server: ServerType): void => {
  if (!('keepAliveTimeout' in server)) return;
  server.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
};

export interface DrainableServer {
  server: ServerType;
  stopReusingConnections(): void;
}

export const drainable = (server: ServerType): DrainableServer => {
  if (!('closeIdleConnections' in server)) return { server, stopReusingConnections: () => undefined };
  const open = new Set<HttpBindings['outgoing']>();
  let draining = false;
  const closeAfter = (response: HttpBindings['outgoing']): void => {
    if (!response.headersSent) response.shouldKeepAlive = false;
    response.once('finish', () => {
      server.closeIdleConnections();
    });
  };
  server.prependListener('request', (_request, response) => {
    if (draining) {
      closeAfter(response);
      return;
    }
    open.add(response);
    response.once('close', () => {
      open.delete(response);
    });
  });
  return {
    server,
    stopReusingConnections: () => {
      draining = true;
      for (const response of open) closeAfter(response);
      open.clear();
    },
  };
};

export const createSignalHandler = (
  shutdown: () => Promise<void>,
  log: (line: string) => void,
): ((signal: NodeJS.Signals) => Promise<void>) => {
  let running: Promise<void> | undefined;
  return (signal) => {
    if (running !== undefined) {
      log(`[shutdown] ${signal} received again; still draining`);
      return running;
    }
    log(`[shutdown] ${signal} received; draining`);
    running = shutdown();
    return running;
  };
};

export interface ShutdownPlan {
  servers: readonly DrainableServer[];
  tickers: BackgroundTickers;
  work: PendingWork;
  release: readonly { name: string; run(): Promise<void> }[];
  drainTimeoutMs: number;
  releaseTimeoutMs: number;
  log(line: string): void;
}

const closeServer = ({ server, stopReusingConnections }: DrainableServer): Promise<void> =>
  new Promise((resolve) => {
    stopReusingConnections();
    server.close(() => {
      resolve();
    });
    if ('closeIdleConnections' in server) server.closeIdleConnections();
  });

const withinDeadline = async <T>(work: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          resolve('timeout');
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const shutdownGracefully = async (plan: ShutdownPlan): Promise<void> => {
  const serversClosed = Promise.all(plan.servers.map(closeServer));
  const drained = await withinDeadline(
    Promise.all([serversClosed, plan.tickers.stop()]).then(() => plan.work.settled()),
    plan.drainTimeoutMs,
  );
  if (drained === 'timeout') {
    plan.log(`[shutdown] work still running after ${String(plan.drainTimeoutMs)} ms; closing remaining connections`);
    for (const { server } of plan.servers) {
      if ('closeAllConnections' in server) server.closeAllConnections();
    }
  }
  for (const step of plan.release) {
    const released = await withinDeadline(
      step.run().then(() => 'done' as const, (cause: unknown) => cause),
      plan.releaseTimeoutMs,
    );
    if (released === 'timeout') plan.log(`[shutdown] ${step.name} did not finish within ${String(plan.releaseTimeoutMs)} ms`);
    else if (released !== 'done') plan.log(`[shutdown] ${step.name} failed: ${safeErrorMessage(released)}`);
  }
};
