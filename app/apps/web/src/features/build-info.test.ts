import { describe, expect, it } from 'vitest';

import pkg from '../../../../package.json' with { type: 'json' };

import {
  BUILD_SHA,
  BUILD_VERSION,
  buildStampText,
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
    expect(isBuildMismatch({ version: BUILD_VERSION, sha: 'different' })).toBe(false);
    expect(isBuildMismatch({ version: BUILD_VERSION, sha: BUILD_SHA })).toBe(false);
  });
});
