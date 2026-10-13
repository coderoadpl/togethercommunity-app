import { errorChainEntrySchema } from '#core/domain/index.js';

const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

const DRIZZLE_QUERY_PARAMS = /(?:^|\r?\n)[ \t]*params:[\s\S]*$/u;

export const safeLogMessage = (message: string): string => message.replace(DRIZZLE_QUERY_PARAMS, '');

export const safeErrorMessage = (error: unknown): string =>
  error instanceof Error ? safeLogMessage(error.message) : UNKNOWN_ERROR_MESSAGE;

export const serializeErrorChain = (error: unknown): string => {
  const seen = new Set<unknown>();
  const chain: Array<Record<string, string>> = [];
  let current: unknown = error;
  while (current !== undefined) {
    if (seen.has(current)) {
      chain.push({ message: 'Circular error cause' });
      break;
    }
    seen.add(current);
    const parsed = errorChainEntrySchema.safeParse(current);
    if (!parsed.success) {
      chain.push({ message: UNKNOWN_ERROR_MESSAGE });
      break;
    }
    const { name, message, code, detail, routine, cause } = parsed.data;
    chain.push({
      name: name ?? 'Error',
      message: safeLogMessage(message),
      ...(code === undefined ? {} : { code }),
      ...(detail === undefined ? {} : { detail: safeLogMessage(detail) }),
      ...(routine === undefined ? {} : { routine }),
    });
    current = cause;
  }
  return JSON.stringify(chain);
};
