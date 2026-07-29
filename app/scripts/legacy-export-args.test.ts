import { describe, expect, it } from 'vitest';

import { BackupArgError, DEFAULT_BACKUPS_DIR, resolveBackupsDir } from './legacy-export-args.js';

describe('resolveBackupsDir', () => {
  it('prefers an explicit --backup argument', () => {
    expect(resolveBackupsDir(['--backup', '/data/dumps'], {})).toBe('/data/dumps');
    expect(resolveBackupsDir(['--backup', '/data/dumps'], { BACKUPS_DIR: '/env' })).toBe('/data/dumps');
  });

  it('falls back to the BACKUPS_DIR env var', () => {
    expect(resolveBackupsDir([], { BACKUPS_DIR: '/env/dumps' })).toBe('/env/dumps');
  });

  it('preserves the default when neither is provided', () => {
    expect(resolveBackupsDir([], {})).toBe(DEFAULT_BACKUPS_DIR);
  });

  it('rejects --backup without a directory value', () => {
    expect(() => resolveBackupsDir(['--backup'], {})).toThrow(BackupArgError);
    expect(() => resolveBackupsDir(['--backup', '--apply'], {})).toThrow(BackupArgError);
  });
});
