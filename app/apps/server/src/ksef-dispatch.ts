import type { AppError, Result } from '#core/domain/index.js';
import { safeErrorMessage, safeLogMessage } from '#core/server/log-safety.js';

interface KsefDispatcher {
  dispatch(): Promise<Result<unknown, AppError>>;
}

interface KsefDispatchLogger {
  error(message: string): void;
}

export const dispatchKsef = async (
  ksef: KsefDispatcher | undefined,
  logger: KsefDispatchLogger,
  source: string,
): Promise<void> => {
  if (ksef === undefined) return;
  await ksef.dispatch()
    .then((result) => {
      if (!result.ok) logger.error(`[ksef] ${source} dispatch failed: ${safeLogMessage(result.error.message)}`);
    })
    .catch((cause: unknown) => {
      logger.error(`[ksef] ${source} dispatch rejected: ${safeErrorMessage(cause)}`);
    });
};

export const dispatchKsefInBackground = (
  ksef: KsefDispatcher | undefined,
  logger: KsefDispatchLogger,
  source: string,
): void => {
  void dispatchKsef(ksef, logger, source);
};
