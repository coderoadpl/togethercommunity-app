import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  decideGate,
  expectedRequiredChecks,
  formatGateSummary,
  loadManifest,
  parseManifest,
  parsePlan,
  planDispatch,
  planOutputs,
  readRunDetails,
  resolveEventContext,
  type DispatchManifest,
  type DispatchPlan,
  type RunDetails,
} from './dispatch-ci.js';

interface RawManifest {
  [field: string]: unknown;
  jobs: Record<string, unknown>[];
  afterGate: string[];
  separateRequiredChecks: Record<string, Record<string, unknown>[]>;
  ungatedChecks: Record<string, Record<string, unknown>[]>;
  postDeploy: Record<string, string[]>;
  deletionProtectedBranches: string[];
}

const validManifest = (): RawManifest => ({
  gate: 'dispatch-ci',
  workflow: 'ci.yml',
  planJob: 'plan',
  jobs: [
    { id: 'check', mode: 'required' },
    { id: 'audit', mode: 'advisory' },
    { id: 'smoke', mode: 'required', runOn: { events: ['pull_request'], branches: ['main'] } },
    {
      id: 'e2e',
      mode: 'required',
      matrix: [{ suite: 'auth', browser: true }, { suite: 'coupon', browser: true }],
    },
  ],
  afterGate: ['release-tag'],
  separateRequiredChecks: {
    staging: [{ name: 'ai-review', reason: 'own workflow' }],
    main: [{ name: 'ai-review', reason: 'own workflow' }, { name: 'promotion-guard', reason: 'own workflow' }],
  },
  ungatedChecks: {
    staging: [],
    main: [{ name: 'storybook-preview', reason: 'publishes a preview link, never blocks a merge' }],
  },
  postDeploy: { staging: [], production: [] },
  deletionProtectedBranches: ['staging', 'main'],
});

const manifest: DispatchManifest = parseManifest(validManifest());

const withField = (mutate: (raw: RawManifest) => void): RawManifest => {
  const raw = validManifest();
  mutate(raw);
  return raw;
};

describe('dispatch-ci manifest', () => {
  it('loads and validates the committed manifest', () => {
    const committed = loadManifest();

    expect(committed.gate).toBe('dispatch-ci');
    expect(committed.workflow).toBe('ci.yml');
    expect(committed.afterGate).toEqual(['release-tag']);
    expect(committed.jobs.filter((job) => job.mode === 'advisory').map((job) => job.id))
      .toEqual(['dependency-audit', 'telemetry-mongodb']);
    expect(committed.ungatedChecks).toEqual({ staging: [], main: [] });
    expect(committed.postDeploy).toEqual({ staging: [], production: [] });
    expect(committed.deletionProtectedBranches).toEqual(['staging', 'main']);
    expect(expectedRequiredChecks(committed)).toEqual({
      staging: ['dispatch-ci', 'ai-review', 'staging-freeze'],
      main: ['dispatch-ci', 'ai-review', 'promotion-guard'],
    });
  });

  it('defaults runOn to every event and branch', () => {
    expect(manifest.jobs[0]?.runOn).toEqual({ events: ['pull_request', 'push'], branches: ['staging', 'main'] });
  });

  it.each([
    ['manifest must be an object', () => []],
    ['gate is missing', () => withField((raw) => {
      delete raw['gate'];
    })],
    ['extra is not a known field', () => ({ ...validManifest(), extra: true })],
    ['jobs[1].mode must be one of "required", "advisory"', () => withField((raw) => {
      raw.jobs[1] = { id: 'audit', mode: 'optional' };
    })],
    ['jobs[0].id must match', () => withField((raw) => {
      raw.jobs[0] = { id: 'bad id', mode: 'required' };
    })],
    ['jobs[2].runOn.events[0] must be one of "pull_request", "push"', () => withField((raw) => {
      raw.jobs[2] = { id: 'smoke', mode: 'required', runOn: { events: ['schedule'], branches: ['main'] } };
    })],
    ['jobs[2].runOn.branches must not be empty', () => withField((raw) => {
      raw.jobs[2] = { id: 'smoke', mode: 'required', runOn: { events: ['push'], branches: [] } };
    })],
    ['jobs[3].matrix must list at least one entry', () => withField((raw) => {
      raw.jobs[3] = { id: 'e2e', mode: 'required', matrix: [] };
    })],
    ['jobs[3].matrix[0].browser must be true or false', () => withField((raw) => {
      raw.jobs[3] = { id: 'e2e', mode: 'required', matrix: [{ suite: 'auth', browser: 'yes' }] };
    })],
    ['jobs[3].matrix suites lists "auth" more than once', () => withField((raw) => {
      raw.jobs[3] = {
        id: 'e2e',
        mode: 'required',
        matrix: [{ suite: 'auth', browser: true }, { suite: 'auth', browser: false }],
      };
    })],
    ['jobs, afterGate, gate and planJob lists "check" more than once', () => withField((raw) => {
      raw.afterGate = ['check'];
    })],
    ['separateRequiredChecks.main must not repeat the gate "dispatch-ci"', () => withField((raw) => {
      raw.separateRequiredChecks.main = [{ name: 'dispatch-ci', reason: 'duplicate' }];
    })],
    ['separateRequiredChecks.staging[0].reason must be a non-empty string', () => withField((raw) => {
      raw.separateRequiredChecks.staging = [{ name: 'ai-review', reason: ' ' }];
    })],
    ['ungatedChecks is missing', () =>
      Object.fromEntries(Object.entries(validManifest()).filter(([key]) => key !== 'ungatedChecks'))],
    ['ungatedChecks.staging must not repeat the gate "dispatch-ci"', () => withField((raw) => {
      raw.ungatedChecks.staging = [{ name: 'dispatch-ci', reason: 'duplicate' }];
    })],
    ['ungatedChecks.main[0].reason must be a non-empty string', () => withField((raw) => {
      raw.ungatedChecks.main = [{ name: 'storybook-preview', reason: '' }];
    })],
    ['ungatedChecks.main lists "storybook-preview" more than once', () => withField((raw) => {
      raw.ungatedChecks.main = [
        { name: 'storybook-preview', reason: 'preview' },
        { name: 'storybook-preview', reason: 'preview' },
      ];
    })],
    ['ungatedChecks.main must not repeat "promotion-guard" from separateRequiredChecks.main', () => withField((raw) => {
      raw.ungatedChecks.main = [{ name: 'promotion-guard', reason: 'listed twice' }];
    })],
    ['postDeploy.production is reserved for post-deploy jobs', () => withField((raw) => {
      raw.postDeploy = { staging: [], production: ['prod-smoke'] };
    })],
    ['deletionProtectedBranches[0] must be one of "staging", "main"', () => withField((raw) => {
      raw.deletionProtectedBranches = ['production'];
    })],
  ])('rejects a manifest where %s', (message, build) => {
    expect(() => parseManifest(build())).toThrow(`dispatch-ci manifest: ${message}`);
  });
});

describe('dispatch-ci plan', () => {
  it.each([
    [{ GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'staging', GITHUB_REF: 'refs/pull/7/merge' }, 'pull_request', 'staging'],
    [{ GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', GITHUB_REF: 'refs/pull/7/merge' }, 'pull_request', 'main'],
    [{ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/staging' }, 'push', 'staging'],
    [{ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' }, 'push', 'main'],
  ])('resolves %o', (env, event, branch) => {
    expect(resolveEventContext(env)).toEqual({ event, branch });
  });

  it.each([
    [{ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' }, 'event "workflow_dispatch"'],
    [{ GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_BASE_REF: 'main' }, 'event "pull_request_target"'],
    [{}, 'event ""'],
    [{ GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'feature' }, 'base branch "feature"'],
    [{ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/feature' }, 'ref "refs/heads/feature"'],
    [{ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/main' }, 'ref "refs/tags/main"'],
  ])('fails closed on %o', (env, message) => {
    expect(() => resolveEventContext(env)).toThrow(message);
    expect(() => resolveEventContext(env)).toThrow('failing closed');
  });

  it('applies runOn filters per event and branch', () => {
    const run = (event: 'pull_request' | 'push', branch: 'staging' | 'main') =>
      planDispatch(manifest, { event, branch }).jobs.filter((job) => job.run).map((job) => job.id);

    expect(run('pull_request', 'staging')).toEqual(['check', 'audit', 'e2e']);
    expect(run('pull_request', 'main')).toEqual(['check', 'audit', 'smoke', 'e2e']);
    expect(run('push', 'staging')).toEqual(['check', 'audit', 'e2e']);
    expect(run('push', 'main')).toEqual(['check', 'audit', 'e2e']);
  });

  it('runs every committed job on every event and branch', () => {
    const committed = loadManifest();
    for (const event of ['pull_request', 'push'] as const) {
      for (const branch of ['staging', 'main'] as const) {
        expect(planDispatch(committed, { event, branch }).jobs.every((job) => job.run)).toBe(true);
      }
    }
  });

  it('writes the plan, one run flag per job and the matrix as outputs', () => {
    const plan = planDispatch(manifest, { event: 'pull_request', branch: 'staging' });
    const outputs = planOutputs(plan);

    expect(Object.keys(outputs)).toEqual(['plan', 'run-check', 'run-audit', 'run-smoke', 'run-e2e', 'matrix-e2e']);
    expect(outputs['run-smoke']).toBe('false');
    expect(outputs['run-check']).toBe('true');
    expect(JSON.parse(outputs['matrix-e2e'] ?? '')).toEqual([
      { suite: 'auth', browser: true },
      { suite: 'coupon', browser: true },
    ]);
    expect(parsePlan(outputs['plan'])).toEqual(plan);
    expect(Object.values(outputs).every((value) => !value.includes('\n'))).toBe(true);
  });

  it('writes an empty matrix for a matrix job that does not run', () => {
    const raw = validManifest();
    raw.jobs[3] = { id: 'e2e', mode: 'required', runOn: { events: ['push'] }, matrix: [{ suite: 'auth', browser: true }] };
    const outputs = planOutputs(planDispatch(parseManifest(raw), { event: 'pull_request', branch: 'main' }));

    expect(outputs['run-e2e']).toBe('false');
    expect(outputs['matrix-e2e']).toBe('[]');
  });
});

const plan: DispatchPlan = {
  version: 1,
  gate: 'dispatch-ci',
  event: 'pull_request',
  branch: 'staging',
  jobs: [
    { id: 'check', run: true, required: true, matrix: null },
    { id: 'audit', run: true, required: false, matrix: null },
    { id: 'smoke', run: false, required: true, matrix: null },
    {
      id: 'e2e',
      run: true,
      required: true,
      matrix: [{ suite: 'auth', browser: true }, { suite: 'coupon', browser: true }],
    },
  ],
};

type Result = 'success' | 'failure' | 'cancelled' | 'skipped';

const needs = (results: Partial<Record<string, Result>>, extra: Record<string, Result> = {}): string => {
  const base: Record<string, Result> = {
    plan: 'success',
    check: 'success',
    audit: 'success',
    smoke: 'skipped',
    e2e: 'success',
  };
  const merged: Record<string, Result | undefined> = { ...base, ...results, ...extra };
  return JSON.stringify(Object.fromEntries(Object.entries(merged)
    .filter((entry): entry is [string, Result] => entry[1] !== undefined)
    .map(([id, result]) => [id, { result, outputs: {} }])));
};

const gate = (needsRaw: string | undefined, details: RunDetails | null = null) =>
  decideGate({ planJob: 'plan', needsRaw, planRaw: JSON.stringify(plan), details });

const apiDetails: RunDetails = {
  available: true,
  jobs: [
    { name: 'plan', conclusion: 'success', failedStep: null },
    { name: 'check', conclusion: 'failure', failedStep: 'pnpm run depcruise' },
    { name: 'audit', conclusion: 'failure', failedStep: 'pnpm audit --prod --audit-level=moderate' },
    { name: 'e2e (auth)', conclusion: 'success', failedStep: null },
    { name: 'e2e (coupon)', conclusion: 'failure', failedStep: 'Run E2E suite' },
    { name: 'dispatch-ci', conclusion: null, failedStep: null },
  ],
};

describe('dispatch-ci gate', () => {
  it.each([
    ['every planned job passed', needs({}), true,
      'dispatch-ci: GREEN — 3 planned job(s) matched the plan for pull_request on staging'],
    ['an advisory job failed', needs({ audit: 'failure' }), true,
      'dispatch-ci: GREEN — 3 planned job(s) matched the plan for pull_request on staging; advisory failures (not blocking): audit'],
    ['a not-planned job was skipped', needs({ smoke: 'skipped' }), true,
      'dispatch-ci: GREEN — 3 planned job(s) matched the plan for pull_request on staging'],
    ['a required job failed', needs({ check: 'failure' }), false,
      'dispatch-ci: RED — failed: check; cancelled: none; skipped but required: none'],
    ['a job was cancelled', needs({ e2e: 'cancelled' }), false,
      'dispatch-ci: RED — failed: none; cancelled: e2e; skipped but required: none'],
    ['an advisory job was cancelled', needs({ audit: 'cancelled' }), false,
      'dispatch-ci: RED — failed: none; cancelled: audit; skipped but required: none'],
    ['a failure came with a cancellation', needs({ check: 'failure', e2e: 'cancelled' }), false,
      'dispatch-ci: RED — failed: check; cancelled: e2e; skipped but required: none'],
    ['a required job was skipped', needs({ check: 'skipped' }), false,
      'dispatch-ci: RED — failed: none; cancelled: none; skipped but required: check'],
    ['a not-planned job ran and failed', needs({ smoke: 'failure' }), false,
      'dispatch-ci: RED — failed: smoke (ran although not planned); cancelled: none; skipped but required: none'],
    ['a not-planned job ran and passed', needs({ smoke: 'success' }), false,
      'dispatch-ci: RED — failed: none; cancelled: none; skipped but required: none; plan mismatch: smoke (ran although not planned)'],
    ['an advisory planned job was skipped', needs({ audit: 'skipped' }), false,
      'dispatch-ci: RED — failed: none; cancelled: none; skipped but required: none; plan mismatch: audit (advisory job skipped although planned)'],
    ['needs lists a job the plan does not know', needs({}, { surprise: 'success' }), false,
      'dispatch-ci: RED — failed: none; cancelled: none; skipped but required: none; plan mismatch: surprise (unknown to the plan)'],
    ['a planned job is missing from needs', needs({ e2e: undefined }), false,
      'dispatch-ci: RED — failed: none; cancelled: none; skipped but required: none; plan mismatch: e2e (planned but missing from needs)'],
    ['the plan job failed', needs({ plan: 'failure', check: 'skipped', audit: 'skipped', e2e: 'skipped' }), false,
      'dispatch-ci: RED — plan: job "plan" concluded failure, so no job ran against a plan'],
    ['the plan job is absent from needs', needs({ plan: undefined }), false,
      'dispatch-ci: RED — plan: job "plan" is missing from needs'],
  ])('decides when %s', (_label, needsRaw, green, headline) => {
    const verdict = gate(needsRaw);

    expect(verdict.green).toBe(green);
    expect(verdict.headline).toBe(headline);
    expect(verdict.headline).not.toContain('\n');
  });

  it.each([
    ['missing', undefined, 'dispatch-ci: RED — plan: plan output missing'],
    ['empty', '', 'dispatch-ci: RED — plan: plan output missing'],
    ['not JSON', '{plan', 'dispatch-ci: RED — plan: plan output unparseable: not JSON'],
    ['wrong shape', JSON.stringify({ ...plan, jobs: [{ id: 'check', run: 'yes', required: true, matrix: null }] }),
      'dispatch-ci: RED — plan: plan output unparseable: jobs[0].run is not a boolean'],
    ['wrong version', JSON.stringify({ ...plan, version: 2 }), 'dispatch-ci: RED — plan: plan output unparseable: version is not 1'],
  ])('fails closed when the plan output is %s', (_label, planRaw, headline) => {
    const verdict = decideGate({ planJob: 'plan', needsRaw: needs({}), planRaw, details: null });

    expect(verdict.green).toBe(false);
    expect(verdict.headline).toBe(headline);
  });

  it.each([
    ['missing', undefined, 'dispatch-ci: RED — needs context missing'],
    ['not JSON', 'nope', 'dispatch-ci: RED — needs context is not JSON'],
    ['without a result', JSON.stringify({ plan: { outputs: {} } }), 'dispatch-ci: RED — needs context entry "plan" has no known result'],
  ])('fails closed when the needs context is %s', (_label, needsRaw, headline) => {
    expect(gate(needsRaw).headline).toBe(headline);
  });

  it('names the failing step and the failing matrix legs from the jobs API', () => {
    const verdict = gate(needs({ check: 'failure', e2e: 'failure', audit: 'failure' }), apiDetails);

    expect(verdict.headline).toBe(
      'dispatch-ci: RED — failed: check (step "pnpm run depcruise"), e2e (coupon) (step "Run E2E suite"); cancelled: none; skipped but required: none',
    );
    expect(verdict.notes).toEqual([]);
  });

  it('keeps the verdict when the jobs API read fails and says the step names are unavailable', () => {
    const withoutApi = gate(needs({ check: 'failure', e2e: 'failure' }), { available: false, reason: 'jobs API returned HTTP 403' });
    const withoutRead = gate(needs({ check: 'failure', e2e: 'failure' }));

    expect(withoutApi.green).toBe(false);
    expect(withoutApi.headline).toBe(withoutRead.headline);
    expect(withoutApi.headline).toBe('dispatch-ci: RED — failed: check, e2e; cancelled: none; skipped but required: none');
    expect(withoutApi.notes).toEqual([
      'dispatch-ci: step names unavailable (jobs API returned HTTP 403); the verdict comes from needs and the plan',
    ]);
  });

  it('asks for run details only when something failed or was cancelled', () => {
    expect(gate(needs({})).wantsRunDetails).toBe(false);
    expect(gate(needs({ check: 'failure' })).wantsRunDetails).toBe(true);
    expect(gate(needs({ e2e: 'cancelled' })).wantsRunDetails).toBe(true);
  });

  it('starts the step summary with the headline and lists every job in a table', () => {
    const summary = formatGateSummary(gate(needs({ check: 'failure' }), apiDetails));
    const lines = summary.split('\n');

    expect(lines[0]).toBe('dispatch-ci: RED — failed: check (step "pnpm run depcruise"); cancelled: none; skipped but required: none');
    expect(summary).toContain('| check | run | required | failure | failed | check (step "pnpm run depcruise") |');
    expect(summary).toContain('| smoke | skip | required | skipped | skipped as planned | - |');
  });
});

describe('dispatch-ci entry point', () => {
  it('runs the gate and fails red when invoked through a symlinked directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dispatch-ci-link-'));
    try {
      const linked = join(directory, 'scripts');
      symlinkSync(import.meta.dirname, linked, 'dir');
      const result = spawnSync(process.execPath, [join(linked, 'dispatch-ci.ts'), 'gate'], {
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          PATH: process.env['PATH'],
          DISPATCH_CI_NEEDS: JSON.stringify({ plan: { result: 'failure', outputs: {} } }),
        },
      });
      if (result.error !== undefined) throw result.error;

      expect(result.status).toBe(1);
      expect(result.stdout.split('\n')[0]).toBe(
        'dispatch-ci: RED — plan: job "plan" concluded failure, so no job ran against a plan',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('dispatch-ci run details', () => {
  const env = {
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_TOKEN: 'token',
  };

  it('reads the failing step of each job from the attempt jobs endpoint', async () => {
    const urls: string[] = [];
    const details = await readRunDetails(env, async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [{
            name: 'check',
            conclusion: 'failure',
            steps: [
              { name: 'pnpm run lint', conclusion: 'success' },
              { name: 'pnpm run knip', conclusion: 'failure' },
              { name: 'pnpm run doc-lint', conclusion: 'skipped' },
            ],
          }],
        }),
      };
    });

    expect(urls).toEqual(['https://api.github.com/repos/owner/repo/actions/runs/42/attempts/2/jobs?per_page=100']);
    expect(details).toEqual({
      available: true,
      jobs: [{ name: 'check', conclusion: 'failure', failedStep: 'pnpm run knip' }],
    });
  });

  it.each([
    ['an HTTP error', async () => ({ ok: false, status: 403, json: async () => ({}) }), 'jobs API returned HTTP 403'],
    ['a network error', async () => {
      throw new TypeError('fetch failed');
    }, 'fetch failed'],
    ['a malformed body', async () => ({ ok: true, status: 200, json: async () => ({ total: 1 }) }), 'jobs list missing in the API response'],
  ])('reports the details as unavailable on %s', async (_label, fetchJobs, reason) => {
    expect(await readRunDetails(env, fetchJobs)).toEqual({ available: false, reason });
  });

  it('does not call the API without the run environment', async () => {
    let calls = 0;
    const details = await readRunDetails({}, async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ jobs: [] }) };
    });

    expect(calls).toBe(0);
    expect(details.available).toBe(false);
  });
});
