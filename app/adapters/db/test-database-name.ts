const POSTGRES_IDENTIFIER_LIMIT = 63;
const SUFFIX_LENGTH = 16;

export const uniqueTestDatabaseName = (base: string): string => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, SUFFIX_LENGTH);
  const availableBaseLength = POSTGRES_IDENTIFIER_LIMIT - suffix.length - 1;
  return `${base.slice(0, availableBaseLength)}_${suffix}`;
};
