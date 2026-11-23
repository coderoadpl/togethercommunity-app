import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DISPATCH_EVENTS = ['pull_request', 'push'] as const;
export const DISPATCH_BRANCHES = ['staging', 'main'] as const;
export const POST_DEPLOY_ENVIRONMENTS = ['staging', 'production'] as const;
const JOB_MODES = ['required', 'advisory'] as const;
const JOB_RESULTS = ['success', 'failure', 'cancelled', 'skipped'] as const;

export type DispatchEvent = typeof DISPATCH_EVENTS[number];
export type DispatchBranch = typeof DISPATCH_BRANCHES[number];
type PostDeployEnvironment = typeof POST_DEPLOY_ENVIRONMENTS[number];
type JobMode = typeof JOB_MODES[number];
type JobResult = typeof JOB_RESULTS[number];
type Env = Readonly<Record<string, string | undefined>>;

export interface MatrixEntry {
  suite: string;
  browser: boolean;
}

export interface ManifestJob {
  id: string;
  mode: JobMode;
  runOn: { events: DispatchEvent[]; branches: DispatchBranch[] };
  matrix: MatrixEntry[] | null;
}

export interface SeparateRequiredCheck {
  name: string;
  reason: string;
}

export interface DispatchManifest {
  gate: string;
  workflow: string;
  planJob: string;
  jobs: ManifestJob[];
  afterGate: string[];
  separateRequiredChecks: Record<DispatchBranch, SeparateRequiredCheck[]>;
  postDeploy: Record<PostDeployEnvironment, string[]>;
  deletionProtectedBranches: DispatchBranch[];
}

export interface EventContext {
  event: DispatchEvent;
  branch: DispatchBranch;
}

export interface PlannedJob {
  id: string;
  run: boolean;
  required: boolean;
  matrix: MatrixEntry[] | null;
}

export interface DispatchPlan {
  version: 1;
  gate: string;
  event: DispatchEvent;
  branch: DispatchBranch;
  jobs: PlannedJob[];
}

export const DEFAULT_MANIFEST_PATH = join(import.meta.dirname, '..', 'ci', 'dispatch-ci.manifest.json');
export const MANIFEST_PATH_FROM_REPO_ROOT = 'app/ci/dispatch-ci.manifest.json';

const jobIdPattern = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const suitePattern = /^[a-z0-9][a-z0-9-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const quoteAll = (values: readonly string[]): string => values.map((value) => `"${value}"`).join(', ');

const manifestError = (field: string, problem: string): Error =>
  new Error(`dispatch-ci manifest: ${field} ${problem}`);

const expectRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) throw manifestError(field, 'must be an object');
  return value;
};

const expectKeys = (
  record: Record<string, unknown>,
  field: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const path = (key: string): string => field === '' ? key : `${field}.${key}`;
  for (const key of required) {
    if (!Object.hasOwn(record, key)) throw manifestError(path(key), 'is missing');
  }
  for (const key of Object.keys(record)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw manifestError(path(key), 'is not a known field');
    }
  }
};

const expectString = (value: unknown, field: string, pattern?: RegExp): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw manifestError(field, 'must be a non-empty string');
  }
  if (pattern !== undefined && !pattern.test(value)) {
    throw manifestError(field, `must match ${String(pattern)}`);
  }
  return value;
};

const expectArray = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) throw manifestError(field, 'must be a list');
  return value;
};

const expectOneOf = <T extends string>(value: unknown, field: string, allowed: readonly T[]): T => {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw manifestError(field, `must be one of ${quoteAll(allowed)}`);
  return match;
};

const expectDistinct = (values: readonly string[], field: string): void => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw manifestError(field, `lists "${value}" more than once`);
    seen.add(value);
  }
};

const parseFilter = <T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T[] => {
  if (value === undefined) return [...allowed];
  const entries = expectArray(value, field);
  if (entries.length === 0) throw manifestError(field, 'must not be empty; omit it to run always');
  const parsed = entries.map((entry, index) => expectOneOf(entry, `${field}[${String(index)}]`, allowed));
  expectDistinct(parsed, field);
  return parsed;
};

const parseMatrix = (value: unknown, field: string): MatrixEntry[] => {
  const entries = expectArray(value, field);
  if (entries.length === 0) throw manifestError(field, 'must list at least one entry');
  const matrix = entries.map((entry, index) => {
    const entryField = `${field}[${String(index)}]`;
    const record = expectRecord(entry, entryField);
    expectKeys(record, entryField, ['suite', 'browser']);
    const browser = record['browser'];
    if (typeof browser !== 'boolean') throw manifestError(`${entryField}.browser`, 'must be true or false');
    return { suite: expectString(record['suite'], `${entryField}.suite`, suitePattern), browser };
  });
  expectDistinct(matrix.map((entry) => entry.suite), `${field} suites`);
  return matrix;
};

const parseJob = (value: unknown, field: string): ManifestJob => {
  const record = expectRecord(value, field);
  expectKeys(record, field, ['id', 'mode'], ['runOn', 'matrix']);
  const runOnRaw = record['runOn'];
  const runOnRecord = runOnRaw === undefined ? {} : expectRecord(runOnRaw, `${field}.runOn`);
  expectKeys(runOnRecord, `${field}.runOn`, [], ['events', 'branches']);
  return {
    id: expectString(record['id'], `${field}.id`, jobIdPattern),
    mode: expectOneOf(record['mode'], `${field}.mode`, JOB_MODES),
    runOn: {
      events: parseFilter(runOnRecord['events'], `${field}.runOn.events`, DISPATCH_EVENTS),
      branches: parseFilter(runOnRecord['branches'], `${field}.runOn.branches`, DISPATCH_BRANCHES),
    },
    matrix: record['matrix'] === undefined ? null : parseMatrix(record['matrix'], `${field}.matrix`),
  };
};

const parseSeparateChecks = (value: unknown, field: string): SeparateRequiredCheck[] => {
  const checks = expectArray(value, field).map((entry, index) => {
    const entryField = `${field}[${String(index)}]`;
    const record = expectRecord(entry, entryField);
    expectKeys(record, entryField, ['name', 'reason']);
    return {
      name: expectString(record['name'], `${entryField}.name`),
      reason: expectString(record['reason'], `${entryField}.reason`),
    };
  });
  expectDistinct(checks.map((check) => check.name), field);
  return checks;
};

const parsePostDeploy = (value: unknown): Record<PostDeployEnvironment, string[]> => {
  const record = expectRecord(value, 'postDeploy');
  expectKeys(record, 'postDeploy', POST_DEPLOY_ENVIRONMENTS);
  const slot = (environment: PostDeployEnvironment): string[] => {
    const field = `postDeploy.${environment}`;
    if (expectArray(record[environment], field).length > 0) {
      throw manifestError(field, 'is reserved for post-deploy jobs that nothing runs yet, so it must stay empty');
    }
    return [];
  };
  return { staging: slot('staging'), production: slot('production') };
};

export const parseManifest = (value: unknown): DispatchManifest => {
  const record = expectRecord(value, 'manifest');
  expectKeys(record, '', [
    'gate',
    'workflow',
    'planJob',
    'jobs',
    'afterGate',
    'separateRequiredChecks',
    'postDeploy',
    'deletionProtectedBranches',
  ]);
  const gate = expectString(record['gate'], 'gate', jobIdPattern);
  const planJob = expectString(record['planJob'], 'planJob', jobIdPattern);
  const jobs = expectArray(record['jobs'], 'jobs').map((job, index) => parseJob(job, `jobs[${String(index)}]`));
  if (jobs.length === 0) throw manifestError('jobs', 'must list at least one job');
  const afterGate = expectArray(record['afterGate'], 'afterGate')
    .map((id, index) => expectString(id, `afterGate[${String(index)}]`, jobIdPattern));
  expectDistinct([gate, planJob, ...jobs.map((job) => job.id), ...afterGate], 'jobs, afterGate, gate and planJob');
  const separate = expectRecord(record['separateRequiredChecks'], 'separateRequiredChecks');
  expectKeys(separate, 'separateRequiredChecks', DISPATCH_BRANCHES);
  const separateRequiredChecks = {
    staging: parseSeparateChecks(separate['staging'], 'separateRequiredChecks.staging'),
    main: parseSeparateChecks(separate['main'], 'separateRequiredChecks.main'),
  };
  for (const branch of DISPATCH_BRANCHES) {
    if (separateRequiredChecks[branch].some((check) => check.name === gate)) {
      throw manifestError(`separateRequiredChecks.${branch}`, `must not repeat the gate "${gate}"`);
    }
  }
  const deletionProtectedBranches = expectArray(record['deletionProtectedBranches'], 'deletionProtectedBranches')
    .map((branch, index) => expectOneOf(branch, `deletionProtectedBranches[${String(index)}]`, DISPATCH_BRANCHES));
  expectDistinct(deletionProtectedBranches, 'deletionProtectedBranches');
  return {
    gate,
    workflow: expectString(record['workflow'], 'workflow', /^[A-Za-z0-9._-]+\.ya?ml$/),
    planJob,
    jobs,
    afterGate,
    separateRequiredChecks,
    postDeploy: parsePostDeploy(record['postDeploy']),
    deletionProtectedBranches,
  };
};

export const loadManifest = (path: string = DEFAULT_MANIFEST_PATH): DispatchManifest => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`dispatch-ci manifest: cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return parseManifest(raw);
};

export const expectedRequiredChecks = (
  manifest: DispatchManifest,
): Record<DispatchBranch, string[]> => ({
  staging: [manifest.gate, ...manifest.separateRequiredChecks.staging.map((check) => check.name)],
  main: [manifest.gate, ...manifest.separateRequiredChecks.main.map((check) => check.name)],
});

export const resolveEventContext = (env: Env): EventContext => {
  const eventName = env['GITHUB_EVENT_NAME'] ?? '';
  const event = DISPATCH_EVENTS.find((candidate) => candidate === eventName);
  if (event === undefined) {
    throw new Error(
      `dispatch-ci plan: event "${eventName}" is not one of ${quoteAll(DISPATCH_EVENTS)}; failing closed`,
    );
  }
  const ref = env['GITHUB_REF'] ?? '';
  const branchName = event === 'pull_request'
    ? env['GITHUB_BASE_REF'] ?? ''
    : ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '';
  const branch = DISPATCH_BRANCHES.find((candidate) => candidate === branchName);
  if (branch === undefined) {
    const source = event === 'pull_request' ? `base branch "${branchName}"` : `ref "${ref}"`;
    throw new Error(
      `dispatch-ci plan: ${source} is not one of ${quoteAll(DISPATCH_BRANCHES)}; failing closed`,
    );
  }
  return { event, branch };
};

export const planDispatch = (manifest: DispatchManifest, context: EventContext): DispatchPlan => ({
  version: 1,
  gate: manifest.gate,
  event: context.event,
  branch: context.branch,
  jobs: manifest.jobs.map((job) => ({
    id: job.id,
    run: job.runOn.events.includes(context.event) && job.runOn.branches.includes(context.branch),
    required: job.mode === 'required',
    matrix: job.matrix,
  })),
});

export const planOutputs = (plan: DispatchPlan): Record<string, string> => {
  const outputs: Record<string, string> = { plan: JSON.stringify(plan) };
  for (const job of plan.jobs) {
    outputs[`run-${job.id}`] = String(job.run);
    if (job.matrix !== null) outputs[`matrix-${job.id}`] = JSON.stringify(job.run ? job.matrix : []);
  }
  return outputs;
};

const planError = (problem: string): Error => new Error(`plan output unparseable: ${problem}`);

const parsePlannedJob = (value: unknown, index: number): PlannedJob => {
  const field = `jobs[${String(index)}]`;
  if (!isRecord(value)) throw planError(`${field} is not an object`);
  const { id, run, required, matrix } = value;
  if (typeof id !== 'string' || !jobIdPattern.test(id)) throw planError(`${field}.id is not a job id`);
  if (typeof run !== 'boolean') throw planError(`${field}.run is not a boolean`);
  if (typeof required !== 'boolean') throw planError(`${field}.required is not a boolean`);
  if (matrix === null) return { id, run, required, matrix: null };
  if (!Array.isArray(matrix)) throw planError(`${field}.matrix is neither null nor a list`);
  return {
    id,
    run,
    required,
    matrix: matrix.map((entry: unknown, entryIndex) => {
      if (!isRecord(entry) || typeof entry['suite'] !== 'string' || typeof entry['browser'] !== 'boolean') {
        throw planError(`${field}.matrix[${String(entryIndex)}] is not a suite entry`);
      }
      return { suite: entry['suite'], browser: entry['browser'] };
    }),
  };
};

export const parsePlan = (raw: string | undefined): DispatchPlan => {
  if (raw === undefined || raw.trim() === '') throw new Error('plan output missing');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw planError('not JSON');
  }
  if (!isRecord(value)) throw planError('not an object');
  if (value['version'] !== 1) throw planError('version is not 1');
  if (typeof value['gate'] !== 'string') throw planError('gate is not a string');
  const event = DISPATCH_EVENTS.find((candidate) => candidate === value['event']);
  if (event === undefined) throw planError('event is unknown');
  const branch = DISPATCH_BRANCHES.find((candidate) => candidate === value['branch']);
  if (branch === undefined) throw planError('branch is unknown');
  const jobs = value['jobs'];
  if (!Array.isArray(jobs)) throw planError('jobs is not a list');
  const parsed = jobs.map((job: unknown, index) => parsePlannedJob(job, index));
  const ids = parsed.map((job) => job.id);
  if (new Set(ids).size !== ids.length) throw planError('jobs repeat an id');
  return { version: 1, gate: value['gate'], event, branch, jobs: parsed };
};

export interface NeedsEntry {
  result: JobResult;
}

export const parseNeeds = (raw: string | undefined): Record<string, NeedsEntry> => {
  if (raw === undefined || raw.trim() === '') throw new Error('needs context missing');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('needs context is not JSON');
  }
  if (!isRecord(value)) throw new Error('needs context is not an object');
  const needs: Record<string, NeedsEntry> = {};
  for (const [id, entry] of Object.entries(value)) {
    const result = isRecord(entry)
      ? JOB_RESULTS.find((candidate) => candidate === entry['result'])
      : undefined;
    if (result === undefined) throw new Error(`needs context entry "${id}" has no known result`);
    needs[id] = { result };
  }
  return needs;
};

export interface RunJobDetail {
  name: string;
  conclusion: string | null;
  failedStep: string | null;
}

export type RunDetails =
  | { available: true; jobs: RunJobDetail[] }
  | { available: false; reason: string };

type Outcome =
  | 'passed'
  | 'skipped as planned'
  | 'advisory failure'
  | 'failed'
  | 'cancelled'
  | 'skipped but required'
  | 'plan mismatch';

export interface JobVerdict {
  id: string;
  planned: 'run' | 'skip' | 'not planned';
  mode: 'required' | 'advisory' | '-';
  result: JobResult | 'missing';
  outcome: Outcome;
  detail: string;
}

export interface GateVerdict {
  green: boolean;
  headline: string;
  notes: string[];
  jobs: JobVerdict[];
  wantsRunDetails: boolean;
}

export interface GateInput {
  planJob: string;
  needsRaw: string | undefined;
  planRaw: string | undefined;
  details: RunDetails | null;
}

const blockingOutcomes: readonly Outcome[] = ['failed', 'cancelled', 'skipped but required', 'plan mismatch'];

const red = (problem: string): string => `dispatch-ci: RED — ${problem}`;

const listOrNone = (items: readonly string[]): string => items.length === 0 ? 'none' : items.join(', ');

const legName = (jobId: string, suite: string): string => `${jobId} (${suite})`;

const runNames = (job: PlannedJob): string[] =>
  job.matrix === null ? [job.id] : job.matrix.map((entry) => legName(job.id, entry.suite));

const describeFailure = (job: PlannedJob, details: RunDetails | null): string[] => {
  if (details === null || !details.available) return [job.id];
  const names = new Set(runNames(job));
  const failing = details.jobs.filter((detail) => names.has(detail.name) && detail.conclusion === 'failure');
  if (failing.length === 0) return [job.id];
  return failing.map((detail) =>
    detail.failedStep === null ? detail.name : `${detail.name} (step "${detail.failedStep}")`);
};

const describeCancellation = (job: PlannedJob, details: RunDetails | null): string[] => {
  if (details === null || !details.available || job.matrix === null) return [job.id];
  const names = new Set(runNames(job));
  const cancelled = details.jobs.filter((detail) => names.has(detail.name) && detail.conclusion === 'cancelled');
  return cancelled.length === 0 ? [job.id] : cancelled.map((detail) => detail.name);
};

const judgeJob = (job: PlannedJob, need: NeedsEntry | undefined): Omit<JobVerdict, 'detail'> & { reason: string } => {
  const base = {
    id: job.id,
    planned: job.run ? 'run' as const : 'skip' as const,
    mode: job.required ? 'required' as const : 'advisory' as const,
  };
  if (need === undefined) {
    return { ...base, result: 'missing', outcome: 'plan mismatch', reason: 'planned but missing from needs' };
  }
  const result = need.result;
  if (result === 'cancelled') return { ...base, result, outcome: 'cancelled', reason: '' };
  if (!job.run) {
    if (result === 'skipped') return { ...base, result, outcome: 'skipped as planned', reason: '' };
    if (result === 'failure') return { ...base, result, outcome: 'failed', reason: 'ran although not planned' };
    return { ...base, result, outcome: 'plan mismatch', reason: 'ran although not planned' };
  }
  if (result === 'success') return { ...base, result, outcome: 'passed', reason: '' };
  if (result === 'failure') {
    return job.required
      ? { ...base, result, outcome: 'failed', reason: '' }
      : { ...base, result, outcome: 'advisory failure', reason: '' };
  }
  return job.required
    ? { ...base, result, outcome: 'skipped but required', reason: '' }
    : { ...base, result, outcome: 'plan mismatch', reason: 'advisory job skipped although planned' };
};

const stepNotes = (details: RunDetails | null): string[] =>
  details !== null && !details.available
    ? [`dispatch-ci: step names unavailable (${details.reason}); the verdict comes from needs and the plan`]
    : [];

export const decideGate = (input: GateInput): GateVerdict => {
  const stop = (problem: string): GateVerdict => ({
    green: false,
    headline: red(problem),
    notes: [],
    jobs: [],
    wantsRunDetails: false,
  });
  let needs: Record<string, NeedsEntry>;
  try {
    needs = parseNeeds(input.needsRaw);
  } catch (cause) {
    return stop(cause instanceof Error ? cause.message : String(cause));
  }
  const planNeed = needs[input.planJob];
  if (planNeed === undefined) return stop(`plan: job "${input.planJob}" is missing from needs`);
  if (planNeed.result !== 'success') {
    return stop(`plan: job "${input.planJob}" concluded ${planNeed.result}, so no job ran against a plan`);
  }
  let plan: DispatchPlan;
  try {
    plan = parsePlan(input.planRaw);
  } catch (cause) {
    return stop(`plan: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const failed: string[] = [];
  const cancelled: string[] = [];
  const skippedRequired: string[] = [];
  const mismatches: string[] = [];
  const advisoryFailures: string[] = [];
  const jobs: JobVerdict[] = [];

  for (const job of plan.jobs) {
    const { reason, ...verdict } = judgeJob(job, needs[job.id]);
    let detail = reason;
    if (verdict.outcome === 'failed') {
      const described = describeFailure(job, input.details);
      failed.push(...described.map((name) => reason === '' ? name : `${name} (${reason})`));
      detail = [described.join('; '), reason].filter((part) => part !== '').join(' — ');
    } else if (verdict.outcome === 'cancelled') {
      cancelled.push(...describeCancellation(job, input.details));
    } else if (verdict.outcome === 'skipped but required') {
      skippedRequired.push(job.id);
    } else if (verdict.outcome === 'plan mismatch') {
      mismatches.push(`${job.id} (${reason})`);
    } else if (verdict.outcome === 'advisory failure') {
      const described = describeFailure(job, input.details);
      advisoryFailures.push(...described);
      detail = described.join('; ');
    }
    jobs.push({ ...verdict, detail });
  }

  const plannedIds = new Set(plan.jobs.map((job) => job.id));
  for (const [id, need] of Object.entries(needs)) {
    if (id === input.planJob || plannedIds.has(id)) continue;
    mismatches.push(`${id} (unknown to the plan)`);
    jobs.push({
      id,
      planned: 'not planned',
      mode: '-',
      result: need.result,
      outcome: 'plan mismatch',
      detail: 'present in needs but unknown to the plan',
    });
  }

  const green = jobs.every((job) => !blockingOutcomes.includes(job.outcome));
  const ran = jobs.filter((job) => job.planned === 'run').length;
  const headline = green
    ? [
      `dispatch-ci: GREEN — ${String(ran)} planned job(s) matched the plan for ${plan.event} on ${plan.branch}`,
      ...advisoryFailures.length > 0 ? [`advisory failures (not blocking): ${advisoryFailures.join(', ')}`] : [],
    ].join('; ')
    : red([
      `failed: ${listOrNone(failed)}`,
      `cancelled: ${listOrNone(cancelled)}`,
      `skipped but required: ${listOrNone(skippedRequired)}`,
      ...mismatches.length > 0 ? [`plan mismatch: ${mismatches.join(', ')}`] : [],
    ].join('; '));

  return {
    green,
    headline,
    notes: stepNotes(input.details),
    jobs,
    wantsRunDetails: failed.length > 0 || cancelled.length > 0 || advisoryFailures.length > 0,
  };
};

const tableCell = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ');

export const formatGateSummary = (verdict: GateVerdict): string => [
  verdict.headline,
  '',
  ...verdict.notes.flatMap((note) => [note, '']),
  ...verdict.jobs.length === 0
    ? []
    : [
      '| job | planned | mode | result | verdict | detail |',
      '| --- | --- | --- | --- | --- | --- |',
      ...verdict.jobs.map((job) => `| ${[job.id, job.planned, job.mode, job.result, job.outcome, job.detail === '' ? '-' : job.detail]
        .map(tableCell).join(' | ')} |`),
      '',
    ],
].join('\n');

export const formatGateLog = (verdict: GateVerdict): string => [
  verdict.headline,
  ...verdict.notes,
  ...verdict.jobs.map((job) =>
    `  ${job.id}: planned ${job.planned}, ${job.mode}, result ${job.result} -> ${job.outcome}${job.detail === '' ? '' : ` (${job.detail})`}`),
  '',
].join('\n');

export const parseRunJobs = (payload: unknown): RunJobDetail[] => {
  const jobs = isRecord(payload) ? payload['jobs'] : undefined;
  if (!Array.isArray(jobs)) throw new Error('jobs list missing in the API response');
  return jobs.map((job: unknown) => {
    if (!isRecord(job) || typeof job['name'] !== 'string') throw new Error('a job in the API response has no name');
    const conclusion = typeof job['conclusion'] === 'string' ? job['conclusion'] : null;
    const steps: unknown[] = Array.isArray(job['steps']) ? job['steps'] : [];
    const failedStep = steps.find((step) => isRecord(step) && step['conclusion'] === 'failure');
    return {
      name: job['name'],
      conclusion,
      failedStep: isRecord(failedStep) && typeof failedStep['name'] === 'string' ? failedStep['name'] : null,
    };
  });
};

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export const readRunDetails = async (env: Env, fetchJobs: Fetch): Promise<RunDetails> => {
  const repository = env['GITHUB_REPOSITORY'] ?? '';
  const runId = env['GITHUB_RUN_ID'] ?? '';
  const attempt = env['GITHUB_RUN_ATTEMPT'] ?? '';
  const token = env['GITHUB_TOKEN'] ?? '';
  if (repository === '' || runId === '' || attempt === '' || token === '') {
    return { available: false, reason: 'GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT or GITHUB_TOKEN is not set' };
  }
  const api = env['GITHUB_API_URL'] ?? 'https://api.github.com';
  try {
    const response = await fetchJobs(
      `${api}/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'dispatch-ci',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) return { available: false, reason: `jobs API returned HTTP ${String(response.status)}` };
    return { available: true, jobs: parseRunJobs(await response.json()) };
  } catch (cause) {
    return { available: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
};

const annotation = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const appendIfSet = (path: string | undefined, text: string): void => {
  if (path !== undefined && path !== '') appendFileSync(path, text);
};

const runPlan = (env: Env, manifestPath: string): void => {
  const manifest = loadManifest(manifestPath);
  const plan = planDispatch(manifest, resolveEventContext(env));
  const outputs = planOutputs(plan);
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  appendIfSet(env['GITHUB_OUTPUT'], `${lines.join('\n')}\n`);
  const runs = plan.jobs.filter((job) => job.run).map((job) => job.id);
  const skips = plan.jobs.filter((job) => !job.run).map((job) => job.id);
  const headline = `dispatch-ci plan: ${plan.event} on ${plan.branch} — run: ${listOrNone(runs)}; skip: ${listOrNone(skips)}`;
  process.stdout.write(`${headline}\n${lines.join('\n')}\n`);
  appendIfSet(env['GITHUB_STEP_SUMMARY'], [
    headline,
    '',
    '| job | run | mode | matrix |',
    '| --- | --- | --- | --- |',
    ...plan.jobs.map((job) => `| ${job.id} | ${String(job.run)} | ${job.required ? 'required' : 'advisory'} | ${
      job.matrix === null ? '-' : job.matrix.map((entry) => entry.suite).join(', ')} |`),
    '',
  ].join('\n'));
};

const runGate = async (env: Env, manifestPath: string): Promise<boolean> => {
  const manifest = loadManifest(manifestPath);
  const input: GateInput = {
    planJob: manifest.planJob,
    needsRaw: env['DISPATCH_CI_NEEDS'],
    planRaw: env['DISPATCH_CI_PLAN'],
    details: null,
  };
  let verdict = decideGate(input);
  if (verdict.wantsRunDetails) {
    verdict = decideGate({ ...input, details: await readRunDetails(env, fetch) });
  }
  process.stdout.write(formatGateLog(verdict));
  if (!verdict.green) process.stdout.write(`::error title=dispatch-ci::${annotation(verdict.headline)}\n`);
  appendIfSet(env['GITHUB_STEP_SUMMARY'], formatGateSummary(verdict));
  return verdict.green;
};

const main = async (env: Env, argv: readonly string[]): Promise<number> => {
  const command = argv[0];
  const manifestPath = env['DISPATCH_CI_MANIFEST'] ?? DEFAULT_MANIFEST_PATH;
  if (command === 'plan') {
    runPlan(env, manifestPath);
    return 0;
  }
  if (command === 'gate') return await runGate(env, manifestPath) ? 0 : 1;
  throw new Error('usage: node scripts/dispatch-ci.ts <plan|gate>');
};

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main(process.env, process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    const headline = process.argv[2] === 'gate' ? red(message) : message;
    process.stdout.write(`${headline}\n::error title=dispatch-ci::${annotation(headline)}\n`);
    appendIfSet(process.env['GITHUB_STEP_SUMMARY'], `${headline}\n`);
    process.exitCode = 1;
  });
}
