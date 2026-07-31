import { describe, expect, it } from 'vitest';

import pkg from '../../../../package.json' with { type: 'json' };

import {
  BUILD_SHA,
  BUILD_VERSION,
  buildStampText,
  hasKnownShaMismatch,
  isBuildMismatch,
  shortSha,
} from '../lib/build-info.js';

describe('build info', () => {
  it('exposes the manifest version and injected commit identity', () => {
    expect(BUILD_VERSION).toBe(pkg.version);
    expect(BUILD_SHA).toBe('unknown');
    expect(buildStampText()).toBe(`v${pkg.version}`);
  });

  it('shortens commit SHAs and preserves unknown', () => {
    expect(shortSha('abcdef123456')).toBe('abcdef1');
    expect(shortSha('unknown')).toBe('unknown');
  });

  it('detects version and known commit mismatches', () => {
    expect(isBuildMismatch({ version: '999.0.0', sha: 'unknown' })).toBe(true);
    expect(isBuildMismatch({
      version: BUILD_VERSION,
      sha: '1234567890abcdef1234567890abcdef12345678',
    })).toBe(false);
    expect(isBuildMismatch({ version: BUILD_VERSION, sha: BUILD_SHA })).toBe(false);
  });

  it('compares only known browser and server commit identities', () => {
    const serverSha = 'abcdef1234567890abcdef1234567890abcdef12';

    expect(isBuildMismatch({ version: BUILD_VERSION, sha: serverSha })).toBe(false);
    expect(hasKnownShaMismatch('unknown', 'abcdef1')).toBe(false);
    expect(hasKnownShaMismatch(serverSha, 'unknown')).toBe(false);
    expect(hasKnownShaMismatch(serverSha, 'abcdef1')).toBe(false);
    expect(hasKnownShaMismatch(serverSha, '1234567')).toBe(true);
  });
});
