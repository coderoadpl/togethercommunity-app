import { serializeErrorChain } from '#core/server/log-safety.js';

const CACHE_TTL_MS = 60_000;

export const createTrustedOrigins = (deps: {
  configuredOrigins: readonly string[];
  loadCustomOrigins: () => Promise<readonly string[]>;
  logger: { error(message: string): void };
  now?: () => number;
}): (() => Promise<string[]>) => {
  const now = deps.now ?? Date.now;
  let origins = [...new Set(deps.configuredOrigins)];
  let expiresAt = 0;
  let pending: Promise<string[]> | null = null;
  let failureLogged = false;

  const refresh = async (): Promise<string[]> => {
    try {
      const customOrigins = await deps.loadCustomOrigins();
      origins = [...new Set([...deps.configuredOrigins, ...customOrigins])];
      failureLogged = false;
    } catch (cause) {
      if (!failureLogged) {
        failureLogged = true;
        try {
          deps.logger.error(`[trusted-origins] Using cached origins after domain lookup failed: ${serializeErrorChain(cause)}`);
        } catch {
          // Logging failures must not poison the shared auth initialization promise.
        }
      }
    }
    expiresAt = now() + CACHE_TTL_MS;
    return [...origins];
  };

  return async () => {
    if (now() < expiresAt) return [...origins];
    pending ??= refresh();
    try {
      return [...await pending];
    } finally {
      pending = null;
    }
  };
};
