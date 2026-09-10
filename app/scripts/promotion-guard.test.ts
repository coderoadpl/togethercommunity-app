import { describe, expect, it } from 'vitest';

import {
  collectIncludedPullRequests,
  countChangedAreas,
  evaluatePromotionSource,
  evaluateStagingFreeze,
  evaluateWorkflowRuns,
  renderPromotionComment,
  workflowReasons,
} from './promotion-guard.js';

describe('promotion guard', () => {
  it('accepts a PR opened from the current staging tip', () => {
    expect(evaluatePromotionSource({
      headRef: 'staging',
      headSha: 'abc123',
      stagingTip: 'abc123',
    })).toEqual([]);
  });

  it('rejects promote branches because promotions come from staging itself', () => {
    expect(evaluatePromotionSource({
      headRef: 'promote-2026-09-10',
      headSha: 'abc123',
      stagingTip: 'abc123',
    })).toEqual([
      {
        check: 'promotion source',
        message: 'promotions are pull requests from the staging branch itself',
      },
    ]);
  });

  it('rejects a stale staging PR head after staging moves', () => {
    expect(evaluatePromotionSource({
      headRef: 'staging',
      headSha: 'abc123',
      stagingTip: 'def456',
    })).toEqual([
      {
        check: 'staging tip',
        message: 'staging moved on; wait for the freeze and re-run',
      },
    ]);
  });

  it('requires the explicit staging freeze variable', () => {
    expect(evaluateStagingFreeze('true')).toEqual([]);
    expect(evaluateStagingFreeze('false')).toEqual([
      {
        check: 'staging freeze',
        message: 'freeze staging first (STAGING_FREEZE=true) so auto-merge cannot move the tip during the promotion',
      },
    ]);
  });

  it('requires successful ci and staging smoke runs for the staging branch head', () => {
    const evidence = evaluateWorkflowRuns([
      {
        workflow: 'ci.yml',
        conclusion: 'success',
        url: 'https://github.com/example/repo/actions/runs/1',
      },
      {
        workflow: 'staging-smoke.yml',
        conclusion: 'failure',
        url: 'https://github.com/example/repo/actions/runs/2',
      },
    ]);

    expect(evidence).toEqual([
      {
        workflow: 'ci.yml',
        passed: true,
        url: 'https://github.com/example/repo/actions/runs/1',
        conclusion: 'success',
      },
      {
        workflow: 'staging-smoke.yml',
        passed: false,
        url: 'https://github.com/example/repo/actions/runs/2',
        conclusion: 'failure',
      },
    ]);
    expect(workflowReasons(evidence)).toEqual([
      {
        check: 'staging-smoke.yml',
        message: 'No successful staging branch run found for staging-smoke.yml at the PR head SHA.',
      },
    ]);
  });

  it('counts changed files in the promotion areas', () => {
    expect(countChangedAreas([
      'app/core/domain/user.ts',
      'app/core/server/user.ts',
      'app/apps/web/src/page.tsx',
      'app/docs/staging.md',
      '.github/workflows/promotion-guard.yml',
      'README.md',
    ])).toEqual([
      { area: 'app/core', count: 2 },
      { area: 'app/adapters', count: 0 },
      { area: 'app/apps/server', count: 0 },
      { area: 'app/apps/web', count: 1 },
      { area: 'app/apps/cli', count: 0 },
      { area: 'app/drizzle', count: 0 },
      { area: '.github', count: 1 },
      { area: 'docs', count: 1 },
    ]);
  });

  it('keeps unresolved pull request references as bare numbers', () => {
    expect(collectIncludedPullRequests([42, 999999], (number) => {
      if (number === 999999) throw new Error('Could not resolve to a PullRequest');
      return {
        number,
        title: 'Add member export',
        url: 'https://github.com/example/repo/pull/42',
      };
    })).toEqual([
      {
        number: 42,
        title: 'Add member export',
        url: 'https://github.com/example/repo/pull/42',
      },
      {
        number: 999999,
        title: null,
        url: null,
      },
    ]);
  });

  it('renders the single upserted PR comment with verdict, inventory, and run links', () => {
    expect(renderPromotionComment({
      passed: false,
      reasons: [
        {
          check: 'promotion source',
          message: 'promotions are pull requests from the staging branch itself',
        },
      ],
      includedPullRequests: [
        {
          number: 42,
          title: 'Add member export',
          url: 'https://github.com/example/repo/pull/42',
        },
        {
          number: 999999,
          title: null,
          url: null,
        },
      ],
      migrations: ['app/drizzle/0001_example.sql'],
      areas: [
        { area: 'app/core', count: 2 },
        { area: '.github', count: 1 },
      ],
      workflows: [
        {
          workflow: 'ci.yml',
          passed: true,
          url: 'https://github.com/example/repo/actions/runs/1',
          conclusion: 'success',
        },
        {
          workflow: 'staging-smoke.yml',
          passed: false,
          url: 'https://github.com/example/repo/actions/runs/2',
          conclusion: 'failure',
        },
      ],
    })).toBe([
      '<!-- promotion-guard -->',
      '**Verdict:** FAIL: promotions are pull requests from the staging branch itself',
      '',
      '**Included PRs**',
      '- [#42: Add member export](https://github.com/example/repo/pull/42)',
      '- #999999',
      '',
      '**Migrations Added**',
      '- `app/drizzle/0001_example.sql`',
      '',
      '**Changed Areas**',
      '| Area | Files |',
      '| --- | ---: |',
      '| `app/core` | 2 |',
      '| `.github` | 1 |',
      '',
      '**Staging Runs**',
      '- `ci.yml`: [successful staging run](https://github.com/example/repo/actions/runs/1)',
      '- `staging-smoke.yml`: missing successful staging run ([latest failure run](https://github.com/example/repo/actions/runs/2))',
    ].join('\n'));
  });
});
