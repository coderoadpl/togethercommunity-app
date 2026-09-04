import { describe, expect, it } from 'vitest';

import { parseMergeRecord, renderChangelog } from './changelog.js';
import { FIELD_SEPARATOR } from './merge-history.js';

const record = (subject: string, body: string): string =>
  `${subject}${FIELD_SEPARATOR}${body}`;

describe('changelog', () => {
  it('reads the pull request number from the subject and the title from the body', () => {
    expect(
      parseMergeRecord(
        record('Merge pull request #101 from coderoadpl/run-domains', '\nfeat: custom domains\n'),
      ),
    ).toEqual({ prefix: 'feat', title: 'custom domains', pullRequest: 101 });
  });

  it('groups an unprefixed title as other and keeps it whole', () => {
    expect(
      parseMergeRecord(record('Merge pull request #7 from coderoadpl/run-x', 'tidy the seed')),
    ).toEqual({ prefix: 'other', title: 'tidy the seed', pullRequest: 7 });
  });

  it('ignores merges that are not pull requests', () => {
    expect(parseMergeRecord(record("Merge branch 'staging' into run-x", ''))).toBeNull();
  });

  it('renders one section per prefix in a fixed order', () => {
    const entries = [
      { prefix: 'ci', title: 'pin the runner', pullRequest: 3 },
      { prefix: 'feat', title: 'coupons', pullRequest: 1 },
      { prefix: 'fix', title: 'logo clipping', pullRequest: 2 },
    ];

    expect(renderChangelog('0.13.0', entries)).toBe(
      [
        '# v0.13.0',
        '',
        '## Features',
        '',
        '- coupons (#1)',
        '',
        '## Fixes',
        '',
        '- logo clipping (#2)',
        '',
        '## CI',
        '',
        '- pin the runner (#3)',
        '',
      ].join('\n'),
    );
  });

  it('states plainly when a range carries no pull request', () => {
    expect(renderChangelog('0.13.0', [])).toBe(
      '# v0.13.0\n\nNo pull request merges in this range.\n',
    );
  });
});
