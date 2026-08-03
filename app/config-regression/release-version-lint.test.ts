import { describe, expect, it } from 'vitest';

import { collectReleaseVersionProblems } from '../scripts/release-version-lint.js';

const required = ['app/docs/version.md'];

const lint = (content: string, version = '0.1.0') =>
  collectReleaseVersionProblems(new Map([[required[0] ?? '', content]]), version, required);

describe('release-version lint', () => {
  it('accepts bare and v-prefixed current versions inside guarded regions', () => {
    const result = lint(
      '<!--release-version-->`0.1.0` and `v0.1.0`<!--/release-version-->',
    );

    expect(result).toEqual({ problems: [], claimsSeen: 2 });
  });

  it('rejects stale bare and v-prefixed guarded claims', () => {
    const result = lint(
      '<!--release-version-->`v0.2.0` and `0.3.0`<!--/release-version-->',
    );

    expect(result.problems).toEqual([
      expect.stringContaining('claims v0.2.0'),
      expect.stringContaining('claims 0.3.0'),
    ]);
  });

  it('does not read a four-part number as a SemVer claim', () => {
    const result = lint('<!--release-version-->`1.2.3.4`<!--/release-version-->');

    expect(result).toEqual({
      problems: [expect.stringContaining('contains no strict SemVer claim')],
      claimsSeen: 0,
    });
  });

  it('rejects claims outside guarded regions on required surfaces', () => {
    const result = lint(
      '<!--release-version-->`0.1.0`<!--/release-version--> repeats `0.1.0` and `v0.2.0`',
    );

    expect(result.problems).toEqual([
      expect.stringContaining('claim 0.1.0 must be inside a release-version region'),
      expect.stringContaining('claim v0.2.0 must be inside a release-version region'),
    ]);
  });

  it('rejects empty and missing required regions', () => {
    expect(lint('<!--release-version-->no version<!--/release-version-->').problems).toEqual([
      expect.stringContaining('contains no strict SemVer claim'),
    ]);
    expect(lint('no version').problems).toEqual([
      expect.stringContaining('must carry a release-version region'),
    ]);
  });

  it('rejects untracked required surfaces and invalid manifest versions', () => {
    const result = collectReleaseVersionProblems(new Map(), 'v0.1.0', required);

    expect(result.problems).toEqual([
      expect.stringContaining('package.json version "v0.1.0" is not strict SemVer'),
      expect.stringContaining('is not tracked markdown'),
    ]);
  });
});
