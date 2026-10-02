import type { AppError, Result } from '#core/domain/index.js';
import { safeErrorMessage, safeLogMessage } from '#core/server/log-safety.js';

interface KsefDispatcher {
  dispatch(): Promise<Result<unknown, AppError>>;
}

interface KsefDispatchLogger {
  error(message: string): void;
}

export const dispatchKsefInBackground = (
  ksef: KsefDispatcher | undefined,
  logger: KsefDispatchLogger,
  source: string,
): void => {
  if (ksef === undefined) return;
  void ksef.dispatch()
    .then((result) => {
      if (!result.ok) logger.error(`[ksef] ${source} dispatch failed: ${safeLogMessage(result.error.message)}`);
    })
    .catch((cause: unknown) => {
      logger.error(`[ksef] ${source} dispatch rejected: ${safeErrorMessage(cause)}`);
    });
};
