import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import {
  AI_REVIEW_PRE_ATTEMPT_LIST_SLOT_COUNT, AI_REVIEW_SLOT_COUNT, aiReviewAttemptIds, renderAiReviewWorkflow,
} from '../scripts/generate-ai-review-workflow.js';

const stepSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  if: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(z.string()).optional(),
  with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  'continue-on-error': z.boolean().optional(),
  'timeout-minutes': z.union([z.string(), z.number()]).optional(),
});

const workflowSchema = z.object({
  name: z.string(),
  on: z.object({
    pull_request: z.object({ branches: z.array(z.string()), types: z.array(z.string()) }),
    workflow_dispatch: z.object({ inputs: z.record(z.unknown()) }),
  }),
  concurrency: z.object({ group: z.string(), 'cancel-in-progress': z.boolean() }),
  permissions: z.record(z.string()),
  jobs: z.object({
    'ai-review': z.object({
      name: z.string(),
      if: z.string(),
      'runs-on': z.string(),
      'timeout-minutes': z.string(),
      permissions: z.record(z.string()),
      steps: z.array(stepSchema),
    }),
  }),
});

const root = join(import.meta.dirname, '..', '..');
const source = readFileSync(join(root, '.github', 'workflows', 'ai-review.yml'), 'utf8');
const workflow = workflowSchema.parse(parse(source));
const job = workflow.jobs['ai-review'];

const stepById = (id: string) => {
  const found = job.steps.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`ai-review has no step with id "${id}"`);
  return found;
};

const stepByName = (name: string) => {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`ai-review has no step named "${name}"`);
  return found;
};

const actionPin = 'anthropics/claude-code-action/base-action@1d6de8cb0c237e7c15e9e1bdf973826ebae490cc';
const checkoutPin = 'actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955';
const slots = Array.from({ length: AI_REVIEW_SLOT_COUNT }, (_, index) => String(index + 1));
const attemptIds = [...aiReviewAttemptIds];
const primaryAttempts = new Set(attemptIds.filter((id) => /pr?$/.test(id)));
const slotOf = (id: string) => {
  const slot = /^try([1-9][0-9]*)(p|pr|f|fr)$/.exec(id)?.[1];
  if (slot === undefined) throw new Error(`Malformed attempt id "${id}"`);
  return slot;
};
const isAttemptStep = (step: { uses?: string | undefined }) => step.uses === actionPin;
const tokenReferences = (value: unknown) => [
  ...JSON.stringify(value).matchAll(/secrets\.(CLAUDE_CODE_OAUTH_TOKEN_\w+)/g),
].map((match) => match[1]);

const passVerdict = {
  verdict: 'PASS', summary: 'Reviewed.', blocking_issues: [], safe_to_merge: true,
  blast_radius: { scope: 'isolated', note: 'One workflow.' },
};
const failVerdict = {
  verdict: 'FAIL', summary: 'Blocked.', blocking_issues: ['Invalid workflow input.'],
  safe_to_merge: false, blast_radius: { scope: 'contained', note: 'One workflow.' },
};
const resultEvent = (structuredOutput: unknown) => ({
  type: 'result', subtype: 'success', is_error: false, structured_output: structuredOutput,
});

const collectAttempt = (
  id: string,
  log?: string,
  raw = '',
  outcome = 'success',
  fallbackLog = false,
  mode = 'staging',
) => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-workflow-'));
  try {
    const executionFile = join(directory, 'action.json');
    const defaultLog = join(directory, 'claude-execution-output.json');
    const destination = join(directory, `ai-review-${id}.json`);
    const output = join(directory, 'output');
    if (log !== undefined) writeFileSync(fallbackLog ? defaultLog : executionFile, log);
    const run = stepById(`classify${id.slice(3)}`).run;
    if (run === undefined) throw new Error(`Missing collector for ${id}`);
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', run], {
      cwd: root,
      env: {
        ...process.env,
        RAW: raw, TRY_OUTCOME: outcome, REVIEW_MODE: mode,
        OUTPUT_EXEC_FILE: fallbackLog ? '' : executionFile,
        DEST_LOG: destination, RUNNER_TEMP: directory,
        GITHUB_OUTPUT: output, GITHUB_WORKSPACE: root,
      },
      encoding: 'utf8',
      timeout: 5_000,
    });
    const outputs = readFileSync(output, 'utf8');
    return {
      status: result.status, stderr: result.stderr, outputs,
      archived: existsSync(destination) ? readFileSync(destination, 'utf8') : undefined,
      fallbackRemains: existsSync(defaultLog),
      raw: outputs.match(/^raw=(.*)$/m)?.[1],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const preAttemptListGate = `#!/usr/bin/env bash
set -euo pipefail
for outcome in "\${O_1P:-}" "\${O_1PR:-}" "\${O_1F:-}" "\${O_1FR:-}" \\
  "\${O_2P:-}" "\${O_2PR:-}" "\${O_2F:-}" "\${O_2FR:-}" \\
  "\${O_3P:-}" "\${O_3PR:-}" "\${O_3F:-}" "\${O_3FR:-}"; do
  case "$outcome" in pass) exit 0 ;; fail) exit 1 ;; esac
done
exit 1
`;
const preAttemptListPost = `#!/usr/bin/env bash
set -euo pipefail
producer=""
for key in 1P 1PR 1F 1FR 2P 2PR 2F 2FR 3P 3PR 3F 3FR; do
  outcome_name="O_$key"
  [ -n "\${!outcome_name:-}" ] && producer="$key"
done
printf '%s\\n' "$producer"
`;

type TrustedScripts = Partial<Record<'prepare-review.sh' | 'gate-review.sh' | 'post-review.sh', string>>;

const runTrustedStep = (scripts: TrustedScripts) => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-trusted-'));
  try {
    const scriptDirectory = join(directory, '.github', 'scripts');
    mkdirSync(scriptDirectory, { recursive: true });
    for (const [name, body] of Object.entries(scripts)) {
      const destination = join(scriptDirectory, name);
      writeFileSync(destination, body);
      chmodSync(destination, 0o755);
    }
    const output = join(directory, 'output');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-c', stepById('trusted').run ?? ''], {
      cwd: directory,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: 'utf8',
      timeout: 5_000,
    });
    return { status: result.status, stdout: result.stdout, outputs: readFileSync(output, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const committedScript = (name: keyof TrustedScripts) =>
  readFileSync(join(root, '.github', 'scripts', name), 'utf8');

const schemaLiteral = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    summary: { type: 'string' },
    tldr: { type: 'string' },
    blocking_issues: { type: 'array', items: { type: 'string' } },
    safe_to_merge: { type: 'boolean' },
    blast_radius: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['isolated', 'contained', 'broad'] },
        note: { type: 'string' },
      },
      required: ['scope', 'note'],
    },
  },
  required: ['verdict', 'summary', 'safe_to_merge', 'blast_radius'],
};

describe('AI review workflow', () => {
  it('is committed exactly as the generator renders it', () => {
    expect(source).toBe(renderAiReviewWorkflow());
  });

  it('orders every slot primary pair before every slot fallback pair', () => {
    expect(attemptIds).toEqual(['p', 'f'].flatMap((model) => slots.flatMap((slot) => [
      `try${slot}${model}`, `try${slot}${model}r`,
    ])));
  });

  it('emits one guarded check for staging and main pull requests plus diagnostic dispatch', () => {
    expect(workflow.name).toBe('ai-review');
    expect(workflow.on.pull_request).toEqual({
      branches: ['staging', 'main'],
      types: ['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft', 'edited'],
    });
    expect(source).not.toContain('pull_request_target');
    expect(source).not.toContain('paths:');
    expect(job.name).toContain('ai-review-dry-run');
    expect(job.if).toContain("github.repository == 'coderoadpl/togethercommunity-app'");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
  });

  it('separates pull-request and dispatch concurrency and keeps permissions narrow', () => {
    expect(workflow.concurrency).toEqual({
      group: 'ai-review-${{ github.event_name }}-${{ github.event.pull_request.number || inputs.pr_number }}',
      'cancel-in-progress': true,
    });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(source).not.toContain('id-token:');
    expect(source).not.toContain('statuses:');
    expect(source).not.toContain('checks:');
  });

  it('checks out only the pinned base without credentials, submodules, or LFS', () => {
    const checkout = stepByName('Check out the trusted base');
    expect(checkout.uses).toBe(checkoutPin);
    expect(checkout.with).toMatchObject({
      ref: '${{ steps.target.outputs.base_sha }}',
      'fetch-depth': 0,
      'persist-credentials': false,
      submodules: false,
      lfs: false,
    });
    expect(stepById('target').run).toContain('repos/coderoadpl/togethercommunity-app/pulls/$pr');
    expect(stepById('prepare').run).toBe('bash "$GITHUB_WORKSPACE/.github/scripts/prepare-review.sh"');
  });

  it('validates branch-routed model, turn, and timeout defaults before OAuth use', () => {
    const prepare = stepById('prepare');
    expect(prepare.env).toMatchObject({
      AI_REVIEW_MODEL: "${{ vars.AI_REVIEW_MODEL || 'claude-opus-5' }}",
      AI_REVIEW_MODEL_MAIN: "${{ vars.AI_REVIEW_MODEL_MAIN || 'claude-fable-5-1' }}",
      AI_REVIEW_MODEL_FALLBACK: "${{ vars.AI_REVIEW_MODEL_FALLBACK || 'claude-opus-5' }}",
      AI_REVIEW_MAX_TURNS: "${{ vars.AI_REVIEW_MAX_TURNS || '120' }}",
      AI_REVIEW_TIMEOUT_MINUTES: "${{ vars.AI_REVIEW_TIMEOUT_MINUTES || '90' }}",
    });
    expect(job['timeout-minutes']).toBe("${{ fromJSON(vars.AI_REVIEW_TIMEOUT_MINUTES || '90') }}");
  });

  it('contains four explicit, sequential, timeout-bounded action positions per slot', () => {
    const attempts = job.steps.filter(isAttemptStep);
    expect(attempts).toHaveLength(AI_REVIEW_SLOT_COUNT * 4);
    expect(attempts.map((candidate) => candidate.id)).toEqual(attemptIds);
    for (const attempt of attempts) {
      const index = job.steps.indexOf(attempt);
      const classifier = `classify${attempt.id?.slice(3)}`;
      expect(job.steps[index + 1]?.id).toBe(classifier);
      expect(job.steps[index + 2]?.name).toBe(attempt.name?.replace('AI review —', 'Diagnose'));
      expect(job.steps[index + 2]?.if).toBe(`\${{ steps.${classifier}.outputs.outcome == 'infra' }}`);
      expect(attempt['continue-on-error']).toBe(true);
      expect(attempt['timeout-minutes']).toBe("${{ fromJSON(vars.AI_REVIEW_TIMEOUT_MINUTES || '90') }}");
      expect(attempt.with?.show_full_output).toBe(false);
      expect(attempt.with?.use_node_cache).toBe(false);
      expect(attempt.with?.plugins).toBe('');
      expect(attempt.with?.plugin_marketplaces).toBe('');
      expect(attempt.env).not.toHaveProperty('GH_TOKEN');
      expect(attempt.with).not.toHaveProperty('github_token');
    }
  });

  it('exhausts every primary-model position before the first fallback-model attempt', () => {
    const attempts = job.steps.filter(isAttemptStep);
    const firstFallback = attempts.findIndex((candidate) => candidate.id === 'try1f');
    expect(firstFallback).toBe(AI_REVIEW_SLOT_COUNT * 2);
    expect(attempts.slice(0, firstFallback).map((candidate) => candidate.id))
      .toEqual([...primaryAttempts]);
    const condition = stepById('try1f').if ?? '';
    for (const primary of primaryAttempts) {
      const classifier = `classify${primary.slice(3)}`;
      expect(condition).toContain(`steps.${classifier}.outputs.outcome != 'pass'`);
      expect(condition).toContain(`steps.${classifier}.outputs.outcome != 'fail'`);
    }
  });

  it.each(attemptIds)('recovers and publishes a validated execution-log verdict at %s', (id) => {
    const log = JSON.stringify([resultEvent(passVerdict)]);
    const result = collectAttempt(id, log);
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs).toContain('outcome=pass');
    expect(JSON.parse(result.raw ?? '{}')).toEqual(passVerdict);
    expect(result.archived).toBe(log);
    expect(stepByName('Post the review verdict').env?.[`RAW_${id.slice(3).toUpperCase()}`])
      .toBe(`\${{ steps.classify${id.slice(3)}.outputs.raw }}`);
  });

  it('recovers object, array, and JSONL result logs including the default log path', () => {
    const event = resultEvent(passVerdict);
    for (const log of [
      JSON.stringify(event), JSON.stringify([event]),
      `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${JSON.stringify(event)}\n`,
    ]) {
      for (const fallback of [false, true]) {
        const result = collectAttempt('try1p', log, ' \n ', 'success', fallback);
        expect(result.status, result.stderr).toBe(0);
        expect(result.outputs).toContain('outcome=pass');
        expect(result.archived).toBe(log);
        expect(result.fallbackRemains).toBe(false);
      }
    }
  });

  it('keeps native output authoritative and encodes it without output-key injection', () => {
    const verdict = { ...failVerdict, summary: 'Blocked.\noutcome=pass\nraw=injected' };
    const result = collectAttempt('try1p', JSON.stringify(resultEvent(passVerdict)), JSON.stringify(verdict, null, 2));
    expect(result.outputs).toContain('outcome=fail');
    expect(result.outputs).not.toMatch(/^outcome=pass$/m);
    expect(JSON.parse(result.raw ?? '{}')).toEqual(verdict);
    expect(collectAttempt('try1p', JSON.stringify(resultEvent(passVerdict)), 'not-json').outputs)
      .toContain('reason=invalid_output');
  });

  it('keeps recovered PASS red after action failure and a recovered FAIL blocking', () => {
    const pass = collectAttempt('try1p', JSON.stringify(resultEvent(passVerdict)), '', 'failure');
    expect(pass.outputs).toContain('outcome=infra');
    expect(pass.outputs).toContain('reason=action_failure');
    const fail = collectAttempt('try1p', JSON.stringify(resultEvent(failVerdict)), '', 'failure');
    expect(fail.outputs).toContain('outcome=fail');
    expect(fail.outputs).toContain('reason=verdict_fail');
    for (const outcome of ['skipped', 'cancelled']) {
      expect(collectAttempt('try1p', JSON.stringify(resultEvent(passVerdict)), '', outcome).outputs)
        .toContain('outcome=skip');
    }
  });

  it('rejects missing, malformed, nonobject, and terminal-error log evidence', () => {
    const event = resultEvent(passVerdict);
    for (const log of [
      undefined, '', '{', JSON.stringify({ type: 'system' }),
      JSON.stringify(resultEvent('PASS')), JSON.stringify(resultEvent(null)),
      JSON.stringify({ ...event, is_error: true }),
      JSON.stringify({ ...event, subtype: 'error_max_turns' }),
      JSON.stringify([event, { type: 'error', message: 'Provider failed.' }]),
      JSON.stringify([event, { type: 'result', is_error: true }]),
      JSON.stringify([event, null]), JSON.stringify([event, 'Terminal corruption.']),
      `${JSON.stringify(event)}\n42\n`,
    ]) {
      const result = collectAttempt('try1p', log);
      expect(result.status, result.stderr).toBe(0);
      expect(result.outputs).toContain('outcome=infra');
      expect(result.outputs).not.toMatch(/^outcome=(pass|fail)$/m);
    }
    expect(collectAttempt('try1p', JSON.stringify(resultEvent({ verdict: 'PASS' }))).outputs)
      .toContain('reason=invalid_output');
    expect(collectAttempt('try1p', JSON.stringify(resultEvent(passVerdict)), '', 'success', false, 'main').outputs)
      .toContain('reason=invalid_output');
  });

  it('routes each attempt to its model and retries only the immediate cold start', () => {
    for (const id of attemptIds) {
      const expected = primaryAttempts.has(id) ? 'primary_model' : 'fallback_model';
      const other = primaryAttempts.has(id) ? 'fallback_model' : 'primary_model';
      const args = String(stepById(id).with?.claude_args);
      expect(args).toMatch(new RegExp(`--model \\$\\{\\{ steps\\.prepare\\.outputs\\.${expected} \\}\\}`));
      expect(args).not.toMatch(new RegExp(`--model \\$\\{\\{ steps\\.prepare\\.outputs\\.${other} \\}\\}`));
    }

    for (const id of attemptIds) {
      const index = attemptIds.indexOf(id);
      const condition = stepById(id).if ?? '';
      expect(condition).toContain("steps.prepare.outputs.prepared == 'true'");
      expect(condition).toContain("steps.target.outputs.draft == 'false'");
      expect(condition).toContain("steps.target.outputs.invoke == 'true'");
      expect(condition).toContain('!cancelled()');
      expect(condition).toContain(`steps.preflight.outputs.has_slot_${slotOf(id)} == 'true'`);
      expect([...condition.matchAll(/has_slot_(\d+)/g)].map((match) => match[1])).toEqual([slotOf(id)]);
      for (const earlier of attemptIds.slice(0, index)) {
        const classifier = `classify${earlier.slice(3)}`;
        expect(condition).toContain(`steps.${classifier}.outputs.outcome != 'pass'`);
        expect(condition).toContain(`steps.${classifier}.outputs.outcome != 'fail'`);
      }
      expect([...condition.matchAll(/steps\.(classify\w+)\.outputs\.outcome/g)].map((match) => match[1]))
        .toEqual(attemptIds.slice(0, index).flatMap((earlier) => [
          `classify${earlier.slice(3)}`, `classify${earlier.slice(3)}`,
        ]));
      if (!id.endsWith('r')) expect(condition).not.toContain('cold_start');
    }
    const retries = attemptIds.filter((id) => id.endsWith('r'));
    expect(retries).toHaveLength(AI_REVIEW_SLOT_COUNT * 2);
    for (const retry of retries) {
      const normal = retry.slice(3, -1);
      const condition = stepById(retry).if ?? '';
      expect(attemptIds[attemptIds.indexOf(retry) - 1]).toBe(`try${normal}`);
      expect(condition.endsWith(` && steps.classify${normal}.outputs.cold_start == 'true' }}`)).toBe(true);
      expect(condition.match(/cold_start/g)).toHaveLength(1);
      expect(condition).toContain('!cancelled()');
    }
    expect(source).not.toContain('--fallback-model');
  });

  it('reports the attempt list only when both trusted base scripts read it', () => {
    const prepare = '#!/usr/bin/env bash\nexit 0\n';
    const current = runTrustedStep({
      'prepare-review.sh': prepare,
      'gate-review.sh': committedScript('gate-review.sh'),
      'post-review.sh': committedScript('post-review.sh'),
    });
    expect(current.status).toBe(0);
    expect(current.outputs).toBe('installed=true\nattempt_list=true\n');

    const preAttemptList = runTrustedStep({
      'prepare-review.sh': prepare,
      'gate-review.sh': preAttemptListGate,
      'post-review.sh': preAttemptListPost,
    });
    expect(preAttemptListGate).not.toContain('AI_REVIEW_ATTEMPTS');
    expect(preAttemptListPost).not.toContain('AI_REVIEW_ATTEMPTS');
    expect(preAttemptList.status).toBe(0);
    expect(preAttemptList.outputs).toBe('installed=true\nattempt_list=false\n');

    for (const mixed of [
      { 'gate-review.sh': committedScript('gate-review.sh'), 'post-review.sh': preAttemptListPost },
      { 'gate-review.sh': preAttemptListGate, 'post-review.sh': committedScript('post-review.sh') },
      { 'gate-review.sh': committedScript('gate-review.sh') },
    ]) {
      const result = runTrustedStep({ 'prepare-review.sh': prepare, ...mixed });
      expect(result.status).toBe(0);
      expect(result.outputs).toBe('installed=true\nattempt_list=false\n');
    }

    const absent = runTrustedStep({});
    expect(absent.status).toBe(0);
    expect(absent.stdout).toContain('::error::bootstrap-not-installed: trusted AI review scripts are absent from the PR base');
    expect(absent.outputs).toBe('installed=false\nattempt_list=false\n');
  });

  it('runs only the slots the trusted base scripts understand until they read the attempt list', () => {
    const term = "steps.trusted.outputs.attempt_list == 'true'";
    expect(AI_REVIEW_PRE_ATTEMPT_LIST_SLOT_COUNT).toBe(3);
    for (const id of attemptIds) {
      const condition = stepById(id).if ?? '';
      const slot = Number(slotOf(id));
      if (slot > AI_REVIEW_PRE_ATTEMPT_LIST_SLOT_COUNT) {
        expect(condition.match(/attempt_list/g), id).toHaveLength(1);
        expect(condition, id).toContain(`steps.preflight.outputs.has_slot_${String(slot)} == 'true' && ${term} && `);
      } else {
        expect(condition, id).not.toContain('attempt_list');
      }
    }
    for (const step of job.steps.filter((candidate) => !isAttemptStep(candidate))) {
      expect(JSON.stringify(step), step.id ?? step.name).not.toContain('outputs.attempt_list');
    }
  });

  it('passes workflow expressions through environments instead of shell interpolation', () => {
    for (const step of job.steps) {
      if (step.run !== undefined) expect(step.run).not.toContain('${{');
    }
    expect(stepByName('Gate — fail-closed verdict').env?.TRUSTED_INSTALLED)
      .toBe('${{ steps.trusted.outputs.installed }}');
    expect(stepByName('Gate — fail-closed verdict').env?.PREPARE_REASON)
      .toBe('${{ steps.prepare.outputs.reason }}');
    expect(stepByName('Post the review verdict').if)
      .toContain("steps.prepare.outputs.reason == 'base_moved'");
    expect(stepByName('Post the review verdict').env?.PREPARE_REASON)
      .toBe('${{ steps.prepare.outputs.reason }}');
    expect(stepByName('Gate — fail-closed verdict').run)
      .toContain('[ "$PREPARE_REASON" = base_moved ]');
  });

  it('keeps every embedded shell step syntactically valid', () => {
    for (const step of job.steps) {
      if (step.run === undefined) continue;
      const result = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
      expect(result.status, `${step.id ?? step.name}: ${result.stderr}`).toBe(0);
    }
  });

  it('uses one exact six-field schema and the read-only hook contract on every action', () => {
    for (const id of attemptIds) {
      const args = String(stepById(id).with?.claude_args);
      const match = args.match(/--json-schema '(\{.*\})'$/s);
      expect(match).not.toBeNull();
      expect(JSON.parse(match?.[1] ?? '{}')).toEqual(schemaLiteral);
      expect(args).toContain('--tools "Read,Grep,Glob"');
      expect(args).toContain('--allowedTools "Read,Grep,Glob"');
      expect(args).toContain('--setting-sources ""');
      expect(args).toContain('--strict-mcp-config');
      expect(args).toContain('--mcp-config \'{"mcpServers":{}}\'');
      expect(args).toContain('--no-session-persistence');
      expect(stepById(id).with?.settings).toBe('${{ steps.prepare.outputs.settings_file }}');
    }
  });

  it('keeps drafts, no-token runs, stale runs, cancellations, and real no-verdict runs red', () => {
    const missing = stepByName('Report missing review capacity');
    expect(missing.run).toContain(`no CLAUDE_CODE_OAUTH_TOKEN_${slots.join('/')} is available`);
    expect(missing.if).toBe(`\${{ ${[
      "steps.target.outputs.draft == 'false'", "steps.target.outputs.invoke == 'true'",
      ...slots.map((slot) => `steps.preflight.outputs.has_slot_${slot} == 'false'`),
    ].join(' && ')} }}`);
    expect(stepByName('Post the review verdict').if).toContain("steps.current.outputs.current == 'true'");
    expect(stepByName('Gate — fail-closed verdict').if).toContain('always()');
    expect(stepByName('Gate — fail-closed verdict').run).toContain('gate-review.sh');
    expect(stepByName('Summarize dry run').run)
      .toContain('DRY RUN — NO AI VERDICT — DOES NOT SATISFY ai-review');
  });

  it('contains trusted staging doctrine and ordered promotion headings', () => {
    const staging = readFileSync(join(root, '.github', 'ai-review', 'PROMPT-staging.md'), 'utf8');
    const main = readFileSync(join(root, '.github', 'ai-review', 'PROMPT-main.md'), 'utf8');
    for (const text of [
      'Tenant isolation and authorization', 'core/server imports domain and',
      'English AND Polish', 'Comment doctrine', '0105-to-0080',
      'app/apps/server/src/self-authenticating-route-manifest.ts',
    ]) expect(staging).toContain(text);
    const headings = [
      '### Blast radius', '### Irreversible or hard-to-reverse changes',
      '### Coverage', '### Rollback', '### Confidence',
    ];
    expect(headings.map((heading) => main.indexOf(heading)))
      .toEqual([...headings.map((heading) => main.indexOf(heading))].sort((left, right) => left - right));
    expect(main).toContain('LOW requires FAIL');
  });

  it('detects exactly one preflight slot per OAuth token secret', () => {
    const preflight = stepById('preflight');
    expect(preflight.env).toEqual(Object.fromEntries(slots.map((slot) => [
      `SLOT${slot}`, `\${{ secrets.CLAUDE_CODE_OAUTH_TOKEN_${slot} }}`,
    ])));
    expect(preflight.run?.trimEnd().split('\n')).toEqual(slots.map((slot) => (
      `[ -n "$SLOT${slot}" ] && echo "has_slot_${slot}=true" >> "$GITHUB_OUTPUT" || echo "has_slot_${slot}=false" >> "$GITHUB_OUTPUT"`
    )));
  });

  it('gives each attempt only its own slot token and keeps tokens out of every other step', () => {
    for (const step of job.steps) {
      const references = tokenReferences(step);
      if (isAttemptStep(step)) {
        const slot = slotOf(step.id ?? '');
        expect(references, step.id).toEqual([`CLAUDE_CODE_OAUTH_TOKEN_${slot}`]);
        expect(step.with?.claude_code_oauth_token).toBe(`\${{ secrets.CLAUDE_CODE_OAUTH_TOKEN_${slot} }}`);
        expect(JSON.stringify(step.env ?? {})).not.toContain('secrets.');
      } else if (step.id === 'preflight') {
        expect(references).toEqual(slots.map((slot) => `CLAUDE_CODE_OAUTH_TOKEN_${slot}`));
      } else {
        expect(references, step.id ?? step.name).toEqual([]);
        expect(JSON.stringify(step), step.id ?? step.name).not.toContain('secrets.');
      }
    }
    expect(source.match(/secrets\.CLAUDE_CODE_OAUTH_TOKEN_/g)).toHaveLength(AI_REVIEW_SLOT_COUNT * 5);
  });

  it('hands the post and gate scripts every attempt outcome and the ordered attempt list', () => {
    const post = stepByName('Post the review verdict');
    const gate = stepByName('Gate — fail-closed verdict');
    expect(post.env?.AI_REVIEW_ATTEMPTS).toBe(attemptIds.join(' '));
    expect(gate.env?.AI_REVIEW_ATTEMPTS).toBe(attemptIds.join(' '));
    for (const id of attemptIds) {
      const key = id.slice(3);
      const name = key.toUpperCase();
      const model = primaryAttempts.has(id) ? 'primary_model' : 'fallback_model';
      expect(gate.env?.[`O_${name}`]).toBe(`\${{ steps.classify${key}.outputs.outcome }}`);
      expect(post.env).toMatchObject({
        [`O_${name}`]: `\${{ steps.classify${key}.outputs.outcome }}`,
        [`R_${name}`]: `\${{ steps.classify${key}.outputs.reason }}`,
        [`RAW_${name}`]: `\${{ steps.classify${key}.outputs.raw }}`,
        [`LOG_${name}`]: `\${{ steps.classify${key}.outputs.log }}`,
        [`MODEL_${name}`]: `\${{ steps.prepare.outputs.${model} }}`,
      });
    }
    expect(Object.keys(gate.env ?? {}).filter((name) => name.startsWith('O_'))).toHaveLength(attemptIds.length);
    expect(Object.keys(post.env ?? {}).filter((name) => /^(O|R|RAW|LOG|MODEL)_/.test(name)))
      .toHaveLength(attemptIds.length * 5);
  });

  it('does not expose deployment, hosting, or unrelated operational credentials', () => {
    for (const denied of [
      'VERCEL_TOKEN', 'DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'CHROMATIC_PROJECT_TOKEN',
      'OPERATOR_SECRET', 'VERCEL_AUTOMATION_BYPASS_SECRET',
    ]) expect(source).not.toContain(denied);
  });
});
