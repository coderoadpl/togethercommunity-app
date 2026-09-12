import { describe, expect, it } from 'vitest';

import {
  collectRequiredRulesetChecks,
  extractRequiredStatusChecks,
  formatCliReport,
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

const report = (missing: readonly string[], unknown: readonly string[] = ['legacy']): RulesetDriftReport => ({
  expected: {
    staging: ['check', 'smoke'],
    main: ['check'],
  },
  required: {
    staging: ['check', 'legacy'],
    main: ['check'],
  },
  comparison: {
    staging: {
      expectedMissing: [...missing],
      requiredUnknown: [...unknown],
    },
    main: {
      expectedMissing: [],
      requiredUnknown: [],
    },
  },
});

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

  it('prints exact missing names and unknown names by mode', () => {
    expect(formatCliReport(report(['smoke'], []), 'scheduled')).toContain(
      'staging: add missing required status checks: smoke',
    );
    expect(formatCliReport(report(['smoke'], []), 'pull-request')).toContain(
      'staging: workflow-produced status checks not required yet: smoke',
    );
    expect(formatCliReport(report([]), 'pull-request')).toContain(
      'staging: ruleset requires status checks no pull-request workflow produces: legacy',
    );
  });

  it('calls itself clean only when nothing at all drifted', () => {
    expect(formatCliReport(report([], []))).toContain('rulesets-drift: clean');
    expect(formatCliReport(report([]))).not.toContain('rulesets-drift: clean');
    expect(formatCliReport(report([]))).toContain(
      'drift found; scheduled mode fails until the live rulesets match',
    );
  });

  it('blocks by mode and drift direction', () => {
    expect(hasBlockingRulesetDrift(report(['smoke'], []).comparison, 'pull-request')).toBe(false);
    expect(hasBlockingRulesetDrift(report(['smoke'], []).comparison, 'scheduled')).toBe(true);
    expect(hasBlockingRulesetDrift(report([], ['legacy']).comparison, 'pull-request')).toBe(true);
    expect(hasBlockingRulesetDrift(report([], ['legacy']).comparison, 'scheduled')).toBe(true);
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

    expect(await syncRulesetDriftIssue(client, repo, report([], ['legacy'])))
      .toEqual({ action: 'created', number: 1, duplicatesClosed: [] });

    expect(client.issues[0]?.body).toContain(
      'No required check is missing; the unknown required checks below still need a decision.',
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
    await expect(collectRequiredRulesetChecks(new UnreachableRulesClient(), repo))
      .rejects.toThrow('could not read rulesets from api.github.com');

    try {
      await collectRequiredRulesetChecks(new UnreachableRulesClient(), repo);
      throw new Error('expected ruleset read to fail');
    } catch (cause) {
      expect(isPullRequestRulesetReadWarning(cause)).toBe(true);
    }
  });
});
