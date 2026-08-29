const BROWSERS: readonly (readonly [string, string])[] = [
  ['Edg/', 'Edge'],
  ['OPR/', 'Opera'],
  ['Firefox/', 'Firefox'],
  ['Chrome/', 'Chrome'],
  ['Safari/', 'Safari'],
];

const SYSTEMS: readonly (readonly [string, string])[] = [
  ['iPhone', 'iOS'],
  ['iPad', 'iPadOS'],
  ['Android', 'Android'],
  ['Mac OS X', 'macOS'],
  ['Macintosh', 'macOS'],
  ['Windows', 'Windows'],
  ['CrOS', 'ChromeOS'],
  ['Linux', 'Linux'],
];

const RAW_LABEL_MAX_LENGTH = 60;

const firstMatch = (
  userAgent: string,
  table: readonly (readonly [string, string])[],
): string | null => table.find(([needle]) => userAgent.includes(needle))?.[1] ?? null;

const truncate = (value: string): string =>
  value.length <= RAW_LABEL_MAX_LENGTH ? value : `${value.slice(0, RAW_LABEL_MAX_LENGTH)}…`;

export const summarizeUserAgent = (userAgent: string | null): string | null => {
  const trimmed = userAgent?.trim() ?? '';
  if (trimmed === '') return null;
  const parts = [firstMatch(trimmed, BROWSERS), firstMatch(trimmed, SYSTEMS)]
    .filter((part): part is string => part !== null);
  return parts.length === 0 ? truncate(trimmed) : parts.join(' · ');
};
