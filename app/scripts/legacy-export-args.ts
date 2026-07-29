export const DEFAULT_BACKUPS_DIR =
  '~/legacy-backups';

export class BackupArgError extends Error {}

export const resolveBackupsDir = (
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): string => {
  const flagIndex = argv.indexOf('--backup');
  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new BackupArgError('--backup requires a directory path');
    }
    return value;
  }
  return env['BACKUPS_DIR'] ?? DEFAULT_BACKUPS_DIR;
};
