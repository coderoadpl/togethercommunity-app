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
  const fromEnv = env['TOGETHER_LEGACY_BACKUPS_DIR'];
  if (fromEnv === undefined || fromEnv === '') {
    throw new BackupArgError(
      'no backups directory: pass --backup <dir> or set TOGETHER_LEGACY_BACKUPS_DIR',
    );
  }
  return fromEnv;
};
