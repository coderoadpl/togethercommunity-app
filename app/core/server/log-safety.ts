const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

const DRIZZLE_QUERY_PARAMS = /(?:^|\r?\n)[ \t]*params:[\s\S]*$/u;

export const safeLogMessage = (message: string): string => message.replace(DRIZZLE_QUERY_PARAMS, '');

export const safeErrorMessage = (error: unknown): string =>
  error instanceof Error ? safeLogMessage(error.message) : UNKNOWN_ERROR_MESSAGE;
