import { describe, expect, it, vi } from 'vitest';

import {
  awaitWorkflowRuns,
  collectIncludedPullRequests,
  countChangedAreas,
  defaultWaitPolicy,
  describeWait,
  evaluatePromotionSource,
  evaluateStagingFreeze,
  evaluateWorkflowRuns,
  renderPromotionComment,
  workflowReasons,
  type WorkflowRun,
} from './promotion-guard.js';

const run = (
  workflow: WorkflowRun['workflow'],
  status: string,
  conclusion: string | null,
  id: number,
  event = 'push',
): WorkflowRun => ({
  workflow,
  event,
  status,
  conclusion,
  url: `https://github.com/example/repo/actions/runs/${String(id)}`,
});

const ciSuccess = run('ci.yml', 'completed', 'success', 1);
const smokeSuccess = run('staging-smoke.yml', 'completed', 'success', 2);

const waitHarness = (reads: WorkflowRun[][]) => {
  let clock = 0;
  let index = 0;
  const read = vi.fn(() => {
    const runs = reads[Math.min(index, reads.length - 1)] ?? [];
    index += 1;
    return runs;
  });
  const sleep = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
  const deps = { read, now: () => clock, sleep, log: vi.fn() };
  return { deps, read, sleep };
};

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
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        url: 'https://github.com/example/repo/actions/runs/1',
      },
      {
        workflow: 'staging-smoke.yml',
        event: 'push',
        status: 'completed',
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

describe('promotion guard waiting for the staging runs', () => {
  it('evaluates at once when every required workflow already has a completed run', async () => {
    const { deps, read, sleep } = waitHarness([[ciSuccess, run('staging-smoke.yml', 'completed', 'failure', 2)]]);

    const wait = await awaitWorkflowRuns(deps);
    const evidence = evaluateWorkflowRuns(wait.runs);

    expect(read).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(wait.waitedMs).toBe(0);
    expect(describeWait(wait)).toBeNull();
    expect(workflowReasons(evidence, wait)).toEqual([{
      check: 'staging-smoke.yml',
      message: 'No successful staging branch run found for staging-smoke.yml at the PR head SHA.',
    }]);
  });

  it('waits for a still-running run that then succeeds', async () => {
    const { deps, read, sleep } = waitHarness([
      [ciSuccess, run('staging-smoke.yml', 'in_progress', null, 2)],
      [ciSuccess, run('staging-smoke.yml', 'queued', null, 2)],
      [ciSuccess, smokeSuccess],
    ]);

    const wait = await awaitWorkflowRuns(deps);

    expect(read).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[30_000], [30_000]]);
    expect(wait).toMatchObject({ waitedMs: 60_000, unfinished: [] });
    expect(workflowReasons(evaluateWorkflowRuns(wait.runs), wait)).toEqual([]);
    expect(describeWait(wait)).toBe('Waited 1 min for the staging runs of the head SHA to finish.');
  });

  it('waits for a still-running run that then fails, and says how long it waited', async () => {
    const { deps } = waitHarness([
      [run('ci.yml', 'in_progress', null, 1), smokeSuccess],
      [run('ci.yml', 'completed', 'failure', 1), smokeSuccess],
    ]);

    const wait = await awaitWorkflowRuns(deps);

    expect(wait.waitedMs).toBe(30_000);
    expect(workflowReasons(evaluateWorkflowRuns(wait.runs), wait)).toEqual([{
      check: 'ci.yml',
      message: 'No successful staging branch run found for ci.yml at the PR head SHA after waiting 30 s.',
    }]);
  });

  it('never waits on a completed failing run', async () => {
    const { deps, sleep } = waitHarness([[run('ci.yml', 'completed', 'failure', 1), smokeSuccess]]);

    expect((await awaitWorkflowRuns(deps)).waitedMs).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits only the grace period for a workflow without any run', async () => {
    const { deps, read } = waitHarness([[ciSuccess]]);

    const wait = await awaitWorkflowRuns(deps);

    expect(wait.waitedMs).toBe(defaultWaitPolicy.graceMs);
    expect(read).toHaveBeenCalledTimes(defaultWaitPolicy.graceMs / defaultWaitPolicy.pollMs + 1);
    expect(wait.unfinished).toEqual([{ workflow: 'staging-smoke.yml', state: 'missing' }]);
    expect(describeWait(wait)).toBe('Stopped waiting after 3 min: no staging-smoke.yml run created.');
    expect(workflowReasons(evaluateWorkflowRuns(wait.runs), wait)).toEqual([{
      check: 'staging-smoke.yml',
      message: 'No successful staging branch run found for staging-smoke.yml at the PR head SHA after waiting 3 min; no run was created.',
    }]);
  });

  it('picks up a run created within the grace period and waits for it', async () => {
    const { deps } = waitHarness([
      [ciSuccess],
      [ciSuccess, run('staging-smoke.yml', 'queued', null, 2)],
      [ciSuccess, smokeSuccess],
    ]);

    const wait = await awaitWorkflowRuns(deps);

    expect(wait).toMatchObject({ waitedMs: 60_000, unfinished: [] });
  });

  it('stops at the bound while a run is still in progress and then evaluates as before', async () => {
    const { deps, read } = waitHarness([[ciSuccess, run('staging-smoke.yml', 'in_progress', null, 2)]]);

    const wait = await awaitWorkflowRuns(deps);

    expect(wait.waitedMs).toBe(defaultWaitPolicy.boundMs);
    expect(read).toHaveBeenCalledTimes(defaultWaitPolicy.boundMs / defaultWaitPolicy.pollMs + 1);
    expect(describeWait(wait)).toBe('Stopped waiting after 40 min: staging-smoke.yml still running.');
    expect(workflowReasons(evaluateWorkflowRuns(wait.runs), wait)).toEqual([{
      check: 'staging-smoke.yml',
      message: 'No successful staging branch run found for staging-smoke.yml at the PR head SHA after waiting 40 min; its run is still in progress.',
    }]);
  });

  it('keeps an earlier success even while a later run of the same workflow is still running', async () => {
    const { deps, sleep } = waitHarness([[ciSuccess, run('staging-smoke.yml', 'in_progress', null, 3), smokeSuccess]]);

    expect((await awaitWorkflowRuns(deps)).waitedMs).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('ignores the promotion pull request run of ci.yml when the push run already failed', async () => {
    const pushFailure = run('ci.yml', 'completed', 'failure', 1);
    const { deps, sleep } = waitHarness([[pushFailure, run('ci.yml', 'in_progress', null, 3, 'pull_request'), smokeSuccess]]);

    const wait = await awaitWorkflowRuns(deps);

    expect(sleep).not.toHaveBeenCalled();
    expect(wait.waitedMs).toBe(0);
    expect(evaluateWorkflowRuns(wait.runs)).toEqual([
      { workflow: 'ci.yml', passed: false, url: pushFailure.url, conclusion: 'failure' },
      { workflow: 'staging-smoke.yml', passed: true, url: smokeSuccess.url, conclusion: 'success' },
    ]);
    expect(workflowReasons(evaluateWorkflowRuns(wait.runs), wait)).toEqual([{
      check: 'ci.yml',
      message: 'No successful staging branch run found for ci.yml at the PR head SHA.',
    }]);
  });

  it.each(['pull_request', 'pull_request_target'])('never takes a successful %s run as staging evidence', (event) => {
    const pushFailure = run('ci.yml', 'completed', 'failure', 1);

    expect(evaluateWorkflowRuns([run('ci.yml', 'completed', 'success', 3, event), pushFailure, smokeSuccess])[0]).toEqual({
      workflow: 'ci.yml',
      passed: false,
      url: pushFailure.url,
      conclusion: 'failure',
    });
  });

  it('does not wait for a pull request run when no staging run exists beyond the grace period', async () => {
    const { deps } = waitHarness([[run('ci.yml', 'in_progress', null, 3, 'pull_request'), smokeSuccess]]);

    const wait = await awaitWorkflowRuns(deps);

    expect(wait.waitedMs).toBe(defaultWaitPolicy.graceMs);
    expect(wait.unfinished).toEqual([{ workflow: 'ci.yml', state: 'missing' }]);
  });

  it.each(['push', 'schedule', 'workflow_dispatch'])('counts a successful %s run as before', async (event) => {
    const { deps } = waitHarness([[run('ci.yml', 'completed', 'success', 1, event), smokeSuccess]]);

    const wait = await awaitWorkflowRuns(deps);

    expect(wait.waitedMs).toBe(0);
    expect(workflowReasons(evaluateWorkflowRuns(wait.runs), wait)).toEqual([]);
  });

  it('says in the comment how long it waited', () => {
    const comment = renderPromotionComment({
      passed: true,
      reasons: [],
      includedPullRequests: [],
      migrations: [],
      areas: [],
      workflows: evaluateWorkflowRuns([ciSuccess, smokeSuccess]),
      wait: { runs: [ciSuccess, smokeSuccess], waitedMs: 270_000, unfinished: [] },
    });

    expect(comment.split('\n').slice(-1)).toEqual(['Waited 4 min 30 s for the staging runs of the head SHA to finish.']);
  });

  it('renders an unfinished latest run as unfinished', () => {
    const comment = renderPromotionComment({
      passed: false,
      reasons: [],
      includedPullRequests: [],
      migrations: [],
      areas: [],
      workflows: evaluateWorkflowRuns([ciSuccess, run('staging-smoke.yml', 'in_progress', null, 2)]),
    });

    expect(comment).toContain('- `staging-smoke.yml`: missing successful staging run ([latest unfinished run](https://github.com/example/repo/actions/runs/2))');
  });
});
