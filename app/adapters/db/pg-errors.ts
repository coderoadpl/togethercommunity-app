const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;

const pgError = (cause: unknown): Record<string, unknown> | null => {
  const outer = record(cause);
  return outer?.['code'] === undefined ? record(outer?.['cause']) : outer;
};

export const uniqueViolation = (
  cause: unknown,
  constraint?: string,
): boolean => {
  const error = pgError(cause);
  return error?.['code'] === '23505'
    && (constraint === undefined || error['constraint'] === constraint);
};
