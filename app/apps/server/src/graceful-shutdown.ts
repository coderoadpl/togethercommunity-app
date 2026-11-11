import type { ServerType } from '@hono/node-server';

import { safeErrorMessage } from '#core/server/log-safety.js';

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

export interface ShutdownPlan {
  servers: readonly ServerType[];
  tickers: BackgroundTickers;
  release: readonly { name: string; run(): Promise<void> }[];
  drainTimeoutMs: number;
  releaseTimeoutMs: number;
  log(line: string): void;
}

const closeServer = (server: ServerType): Promise<void> =>
  new Promise((resolve) => {
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
    Promise.all([serversClosed, plan.tickers.stop()]),
    plan.drainTimeoutMs,
  );
  if (drained === 'timeout') {
    plan.log(`[shutdown] work still running after ${String(plan.drainTimeoutMs)} ms; closing remaining connections`);
    for (const server of plan.servers) {
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
