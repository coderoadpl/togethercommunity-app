import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { expectedRequiredChecks, loadManifest, MANIFEST_PATH_FROM_REPO_ROOT } from './dispatch-ci.js';
import {
  compareRulesetBranches,
  deriveCheckProducersFromWorkflowSources,
  hasRulesetDrift,
  hasUnknownRequiredChecks,
  readWorkflowSources,
  RULESET_BRANCHES,
  type ProducedCheck,
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
  ruleset_id: z.number().int().optional(),
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

export interface DeletionProtection {
  branch: RulesetBranch;
  protected: boolean;
  detail: string;
}

export interface RulesetDriftReport {
  gate: string;
  expected: RequiredChecksByBranch;
  required: RequiredChecksByBranch;
  produced: RequiredChecksByBranch;
  comparison: RulesetComparisonByBranch;
  deletionProtection: DeletionProtection[];
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

export const collectLiveBranchRules = async (
  client: GitHubRulesClient,
  repo: RepoSlug,
  branches: readonly RulesetBranch[],
): Promise<Map<RulesetBranch, unknown>> => {
  const rules = new Map<RulesetBranch, unknown>();
  try {
    for (const branch of branches) rules.set(branch, await client.getBranchRules(repo, branch));
  } catch (cause) {
    throw new RulesetReadError(cause);
  }
  return rules;
};

const rulesetIds = (ids: readonly number[]): string =>
  ids.map((id) => String(id)).join(', ');

export const evaluateDeletionProtection = (
  branch: RulesetBranch,
  payload: unknown,
): DeletionProtection => {
  const rules = branchRulesSchema.parse(payload);
  const gateRulesets = new Set(rules
    .filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) => rule.ruleset_id === undefined ? [] : [rule.ruleset_id]));
  const deletionRulesets = rules
    .filter((rule) => rule.type === 'deletion')
    .map((rule) => rule.ruleset_id);
  const separate = [...new Set(deletionRulesets.filter((id): id is number =>
    id !== undefined && !gateRulesets.has(id)))];
  if (separate.length > 0) {
    return { branch, protected: true, detail: `deletion is restricted by ruleset ${rulesetIds(separate)}` };
  }
  if (deletionRulesets.length === 0) {
    return { branch, protected: false, detail: 'no ruleset restricts deletion' };
  }
  return {
    branch,
    protected: false,
    detail: 'the only deletion restriction comes from the ruleset that also requires status checks, so disabling that ruleset would make the branch deletable',
  };
};

export const createRulesetDriftReport = async (
  client: GitHubRulesClient,
  repo: RepoSlug,
  repoRoot: string,
): Promise<RulesetDriftReport> => {
  const manifest = loadManifest(join(repoRoot, MANIFEST_PATH_FROM_REPO_ROOT));
  const expected = expectedRequiredChecks(manifest);
  const producers = deriveCheckProducersFromWorkflowSources(readWorkflowSources(repoRoot), manifest);
  const names = (found: readonly ProducedCheck[]): string[] => [...new Set(found.map((producer) => producer.name))];
  const live = await collectLiveBranchRules(client, repo, RULESET_BRANCHES);
  const required = {
    staging: extractRequiredStatusChecks(live.get('staging')),
    main: extractRequiredStatusChecks(live.get('main')),
  };
  return {
    gate: manifest.gate,
    expected,
    required,
    produced: { staging: names(producers.staging), main: names(producers.main) },
    comparison: compareRulesetBranches(expected, required, producers, manifest),
    deletionProtection: manifest.deletionProtectedBranches.map((branch) =>
      evaluateDeletionProtection(branch, live.get(branch))),
  };
};

const list = (names: readonly string[]): string => names.length === 0
  ? 'none'
  : names.map((name) => `\`${name}\``).join(', ');

const unprotectedBranches = (report: RulesetDriftReport): DeletionProtection[] =>
  report.deletionProtection.filter((entry) => !entry.protected);

export const hasReportDrift = (report: RulesetDriftReport): boolean =>
  hasRulesetDrift(report.comparison) || unprotectedBranches(report).length > 0;

const gatePending = (report: RulesetDriftReport, branch: RulesetBranch): boolean =>
  report.comparison[branch].expectedMissing.includes(report.gate);

const ungatedInstruction =
  'required by the ruleset but neither gated nor listed in the manifest: add it to separateRequiredChecks or remove it from the ruleset';

const legacyInstruction = (report: RulesetDriftReport, branch: RulesetBranch): string =>
  gatePending(report, branch)
    ? `legacy, now covered by the gate; keep until ${report.gate} is required on this branch, then remove`
    : 'remove from the ruleset (legacy, now covered by the gate)';

const branchSection = (branch: RulesetBranch, report: RulesetDriftReport): string => {
  const comparison = report.comparison[branch];
  const legacy = gatePending(report, branch)
    ? `Legacy checks in the \`${branch}\` ruleset's required status checks (still reported, now covered by the gate); keep until \`${report.gate}\` is required on this branch, then remove: ${list(comparison.requiredLegacy)}`
    : `Remove from the \`${branch}\` ruleset's required status checks (legacy: still reported, now covered by the gate): ${list(comparison.requiredLegacy)}`;
  return [
    `## ${branch}`,
    '',
    `Add to the \`${branch}\` ruleset's required status checks (expected, not required yet): ${list(comparison.expectedMissing)}`,
    '',
    legacy,
    '',
    `Required by the \`${branch}\` ruleset but neither gated nor listed in the manifest (add it to \`separateRequiredChecks\` or remove it from the ruleset): ${list(comparison.requiredUngated)}`,
    '',
    `Remove from the \`${branch}\` ruleset's required status checks now (no workflow reports them, so every pull request waits forever): ${list(comparison.requiredUnknown)}`,
  ].join('\n');
};

const deletionSection = (report: RulesetDriftReport): string => [
  '## Branch deletion protection',
  '',
  ...report.deletionProtection.map((entry) => entry.protected
    ? `- \`${entry.branch}\`: protected (${entry.detail}).`
    : `- \`${entry.branch}\`: add a separate ruleset that targets \`${entry.branch}\` with "Restrict deletions" turned on; ${entry.detail}.`),
].join('\n');

const headline = (report: RulesetDriftReport): string => {
  if (hasUnknownRequiredChecks(report.comparison)) {
    return 'Ruleset drift: a required status check that no workflow reports blocks every pull request.';
  }
  return hasReportDrift(report)
    ? 'Ruleset drift: the live rulesets differ from the manifest; follow the add and remove lists below.'
    : 'Ruleset drift is clean.';
};

export const formatIssueBody = (report: RulesetDriftReport): string => [
  issueMarker,
  '',
  headline(report),
  '',
  `Expected required checks come from \`${MANIFEST_PATH_FROM_REPO_ROOT}\` (the gate plus the separate checks of each branch) and are pinned in \`app/config-regression/rulesets-required-checks.snapshot.json\`.`,
  '',
  ...RULESET_BRANCHES.flatMap((branch) => [branchSection(branch, report), '']),
  deletionSection(report),
  '',
].join('\n');

export const hasBlockingRulesetDrift = (
  report: RulesetDriftReport,
  mode: RulesetDriftMode,
): boolean => mode === 'scheduled'
  ? hasReportDrift(report)
  : hasUnknownRequiredChecks(report.comparison);

export const formatCliReport = (
  report: RulesetDriftReport,
  mode: RulesetDriftMode = 'scheduled',
): string => {
  const lines = [
    `rulesets-drift: compared live branch rulesets with the dispatch-ci manifest in ${mode} mode`,
  ];
  for (const branch of RULESET_BRANCHES) {
    const comparison = report.comparison[branch];
    if (comparison.expectedMissing.length > 0) {
      lines.push(`${branch}: add to the ruleset (expected, not required yet): ${comparison.expectedMissing.join(', ')}`);
    }
    if (comparison.requiredLegacy.length > 0) {
      lines.push(`${branch}: ${legacyInstruction(report, branch)}: ${comparison.requiredLegacy.join(', ')}`);
    }
    if (comparison.requiredUngated.length > 0) {
      lines.push(`${branch}: ${ungatedInstruction}: ${comparison.requiredUngated.join(', ')}`);
    }
    if (comparison.requiredUnknown.length > 0) {
      lines.push(`${branch}: ruleset requires status checks no workflow produces; remove them now: ${comparison.requiredUnknown.join(', ')}`);
    }
  }
  for (const entry of unprotectedBranches(report)) {
    lines.push(`${entry.branch}: branch deletion protection missing; add a separate ruleset with "Restrict deletions" (${entry.detail})`);
  }
  if (!hasReportDrift(report)) lines.push('rulesets-drift: clean');
  else if (!hasBlockingRulesetDrift(report, mode)) {
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
  if (hasReportDrift(report)) {
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

export interface DriftAnnotation {
  level: 'error' | 'warning';
  title: string;
  message: string;
}

const capitalized = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export const driftAnnotations = (report: RulesetDriftReport, mode: RulesetDriftMode): DriftAnnotation[] => {
  const advisoryLevel = mode === 'pull-request' ? 'warning' : 'error';
  const annotations: DriftAnnotation[] = [];
  for (const branch of RULESET_BRANCHES) {
    const { expectedMissing, requiredLegacy, requiredUngated, requiredUnknown } = report.comparison[branch];
    const title = `Ruleset drift ${branch}`;
    if (expectedMissing.length > 0) {
      annotations.push({ level: advisoryLevel, title, message: `Add to the ruleset: ${expectedMissing.join(', ')}` });
    }
    if (requiredLegacy.length > 0) {
      annotations.push({
        level: advisoryLevel,
        title,
        message: `${capitalized(legacyInstruction(report, branch))}: ${requiredLegacy.join(', ')}`,
      });
    }
    if (requiredUngated.length > 0) {
      annotations.push({
        level: advisoryLevel,
        title,
        message: `${capitalized(ungatedInstruction)}: ${requiredUngated.join(', ')}`,
      });
    }
    if (requiredUnknown.length > 0) {
      annotations.push({
        level: 'error',
        title,
        message: `Ruleset requires status checks no workflow produces: ${requiredUnknown.join(', ')}`,
      });
    }
  }
  for (const entry of unprotectedBranches(report)) {
    annotations.push({ level: advisoryLevel, title: 'Branch deletion protection', message: `${entry.branch}: ${entry.detail}` });
  }
  return annotations;
};

const emitAnnotation = (level: 'error' | 'warning', title: string, message: string): void => {
  process.stderr.write(`::${level} title=${annotationValue(title)}::${annotationValue(message)}\n`);
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
  for (const entry of driftAnnotations(report, mode)) emitAnnotation(entry.level, entry.title, entry.message);

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

  if (hasBlockingRulesetDrift(report, mode)) process.exitCode = 1;
};

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  run(process.env, process.argv.slice(2)).catch((cause: unknown) => {
    process.stderr.write(`rulesets-drift failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
}
