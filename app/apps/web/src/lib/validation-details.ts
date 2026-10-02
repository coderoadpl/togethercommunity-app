export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const fieldErrorEntries = (details: unknown): [string, string[]][] => {
  if (details === null || typeof details !== 'object' || !('fieldErrors' in details)) return [];
  const { fieldErrors } = details;
  if (fieldErrors === null || typeof fieldErrors !== 'object') return [];
  return Object.entries(fieldErrors).flatMap(([name, value]) => isStringArray(value) && value.length > 0 ? [[name, value] satisfies [string, string[]]] : []);
};
