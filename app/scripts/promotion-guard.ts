import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { z } from 'zod';

const marker = '<!-- promotion-guard -->';
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(appRoot);

export type GuardReason = {
  check: string;
  message: string;
};

export type PromotionSourceInputs = {
  headRef: string;
  headSha: string;
  stagingTip: string;
};

export type RequiredWorkflow = 'ci.yml' | 'staging-smoke.yml';

export type WorkflowRun = {
  workflow: RequiredWorkflow;
  conclusion: string | null;
  url: string;
};

export type WorkflowEvidence = {
  workflow: RequiredWorkflow;
  passed: boolean;
  url: string | null;
  conclusion: string | null;
};

export type IncludedPullRequest = {
  number: number;
  title: string | null;
  url: string | null;
};

export type AreaCount = {
  area: string;
  count: number;
};

export type RenderInput = {
  passed: boolean;
  reasons: GuardReason[];
  includedPullRequests: IncludedPullRequest[];
  migrations: string[];
  areas: AreaCount[];
  workflows: WorkflowEvidence[];
};

type RuntimeEnv = {
  GITHUB_TOKEN: string;
  PR_NUMBER: string;
  HEAD_SHA: string;
  HEAD_REF: string;
  REPO: string;
  STAGING_FREEZE: string | undefined;
};

const runtimeEnvSchema = z.object({
  GITHUB_TOKEN: z.string().min(1),
  PR_NUMBER: z.string().regex(/^[1-9][0-9]*$/),
  HEAD_SHA: z.string().min(7),
  HEAD_REF: z.string().min(1),
  REPO: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  STAGING_FREEZE: z.string().optional(),
});

const workflowRunResponseSchema = z.object({
  workflow_runs: z.array(z.object({
    conclusion: z.string().nullable(),
    html_url: z.string().url(),
  })),
});

const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string().url(),
});

const issueCommentsSchema = z.array(z.object({
  id: z.number(),
  body: z.string().nullable(),
}));
const paginatedIssueCommentsSchema = z.array(issueCommentsSchema);

const requiredWorkflows: RequiredWorkflow[] = ['ci.yml', 'staging-smoke.yml'];

const trackedAreas = [
  'app/core',
  'app/adapters',
  'app/apps/server',
  'app/apps/web',
  'app/apps/cli',
  'app/drizzle',
  '.github',
  'docs',
] as const;

export function evaluatePromotionSource(inputs: PromotionSourceInputs): GuardReason[] {
  if (inputs.headRef !== 'staging') {
    return [{
      check: 'promotion source',
      message: 'promotions are pull requests from the staging branch itself',
    }];
  }

  if (inputs.headSha !== inputs.stagingTip) {
    return [{
      check: 'staging tip',
      message: 'staging moved on; wait for the freeze and re-run',
    }];
  }

  return [];
}

export function evaluateStagingFreeze(value: string | undefined): GuardReason[] {
  return value === 'true'
    ? []
    : [{
      check: 'staging freeze',
      message: 'freeze staging first (STAGING_FREEZE=true) so auto-merge cannot move the tip during the promotion',
    }];
}

export function evaluateWorkflowRuns(runs: WorkflowRun[]): WorkflowEvidence[] {
  return requiredWorkflows.map((workflow) => {
    const workflowRuns = runs.filter((run) => run.workflow === workflow);
    const successful = workflowRuns.find((run) => run.conclusion === 'success');
    const reported = successful ?? workflowRuns[0];

    return {
      workflow,
      passed: successful !== undefined,
      url: reported?.url ?? null,
      conclusion: reported?.conclusion ?? null,
    };
  });
}

export function workflowReasons(evidence: WorkflowEvidence[]): GuardReason[] {
  return evidence
    .filter((run) => !run.passed)
    .map((run) => ({
      check: run.workflow,
      message: `No successful staging branch run found for ${run.workflow} at the PR head SHA.`,
    }));
}

export function parseMergedPullNumbers(logText: string): number[] {
  const numbers: number[] = [];
  const seen = new Set<number>();

  for (const match of logText.matchAll(/#([1-9][0-9]*)\b/g)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const number = Number(raw);
    if (seen.has(number)) continue;
    seen.add(number);
    numbers.push(number);
  }

  return numbers;
}

export function collectIncludedPullRequests(
  numbers: number[],
  lookup: (number: number) => IncludedPullRequest | null,
): IncludedPullRequest[] {
  return numbers.map((number) => {
    try {
      return lookup(number) ?? bareIncludedPullRequest(number);
    } catch {
      return bareIncludedPullRequest(number);
    }
  });
}

export function countChangedAreas(files: string[]): AreaCount[] {
  return trackedAreas.map((area) => ({
    area,
    count: files.filter((file) => fileBelongsToArea(file, area)).length,
  }));
}

export function renderPromotionComment(input: RenderInput): string {
  const verdict = input.passed
    ? 'PASS'
    : `FAIL: ${input.reasons.map((reason) => reason.message).join(' ')}`;

  return [
    marker,
    `**Verdict:** ${verdict}`,
    '',
    '**Included PRs**',
    renderPullRequests(input.includedPullRequests),
    '',
    '**Migrations Added**',
    renderList(input.migrations),
    '',
    '**Changed Areas**',
    '| Area | Files |',
    '| --- | ---: |',
    ...input.areas.map((area) => `| \`${area.area}\` | ${area.count} |`),
    '',
    '**Staging Runs**',
    ...input.workflows.map(renderWorkflowRun),
  ].join('\n');
}

function main(): void {
  const env = parseRuntimeEnv(process.env);

  fetchBranchRefs();

  const stagingTip = git(['rev-parse', 'origin/staging']).trim();
  const workflowEvidence = evaluateWorkflowRuns(readWorkflowRuns(env));
  const ancestryReasons = evaluatePromotionSource({
    headRef: env.HEAD_REF,
    headSha: env.HEAD_SHA,
    stagingTip,
  });
  const freezeReasons = evaluateStagingFreeze(env.STAGING_FREEZE);
  const runReasons = workflowReasons(workflowEvidence);
  const reasons = [...ancestryReasons, ...freezeReasons, ...runReasons];
  const includedPullRequests = readIncludedPullRequests(env);
  const migrations = lines(git([
    'diff',
    '--name-only',
    '--diff-filter=A',
    `origin/main...${env.HEAD_SHA}`,
    '--',
    'app/drizzle',
  ]));
  const areas = countChangedAreas(lines(git([
    'diff',
    '--name-only',
    `origin/main...${env.HEAD_SHA}`,
  ])));
  const comment = renderPromotionComment({
    passed: reasons.length === 0,
    reasons,
    includedPullRequests,
    migrations,
    areas,
    workflows: workflowEvidence,
  });

  upsertComment(env, comment);

  if (reasons.length > 0) {
    console.error(`promotion-guard failed: ${reasons.map((reason) => reason.message).join(' ')}`);
    process.exitCode = 1;
    return;
  }

  console.log('promotion-guard passed');
}

function fileBelongsToArea(file: string, area: string): boolean {
  if (area === 'docs') return file.startsWith('docs/') || file.startsWith('app/docs/');
  return file === area || file.startsWith(`${area}/`);
}

function renderPullRequests(pulls: IncludedPullRequest[]): string {
  if (pulls.length === 0) return '- None';
  return pulls.map((pull) => {
    if (pull.title === null || pull.url === null) return `- #${pull.number}`;
    return `- [#${pull.number}: ${pull.title}](${pull.url})`;
  }).join('\n');
}

function renderList(items: string[]): string {
  if (items.length === 0) return '- None';
  return items.map((item) => `- \`${item}\``).join('\n');
}

function renderWorkflowRun(run: WorkflowEvidence): string {
  if (run.url === null) return `- \`${run.workflow}\`: missing successful staging run`;
  if (run.passed) return `- \`${run.workflow}\`: [successful staging run](${run.url})`;
  return `- \`${run.workflow}\`: missing successful staging run ([latest ${run.conclusion ?? 'unknown'} run](${run.url}))`;
}

function parseRuntimeEnv(env: NodeJS.ProcessEnv): RuntimeEnv {
  const parsed = runtimeEnvSchema.parse({
    GITHUB_TOKEN: env['GITHUB_TOKEN'],
    PR_NUMBER: env['PR_NUMBER'] ?? env['PROMOTION_GUARD_PR_NUMBER'],
    HEAD_SHA: env['HEAD_SHA'] ?? env['PROMOTION_GUARD_HEAD_SHA'],
    HEAD_REF: env['HEAD_REF'] ?? env['PROMOTION_GUARD_HEAD_REF'],
    REPO: env['REPO'] ?? env['PROMOTION_GUARD_REPO'] ?? env['GITHUB_REPOSITORY'],
    STAGING_FREEZE: env['STAGING_FREEZE'],
  });

  return {
    GITHUB_TOKEN: parsed.GITHUB_TOKEN,
    PR_NUMBER: parsed.PR_NUMBER,
    HEAD_SHA: parsed.HEAD_SHA,
    HEAD_REF: parsed.HEAD_REF,
    REPO: parsed.REPO,
    STAGING_FREEZE: parsed.STAGING_FREEZE,
  };
}

function fetchBranchRefs(): void {
  git([
    'fetch',
    '--no-tags',
    'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/staging:refs/remotes/origin/staging',
  ]);
}

function readWorkflowRuns(env: RuntimeEnv): WorkflowRun[] {
  return requiredWorkflows.flatMap((workflow) => {
    const response = ghJson(env, [
      'api',
      '--method',
      'GET',
      `/repos/${env.REPO}/actions/workflows/${workflow}/runs`,
      '--field',
      'branch=staging',
      '--field',
      `head_sha=${env.HEAD_SHA}`,
      '--field',
      'per_page=100',
    ]);
    const parsed = workflowRunResponseSchema.parse(response);

    return parsed.workflow_runs.map((run) => ({
      workflow,
      conclusion: run.conclusion,
      url: run.html_url,
    }));
  });
}

function readIncludedPullRequests(env: RuntimeEnv): IncludedPullRequest[] {
  const logText = git(['log', '--merges', '--reverse', '--format=%B', `origin/main..${env.HEAD_SHA}`]);
  const numbers = parseMergedPullNumbers(logText);

  return collectIncludedPullRequests(numbers, (number) => {
    const response = ghJson(env, [
      'pr',
      'view',
      String(number),
      '--repo',
      env.REPO,
      '--json',
      'number,title,url',
    ]);

    return pullRequestSchema.parse(response);
  });
}

function upsertComment(env: RuntimeEnv, body: string): void {
  const commentsResponse = ghJson(env, [
    'api',
    '--paginate',
    '--slurp',
    '--method',
    'GET',
    `/repos/${env.REPO}/issues/${env.PR_NUMBER}/comments`,
    '--field',
    'per_page=100',
  ]);
  const comments = paginatedIssueCommentsSchema.parse(commentsResponse).flat();
  const existing = comments.find((comment) => comment.body?.includes(marker) ?? false);

  if (existing === undefined) {
    gh(env, [
      'api',
      '--method',
      'POST',
      `/repos/${env.REPO}/issues/${env.PR_NUMBER}/comments`,
      '--raw-field',
      `body=${body}`,
    ]);
    return;
  }

  gh(env, [
    'api',
    '--method',
    'PATCH',
    `/repos/${env.REPO}/issues/comments/${existing.id}`,
    '--raw-field',
    `body=${body}`,
  ]);
}

function ghJson(env: RuntimeEnv, args: string[]): unknown {
  return JSON.parse(gh(env, args));
}

function gh(env: RuntimeEnv, args: string[]): string {
  return execFileSync('gh', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_TOKEN: env.GITHUB_TOKEN,
      GITHUB_TOKEN: env.GITHUB_TOKEN,
    },
  });
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
}

function lines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

function bareIncludedPullRequest(number: number): IncludedPullRequest {
  return {
    number,
    title: null,
    url: null,
  };
}

const mainModuleUrl = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;
if (mainModuleUrl === import.meta.url) {
  main();
}
