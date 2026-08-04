import { describe, expect, it } from 'vitest';

import { BackupArgError, resolveBackupsDir } from './legacy-export-args.js';

describe('resolveBackupsDir', () => {
  it('prefers an explicit --backup argument', () => {
    expect(resolveBackupsDir(['--backup', '/data/dumps'], {})).toBe('/data/dumps');
    expect(
      resolveBackupsDir(['--backup', '/data/dumps'], { TOGETHER_LEGACY_BACKUPS_DIR: '/env' }),
    ).toBe('/data/dumps');
  });

  it('falls back to the TOGETHER_LEGACY_BACKUPS_DIR env var', () => {
    expect(resolveBackupsDir([], { TOGETHER_LEGACY_BACKUPS_DIR: '/env/dumps' })).toBe('/env/dumps');
  });

  it('rejects a missing backups directory', () => {
    expect(() => resolveBackupsDir([], {})).toThrow(BackupArgError);
    expect(() => resolveBackupsDir([], { TOGETHER_LEGACY_BACKUPS_DIR: '' })).toThrow(
      BackupArgError,
    );
  });

  it('rejects --backup without a directory value', () => {
    expect(() => resolveBackupsDir(['--backup'], {})).toThrow(BackupArgError);
    expect(() => resolveBackupsDir(['--backup', '--apply'], {})).toThrow(BackupArgError);
  });
});
