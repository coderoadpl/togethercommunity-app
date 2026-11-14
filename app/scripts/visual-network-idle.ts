const networkIdleQuietWindowMs = 500;
const networkIdleTimeoutMs = 30_000;

export const createVisualNetworkIdle = () => {
  const requests = new Map<object, string>();
  const waiters = new Set<() => void>();
  let idle = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelQuietTimer = (): void => {
    clearTimeout(quietTimer);
    quietTimer = undefined;
  };

  const armQuietTimer = (): void => {
    if (idle || requests.size > 0 || quietTimer !== undefined) return;
    quietTimer = setTimeout(() => {
      quietTimer = undefined;
      idle = true;
      for (const resolve of waiters) resolve();
      waiters.clear();
    }, networkIdleQuietWindowMs);
  };

  const restartQuietWindow = (): void => {
    idle = false;
    cancelQuietTimer();
    armQuietTimer();
  };

  armQuietTimer();

  return {
    requestStarted: (request: object, url: string): void => {
      requests.set(request, url);
      idle = false;
      cancelQuietTimer();
    },
    requestEnded: (request: object): void => {
      requests.delete(request);
      armQuietTimer();
    },
    frameAttached: restartQuietWindow,
    frameNavigated: restartQuietWindow,
    wait: (): Promise<void> => {
      if (idle) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const onIdle = (): void => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          waiters.delete(onIdle);
          reject(new Error(`Network idle timed out after ${networkIdleTimeoutMs} ms; requests still in flight: ${[...requests.values()].join(', ') || '(none)'}`));
        }, networkIdleTimeoutMs);
        waiters.add(onIdle);
      });
    },
  };
};
