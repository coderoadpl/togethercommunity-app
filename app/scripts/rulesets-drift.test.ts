import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectLiveBranchRules,
  createRulesetDriftReport,
  evaluateDeletionProtection,
  extractRequiredStatusChecks,
  formatCliReport,
  formatIssueBody,
  hasBlockingRulesetDrift,
  isPullRequestRulesetReadWarning,
  parseRepoSlug,
  parseRulesetDriftMode,
  syncRulesetDriftIssue,
  type GitHubRulesClient,
  type GitHubIssueClient,
  type RepoSlug,
  type RulesetDriftReport,
} from './rulesets-drift.js';

const repo: RepoSlug = { owner: 'owner', repo: 'repo' };

interface FakeIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body: string;
  labels: string[];
  pull_request?: unknown;
}

const report = (
  missing: readonly string[],
  unknown: readonly string[] = ['vanished'],
  legacy: readonly string[] = [],
  deletionProtected = true,
): RulesetDriftReport => ({
  expected: {
    staging: ['dispatch-ci', 'smoke'],
    main: ['dispatch-ci'],
  },
  required: {
    staging: ['dispatch-ci', 'vanished'],
    main: ['dispatch-ci'],
  },
  produced: {
    staging: ['dispatch-ci', 'smoke', 'check'],
    main: ['dispatch-ci', 'check'],
  },
  comparison: {
    staging: {
      expectedMissing: [...missing],
      requiredLegacy: [...legacy],
      requiredUnknown: [...unknown],
    },
    main: {
      expectedMissing: [],
      requiredLegacy: [],
      requiredUnknown: [],
    },
  },
  deletionProtection: [
    { branch: 'staging', protected: deletionProtected, detail: deletionProtected ? 'deletion is restricted by ruleset 7' : 'no ruleset restricts deletion' },
    { branch: 'main', protected: true, detail: 'deletion is restricted by ruleset 8' },
  ],
});

const liveRules = (checks: readonly string[], deletionRulesetId: number) => [
  { type: 'deletion', ruleset_id: deletionRulesetId },
  { type: 'non_fast_forward', ruleset_id: 1 },
  {
    type: 'required_status_checks',
    ruleset_id: 1,
    parameters: { required_status_checks: checks.map((context) => ({ context, integration_id: 15368 })) },
  },
];

const perJobChecks = [
  'check',
  'visual',
  'smoke',
  ...['auth', 'team-admins', 'poc', 'subs', 'marketing', 'coupon', 'public-authz', 'member-activity',
    'member-shell', 'impersonation', 'two-factor', 'image-assets', 'custom-domain', 'meta-capi']
    .map((suite) => `e2e (${suite})`),
];

class LiveRulesClient implements GitHubRulesClient {
  constructor(private readonly rules: Record<'staging' | 'main', unknown>) {}

  async getBranchRules(_repo: RepoSlug, branch: 'staging' | 'main'): Promise<unknown> {
    return this.rules[branch];
  }
}

class FakeIssueClient implements GitHubIssueClient {
  issues: FakeIssue[] = [];

  creates = 0;

  updates = 0;

  async listOpenDriftIssues(): Promise<FakeIssue[]> {
    return this.issues.filter((issue) =>
      issue.state === 'open' && issue.labels.includes('ruleset-drift'));
  }

  async createIssue(
    _repo: RepoSlug,
    input: { title: string; body: string; labels: string[] },
  ): Promise<FakeIssue> {
    this.creates += 1;
    const issue: FakeIssue = {
      number: this.issues.length + 1,
      title: input.title,
      state: 'open',
      body: input.body,
      labels: [...input.labels],
    };
    this.issues.push(issue);
    return issue;
  }

  async updateIssue(
    _repo: RepoSlug,
    number: number,
    input: { body?: string; state?: 'open' | 'closed' },
  ): Promise<void> {
    this.updates += 1;
    this.issues = this.issues.map((issue) => issue.number === number
      ? { ...issue, body: input.body ?? issue.body, state: input.state ?? issue.state }
      : issue);
  }
}

class UnreachableRulesClient implements GitHubRulesClient {
  async getBranchRules(): Promise<unknown> {
    throw new TypeError('fetch failed');
  }
}

describe('rulesets drift', () => {
  it('extracts required status check contexts from GitHub branch rules', () => {
    expect(extractRequiredStatusChecks([
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [
            { context: 'smoke', integration_id: 1 },
            { context: 'check', integration_id: 1 },
            { context: 'smoke', integration_id: 1 },
          ],
        },
      },
      { type: 'pull_request' },
    ])).toEqual(['check', 'smoke']);
  });

  it('prints what to add and what to remove for each list', () => {
    const output = formatCliReport(report(['smoke'], ['vanished'], ['check']), 'scheduled');

    expect(output).toContain('staging: add to the ruleset (expected, not required yet): smoke');
    expect(output).toContain('staging: remove from the ruleset (legacy, now covered by the gate): check');
    expect(output).toContain('staging: ruleset requires status checks no workflow produces; remove them now: vanished');
  });

  it('prints a missing deletion protection', () => {
    expect(formatCliReport(report([], [], [], false))).toContain(
      'staging: branch deletion protection missing; add a separate ruleset with "Restrict deletions" (no ruleset restricts deletion)',
    );
  });

  it('calls itself clean only when nothing at all drifted', () => {
    expect(formatCliReport(report([], []))).toContain('rulesets-drift: clean');
    expect(formatCliReport(report([]))).not.toContain('rulesets-drift: clean');
    expect(formatCliReport(report([], [], ['check']))).not.toContain('rulesets-drift: clean');
    expect(formatCliReport(report([], [], [], false))).not.toContain('rulesets-drift: clean');
    expect(formatCliReport(report([]))).toContain(
      'drift found; scheduled mode fails until the live rulesets match',
    );
    expect(formatCliReport(report(['smoke'], [], ['check']), 'pull-request')).toContain(
      'drift found, but pull-request mode reports it as warnings',
    );
  });

  it.each([
    ['an expected check is not required', report(['smoke'], []), false, true],
    ['a legacy check is still required', report([], [], ['check']), false, true],
    ['an unknown check is required', report([], ['vanished']), true, true],
    ['deletion protection is missing', report([], [], [], false), false, true],
    ['nothing drifted', report([], []), false, false],
  ])('blocks by mode when %s', (_label, drift, pullRequest, scheduled) => {
    expect(hasBlockingRulesetDrift(drift, 'pull-request')).toBe(pullRequest);
    expect(hasBlockingRulesetDrift(drift, 'scheduled')).toBe(scheduled);
  });

  it('requires a deletion rule from a ruleset other than the one that requires checks', () => {
    expect(evaluateDeletionProtection('main', liveRules(['dispatch-ci'], 1))).toEqual({
      branch: 'main',
      protected: false,
      detail: 'the only deletion restriction comes from the ruleset that also requires status checks, so disabling that ruleset would make the branch deletable',
    });
    expect(evaluateDeletionProtection('main', [...liveRules(['dispatch-ci'], 1), { type: 'deletion', ruleset_id: 2 }]))
      .toEqual({ branch: 'main', protected: true, detail: 'deletion is restricted by ruleset 2' });
    expect(evaluateDeletionProtection('staging', liveRules(['dispatch-ci'], 3)).protected).toBe(true);
    expect(evaluateDeletionProtection('staging', [{ type: 'deletion' }]).protected).toBe(false);
    expect(evaluateDeletionProtection('staging', []).detail).toBe('no ruleset restricts deletion');
  });

  it('passes the pull-request gate against the per-job rulesets of the transition', async () => {
    const repoRoot = join(import.meta.dirname, '..', '..');
    const client = new LiveRulesClient({
      staging: liveRules(['ai-review', ...perJobChecks, 'staging-freeze'], 1),
      main: liveRules(['ai-review', ...perJobChecks, 'promotion-guard'], 1),
    });
    const transition = await createRulesetDriftReport(client, repo, repoRoot);

    expect(transition.comparison.staging).toEqual({
      expectedMissing: ['dispatch-ci'],
      requiredLegacy: [...perJobChecks].sort(),
      requiredUnknown: [],
    });
    expect(transition.comparison.main.requiredUnknown).toEqual([]);
    expect(transition.deletionProtection.map((entry) => entry.protected)).toEqual([false, false]);
    expect(hasBlockingRulesetDrift(transition, 'pull-request')).toBe(false);
    expect(hasBlockingRulesetDrift(transition, 'scheduled')).toBe(true);
  });

  it('is clean once the rulesets list the manifest checks and deletion sits in its own ruleset', async () => {
    const repoRoot = join(import.meta.dirname, '..', '..');
    const client = new LiveRulesClient({
      staging: liveRules(['dispatch-ci', 'ai-review', 'staging-freeze'], 2),
      main: liveRules(['dispatch-ci', 'ai-review', 'promotion-guard'], 2),
    });
    const target = await createRulesetDriftReport(client, repo, repoRoot);

    expect(hasBlockingRulesetDrift(target, 'scheduled')).toBe(false);
    expect(formatCliReport(target)).toContain('rulesets-drift: clean');
  });

  it('writes the add and remove lists and the deletion section into the issue body', () => {
    const body = formatIssueBody(report(['smoke'], [], ['check'], false));

    expect(body).toContain("Add to the `staging` ruleset's required status checks (expected, not required yet): `smoke`");
    expect(body).toContain("Remove from the `staging` ruleset's required status checks (legacy: still reported, now covered by the gate): `check`");
    expect(body).toContain('## Branch deletion protection');
    expect(body).toContain('- `staging`: add a separate ruleset that targets `staging` with "Restrict deletions" turned on; no ruleset restricts deletion.');
    expect(body).toContain('- `main`: protected (deletion is restricted by ruleset 8).');
  });

  it('parses the mode flag and environment fallback', () => {
    expect(parseRulesetDriftMode({}, ['--mode=pull-request'])).toBe('pull-request');
    expect(parseRulesetDriftMode({ RULESETS_DRIFT_MODE: 'pull-request' }, [])).toBe('pull-request');
    expect(parseRulesetDriftMode({}, [])).toBe('scheduled');
    expect(() => parseRulesetDriftMode({}, ['--mode=preview'])).toThrow('pull-request or scheduled');
  });

  it('parses repository slugs from the GitHub environment', () => {
    expect(parseRepoSlug('owner/repo')).toEqual(repo);
    expect(() => parseRepoSlug('owner')).toThrow('owner/repo');
  });

  it('opens one labelled drift issue and leaves the second identical sync unchanged', async () => {
    const client = new FakeIssueClient();

    expect(await syncRulesetDriftIssue(client, repo, report(['smoke'])))
      .toEqual({ action: 'created', number: 1, duplicatesClosed: [] });
    expect(await syncRulesetDriftIssue(client, repo, report(['smoke'])))
      .toEqual({ action: 'unchanged', number: 1, duplicatesClosed: [] });

    expect(client.creates).toBe(1);
    expect(client.updates).toBe(0);
    expect(client.issues).toHaveLength(1);
    expect(client.issues[0]?.title).toBe('Ruleset drift');
    expect(client.issues[0]?.labels).toEqual(['ruleset-drift']);
  });

  it('updates and closes the drift issue when the rulesets are clean', async () => {
    const client = new FakeIssueClient();
    await syncRulesetDriftIssue(client, repo, report(['smoke']));

    expect(await syncRulesetDriftIssue(client, repo, report([], [])))
      .toEqual({ action: 'closed', number: 1, duplicatesClosed: [] });

    expect(client.creates).toBe(1);
    expect(client.updates).toBe(1);
    expect(client.issues[0]?.state).toBe('closed');
  });

  it('reconciles the newest open issue and closes the older duplicates', async () => {
    const client = new FakeIssueClient();
    client.issues = [
      { number: 4, title: 'Ruleset drift', state: 'open', body: 'stale', labels: ['ruleset-drift'] },
      { number: 9, title: 'Ruleset drift', state: 'open', body: 'stale', labels: ['ruleset-drift'] },
    ];

    expect(await syncRulesetDriftIssue(client, repo, report(['smoke'])))
      .toEqual({ action: 'updated', number: 9, duplicatesClosed: [4] });

    expect(client.creates).toBe(0);
    expect(client.issues.find((issue) => issue.number === 4)?.state).toBe('closed');
    expect(client.issues.find((issue) => issue.number === 9)?.state).toBe('open');
  });

  it('opens the drift issue for unknown required checks in scheduled mode', async () => {
    const client = new FakeIssueClient();

    expect(await syncRulesetDriftIssue(client, repo, report([], ['vanished'])))
      .toEqual({ action: 'created', number: 1, duplicatesClosed: [] });

    expect(client.issues[0]?.body).toContain(
      'Ruleset drift: a required status check that no workflow reports blocks every pull request.',
    );
  });

  it.each([
    ['legacy checks', report([], [], ['check'])],
    ['a missing deletion protection', report([], [], [], false)],
  ])('keeps the drift issue open for %s', async (_label, drift) => {
    const client = new FakeIssueClient();

    expect(await syncRulesetDriftIssue(client, repo, drift))
      .toEqual({ action: 'created', number: 1, duplicatesClosed: [] });
    expect(client.issues[0]?.body).toContain(
      'Ruleset drift: the live rulesets differ from the manifest; follow the add and remove lists below.',
    );
  });

  it('ignores pull requests that carry the drift label', async () => {
    const client = new FakeIssueClient();
    client.issues = [
      { number: 2, title: 'Ruleset drift', state: 'open', body: 'stale', labels: ['ruleset-drift'] },
      {
        number: 7,
        title: 'Ruleset drift',
        state: 'open',
        body: 'pr',
        labels: ['ruleset-drift'],
        pull_request: {},
      },
    ];

    expect(await syncRulesetDriftIssue(client, repo, report(['smoke'])))
      .toEqual({ action: 'updated', number: 2, duplicatesClosed: [] });
  });

  it('wraps transient ruleset reads for pull-request warning mode', async () => {
    await expect(collectLiveBranchRules(new UnreachableRulesClient(), repo, ['staging', 'main']))
      .rejects.toThrow('could not read rulesets from api.github.com');

    try {
      await collectLiveBranchRules(new UnreachableRulesClient(), repo, ['staging', 'main']);
      throw new Error('expected ruleset read to fail');
    } catch (cause) {
      expect(isPullRequestRulesetReadWarning(cause)).toBe(true);
    }
  });
});
