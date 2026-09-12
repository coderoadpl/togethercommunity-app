import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  compareRulesetBranches,
  deriveRequiredChecksFromWorkflows,
  hasMissingRequiredChecks,
  hasRulesetDrift,
  RULESET_BRANCHES,
  type RequiredChecksByBranch,
  type RulesetBranch,
  type RulesetComparisonByBranch,
} from './rulesets-required-checks.js';

const issueTitle = 'Ruleset drift';
const issueLabel = 'ruleset-drift';
const issueMarker = '<!-- rulesets-drift -->';
const requestAttempts = 3;
const rulesetDriftModes = ['pull-request', 'scheduled'] as const;

const branchRulesSchema = z.array(z.object({
  type: z.string(),
  parameters: z.object({
    required_status_checks: z.array(z.object({
      context: z.string(),
    }).passthrough()).optional(),
  }).passthrough().optional(),
}).passthrough());

const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  body: z.string().nullable().optional(),
  pull_request: z.unknown().optional(),
});

const issuesSchema = z.array(issueSchema);

type GitHubIssue = z.output<typeof issueSchema>;
type IssueState = GitHubIssue['state'];
export type RulesetDriftMode = typeof rulesetDriftModes[number];

export interface RepoSlug {
  owner: string;
  repo: string;
}

export interface GitHubRulesClient {
  getBranchRules(repo: RepoSlug, branch: RulesetBranch): Promise<unknown>;
}

export interface GitHubIssueClient {
  listOpenDriftIssues(repo: RepoSlug): Promise<GitHubIssue[]>;
  createIssue(
    repo: RepoSlug,
    input: { title: string; body: string; labels: string[] },
  ): Promise<GitHubIssue>;
  updateIssue(
    repo: RepoSlug,
    number: number,
    input: { body?: string; state?: IssueState },
  ): Promise<void>;
}

export interface RulesetDriftReport {
  expected: RequiredChecksByBranch;
  required: RequiredChecksByBranch;
  comparison: RulesetComparisonByBranch;
}

export interface IssueSyncResult {
  action: 'created' | 'updated' | 'closed' | 'unchanged';
  number: number | null;
  duplicatesClosed: number[];
}

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

class GitHubApiRequestError extends Error {
  constructor(
    method: string,
    path: string,
    readonly status: number,
  ) {
    super(`GitHub API ${method} ${path} returned HTTP ${String(status)}`);
  }
}

export class RulesetReadError extends Error {
  constructor(readonly originalCause: unknown) {
    super(
      `could not read rulesets from api.github.com: ${
        originalCause instanceof Error ? originalCause.message : String(originalCause)
      }`,
    );
  }
}

class GitHubApi implements GitHubRulesClient, GitHubIssueClient {
  constructor(private readonly token: string) {}

  async getBranchRules(repo: RepoSlug, branch: RulesetBranch): Promise<unknown> {
    return await this.requestJson(`/repos/${repo.owner}/${repo.repo}/rules/branches/${branch}`, {
      method: 'GET',
    });
  }

  async listOpenDriftIssues(repo: RepoSlug): Promise<GitHubIssue[]> {
    const payload = await this.requestJson(
      `/repos/${repo.owner}/${repo.repo}/issues?state=open&labels=${issueLabel}&per_page=100`,
      { method: 'GET' },
    );
    return issuesSchema.parse(payload);
  }

  async createIssue(
    repo: RepoSlug,
    input: { title: string; body: string; labels: string[] },
  ): Promise<GitHubIssue> {
    const payload = await this.requestJson(`/repos/${repo.owner}/${repo.repo}/issues`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return issueSchema.parse(payload);
  }

  async updateIssue(
    repo: RepoSlug,
    number: number,
    input: { body?: string; state?: IssueState },
  ): Promise<void> {
    await this.requestJson(`/repos/${repo.owner}/${repo.repo}/issues/${String(number)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  private async requestJson(path: string, init: { method: string; body?: string }): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      const retryable = attempt < requestAttempts;
      try {
        const response = await fetch(`https://api.github.com${path}`, {
          ...init,
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
            'user-agent': 'rulesets-drift',
            'x-github-api-version': '2022-11-28',
          },
        });
        if (!response.ok) {
          if (retryable && isRetryableStatus(response.status)) {
            await delay(attempt * 2000);
            continue;
          }
          throw new GitHubApiRequestError(init.method, path, response.status);
        }
        if (response.status === 204) return null;
        return await response.json();
      } catch (cause) {
        if (retryable && cause instanceof TypeError) {
          await delay(attempt * 2000);
          continue;
        }
        throw cause;
      }
    }
  }
}

export const parseRepoSlug = (value: string | undefined): RepoSlug => {
  const parts = (value ?? '').split('/');
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';
  if (owner === '' || repo === '' || parts.length !== 2) {
    throw new Error('GITHUB_REPOSITORY must be in owner/repo form');
  }
  return { owner, repo };
};

export const extractRequiredStatusChecks = (payload: unknown): string[] => {
  const rules = branchRulesSchema.parse(payload);
  const contexts = rules.flatMap((rule) =>
    rule.type === 'required_status_checks'
      ? rule.parameters?.required_status_checks?.map((check) => check.context) ?? []
      : [],
  );
  return [...new Set(contexts)].sort();
};

export const collectRequiredRulesetChecks = async (
  client: GitHubRulesClient,
  repo: RepoSlug,
): Promise<RequiredChecksByBranch> => {
  try {
    return {
      staging: extractRequiredStatusChecks(await client.getBranchRules(repo, 'staging')),
      main: extractRequiredStatusChecks(await client.getBranchRules(repo, 'main')),
    };
  } catch (cause) {
    throw new RulesetReadError(cause);
  }
};

export const createRulesetDriftReport = async (
  client: GitHubRulesClient,
  repo: RepoSlug,
  repoRoot: string,
): Promise<RulesetDriftReport> => {
  const expected = deriveRequiredChecksFromWorkflows(repoRoot);
  const required = await collectRequiredRulesetChecks(client, repo);
  return {
    expected,
    required,
    comparison: compareRulesetBranches(expected, required),
  };
};

const list = (names: readonly string[]): string => names.length === 0
  ? 'none'
  : names.map((name) => `\`${name}\``).join(', ');

const branchSection = (branch: RulesetBranch, report: RulesetDriftReport): string => [
  `## ${branch}`,
  '',
  `Missing required checks: ${list(report.comparison[branch].expectedMissing)}`,
  '',
  `Unknown required checks: ${list(report.comparison[branch].requiredUnknown)}`,
].join('\n');

const headline = (report: RulesetDriftReport): string => {
  if (hasMissingRequiredChecks(report.comparison)) {
    return 'Ruleset drift is blocking CI protection parity.';
  }
  return hasRulesetDrift(report.comparison)
    ? 'No required check is missing; the unknown required checks below still need a decision.'
    : 'Ruleset drift is clean.';
};

export const formatIssueBody = (report: RulesetDriftReport): string => [
  issueMarker,
  '',
  headline(report),
  '',
  'Expected checks are derived from workflow files and pinned in `app/config-regression/rulesets-required-checks.snapshot.json`.',
  '',
  ...RULESET_BRANCHES.map((branch) => branchSection(branch, report)),
  '',
].join('\n');

const hasUnknownRequiredChecks = (comparison: RulesetComparisonByBranch): boolean =>
  RULESET_BRANCHES.some((branch) => comparison[branch].requiredUnknown.length > 0);

export const hasBlockingRulesetDrift = (
  comparison: RulesetComparisonByBranch,
  mode: RulesetDriftMode,
): boolean => mode === 'scheduled'
  ? hasRulesetDrift(comparison)
  : hasUnknownRequiredChecks(comparison);

export const formatCliReport = (
  report: RulesetDriftReport,
  mode: RulesetDriftMode = 'scheduled',
): string => {
  const lines = [
    `rulesets-drift: compared live branch rulesets with workflow-derived required checks in ${mode} mode`,
  ];
  for (const branch of RULESET_BRANCHES) {
    const comparison = report.comparison[branch];
    if (comparison.expectedMissing.length > 0) {
      lines.push(mode === 'pull-request'
        ? `${branch}: workflow-produced status checks not required yet: ${comparison.expectedMissing.join(', ')}`
        : `${branch}: add missing required status checks: ${comparison.expectedMissing.join(', ')}`);
    }
    if (comparison.requiredUnknown.length > 0) {
      lines.push(`${branch}: ruleset requires status checks no pull-request workflow produces: ${comparison.requiredUnknown.join(', ')}`);
    }
  }
  if (!hasRulesetDrift(report.comparison)) lines.push('rulesets-drift: clean');
  else if (!hasBlockingRulesetDrift(report.comparison, mode)) {
    lines.push('rulesets-drift: drift found, but pull-request mode reports it as warnings');
  } else if (mode === 'scheduled') {
    lines.push('rulesets-drift: drift found; scheduled mode fails until the live rulesets match');
  }
  return `${lines.join('\n')}\n`;
};

const newestFirst = (issues: readonly GitHubIssue[]): GitHubIssue[] =>
  issues
    .filter((issue) => issue.pull_request === undefined)
    .toSorted((left, right) => right.number - left.number);

export const syncRulesetDriftIssue = async (
  client: GitHubIssueClient,
  repo: RepoSlug,
  report: RulesetDriftReport,
): Promise<IssueSyncResult> => {
  const [current, ...duplicates] = newestFirst(await client.listOpenDriftIssues(repo));
  for (const duplicate of duplicates) {
    await client.updateIssue(repo, duplicate.number, { state: 'closed' });
  }
  const duplicatesClosed = duplicates.map((duplicate) => duplicate.number);
  const body = formatIssueBody(report);
  if (hasRulesetDrift(report.comparison)) {
    if (current === undefined) {
      const created = await client.createIssue(repo, {
        title: issueTitle,
        body,
        labels: [issueLabel],
      });
      return { action: 'created', number: created.number, duplicatesClosed };
    }
    if (current.body === body) {
      return { action: 'unchanged', number: current.number, duplicatesClosed };
    }
    await client.updateIssue(repo, current.number, { body, state: 'open' });
    return { action: 'updated', number: current.number, duplicatesClosed };
  }
  if (current !== undefined) {
    await client.updateIssue(repo, current.number, { body, state: 'closed' });
    return { action: 'closed', number: current.number, duplicatesClosed };
  }
  return { action: 'unchanged', number: null, duplicatesClosed };
};

const annotationValue = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const emitAnnotation = (level: 'error' | 'warning', title: string, message: string): void => {
  process.stderr.write(`::${level} title=${annotationValue(title)}::${annotationValue(message)}\n`);
};

const emitDriftAnnotations = (
  comparison: RulesetComparisonByBranch,
  mode: RulesetDriftMode,
): void => {
  for (const branch of RULESET_BRANCHES) {
    const missing = comparison[branch].expectedMissing;
    if (missing.length > 0) {
      emitAnnotation(
        mode === 'pull-request' ? 'warning' : 'error',
        `Ruleset drift ${branch}`,
        mode === 'pull-request'
          ? `Workflow-produced status checks are not required yet: ${missing.join(', ')}`
          : `Missing required status checks: ${missing.join(', ')}`,
      );
    }
    const unknown = comparison[branch].requiredUnknown;
    if (unknown.length > 0) {
      emitAnnotation(
        'error',
        `Ruleset drift ${branch}`,
        `Ruleset requires status checks no pull-request workflow produces: ${unknown.join(', ')}`,
      );
    }
  }
};

export const parseRulesetDriftMode = (
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): RulesetDriftMode => {
  const arg = argv.find((value) => value.startsWith('--mode='));
  const raw = arg?.slice('--mode='.length) ?? env['RULESETS_DRIFT_MODE'] ?? 'scheduled';
  const parsed = z.enum(rulesetDriftModes).safeParse(raw);
  if (!parsed.success) throw new Error('rulesets-drift mode must be pull-request or scheduled');
  return parsed.data;
};

export const isPullRequestRulesetReadWarning = (cause: unknown): boolean => {
  if (!(cause instanceof RulesetReadError)) return false;
  if (cause.originalCause instanceof TypeError) return true;
  return cause.originalCause instanceof GitHubApiRequestError
    && isRetryableStatus(cause.originalCause.status);
};

const run = async (env: NodeJS.ProcessEnv, argv: readonly string[]): Promise<void> => {
  const token = env['GITHUB_TOKEN'];
  if (token === undefined || token === '') throw new Error('GITHUB_TOKEN is required');
  const mode = parseRulesetDriftMode(env, argv);
  const repo = parseRepoSlug(env['GITHUB_REPOSITORY'] ?? env['REPO']);
  const appRoot = join(import.meta.dirname, '..');
  const repoRoot = join(appRoot, '..');
  const client = new GitHubApi(token);
  let report: RulesetDriftReport;
  try {
    report = await createRulesetDriftReport(client, repo, repoRoot);
  } catch (cause) {
    if (mode === 'pull-request' && isPullRequestRulesetReadWarning(cause)) {
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stdout.write(`rulesets-drift: ${message}; skipping pull-request drift gate\n`);
      emitAnnotation('warning', 'Ruleset drift', `${message}; skipping pull-request drift gate`);
      return;
    }
    throw cause;
  }
  const output = formatCliReport(report, mode);
  process.stdout.write(output);
  emitDriftAnnotations(report.comparison, mode);

  const summaryPath = env['GITHUB_STEP_SUMMARY'];
  if (summaryPath !== undefined && summaryPath !== '') {
    appendFileSync(summaryPath, formatIssueBody(report));
  }

  if (argv.includes('--update-issue')) {
    const sync = await syncRulesetDriftIssue(client, repo, report);
    process.stdout.write(`rulesets-drift: issue ${sync.action}${sync.number === null ? '' : ` #${String(sync.number)}`}\n`);
    for (const duplicate of sync.duplicatesClosed) {
      process.stdout.write(`rulesets-drift: closed duplicate issue #${String(duplicate)}\n`);
    }
  }

  if (hasBlockingRulesetDrift(report.comparison, mode)) process.exitCode = 1;
};

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  run(process.env, process.argv.slice(2)).catch((cause: unknown) => {
    process.stderr.write(`rulesets-drift failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
}
