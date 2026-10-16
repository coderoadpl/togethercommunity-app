import { serializeErrorChain } from '#core/server/log-safety.js';

export const CACHE_TTL_MS = 60_000;
export const FAILURE_RETRY_MS = 1_000;

export const createTrustedOrigins = (deps: {
  configuredOrigins: readonly string[];
  loadCustomOrigins: () => Promise<readonly string[]>;
  logger: { error(message: string): void; warn?(message: string): void };
  now?: () => number;
}): (() => Promise<string[]>) => {
  const now = deps.now ?? Date.now;
  let origins = [...new Set(deps.configuredOrigins)];
  let freshUntil = 0;
  let retryNotBefore = 0;
  let consecutiveFailures = 0;
  let lastSuccessAt: number | null = null;
  let pending: Promise<string[]> | null = null;
  let failureLogged = false;

  const log = (message: string, recovery = false): void => {
    try {
      if (recovery && deps.logger.warn) deps.logger.warn(message);
      else deps.logger.error(message);
    } catch {
      // Logging failures must not poison the shared auth initialization promise.
    }
  };

  const refresh = async (): Promise<string[]> => {
    try {
      const customOrigins = await deps.loadCustomOrigins();
      origins = [...new Set([...deps.configuredOrigins, ...customOrigins])];
      lastSuccessAt = now();
      freshUntil = lastSuccessAt + CACHE_TTL_MS;
      retryNotBefore = 0;
      if (consecutiveFailures > 0) {
        log(`[trusted-origins] Domain lookup recovered after ${String(consecutiveFailures)} failures`, true);
      }
      consecutiveFailures = 0;
      failureLogged = false;
    } catch (cause) {
      consecutiveFailures += 1;
      retryNotBefore = now() + FAILURE_RETRY_MS;
      if (!failureLogged) {
        failureLogged = true;
        log(`[trusted-origins] Using cached origins after domain lookup failed: ${serializeErrorChain(cause)} cold=${String(lastSuccessAt === null)}`);
      }
    }
    return [...origins];
  };

  return async () => {
    if (now() < freshUntil) return [...origins];
    if (now() < retryNotBefore) return [...origins];
    pending ??= refresh();
    try {
      return [...await pending];
    } finally {
      pending = null;
    }
  };
};
