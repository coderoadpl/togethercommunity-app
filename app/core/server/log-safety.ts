import { errorChainEntrySchema } from '#core/domain/index.js';

const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

const DRIZZLE_QUERY_PARAMS = /(?:^|\r?\n)[ \t]*params:[\s\S]*$/u;

export const safeLogMessage = (message: string): string => message.replace(DRIZZLE_QUERY_PARAMS, '');

// Random provider ids hold a digit or a capital letter, which keeps snake_case words such as in_transit readable.
const PROVIDER_OBJECT_ID = /\b(?:acct|ba|card|ch|cn|cs|cus|dp|du|evt|ic|ii|il|in|ipi|pi|pm|po|price|prod|py|pyr|re|rk|seti|si|sk|src|sub|tok|tr|txn|we|whsec)_(?:(?:live|test)_)?(?=[a-z0-9]*[0-9A-Z])[A-Za-z0-9]{6,}\b/gu;

export const safeProviderLogMessage = (message: string): string =>
  safeLogMessage(message).replace(PROVIDER_OBJECT_ID, '[provider id]');

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
    const { name, message, code, routine, cause } = parsed.data;
    chain.push({
      name: name ?? 'Error',
      message: safeLogMessage(message),
      ...(code === undefined ? {} : { code }),
      ...(routine === undefined ? {} : { routine }),
    });
    current = cause;
  }
  return JSON.stringify(chain);
};
