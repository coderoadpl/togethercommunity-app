import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const root = join(import.meta.dirname, '..', '..');
const scripts = join(root, '.github', 'scripts');
const validPass = JSON.stringify({
  verdict: 'PASS', summary: 'Reviewed.', blocking_issues: [], safe_to_merge: true,
  blast_radius: { scope: 'isolated', note: 'One leaf.' },
});
const validFail = JSON.stringify({
  verdict: 'FAIL', summary: 'Blocked.', blocking_issues: ['app/x.ts:1 violates the rule.'],
  safe_to_merge: false, blast_radius: { scope: 'contained', note: 'One feature.' },
});

const execute = (name: string, environment: NodeJS.ProcessEnv = {}) => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-test-'));
  const output = join(directory, 'output');
  const result = spawnSync('bash', [join(scripts, name)], {
    cwd: root,
    env: { ...process.env, GITHUB_OUTPUT: output, ...environment },
    encoding: 'utf8',
    timeout: 5_000,
  });
  const outputs = result.status === null || result.error !== undefined
    ? ''
    : (() => { try { return readFileSync(output, 'utf8'); } catch { return ''; } })();
  return { ...result, outputs, directory };
};

const writeExecutable = (path: string, body: string) => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

const outputValue = (output: string, name: string) => output.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1];

const classify = (raw: string, outcome = 'success', mode = 'staging', log?: unknown) => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-classify-'));
  const logPath = join(directory, 'execution.json');
  if (log !== undefined) writeFileSync(logPath, typeof log === 'string' ? log : JSON.stringify(log));
  return execute('classify-review.sh', {
    RAW: raw, TRY_OUTCOME: outcome, REVIEW_MODE: mode, EXEC_LOG: log === undefined ? '' : logPath,
  });
};

describe('AI review classifiers', () => {
  it.each([
    ['', 'empty_output'], ['   ', 'empty_output'], ['not-json', 'invalid_output'],
    ['[]', 'invalid_output'], ['1', 'invalid_output'], ['{}', 'invalid_output'],
    [JSON.stringify({ verdict: 'PASS' }), 'invalid_output'],
    [JSON.stringify({ ...JSON.parse(validPass), summary: 1 }), 'invalid_output'],
    [JSON.stringify({ ...JSON.parse(validPass), blocking_issues: [1] }), 'invalid_output'],
    [JSON.stringify({ ...JSON.parse(validPass), safe_to_merge: 'true' }), 'invalid_output'],
    [JSON.stringify({ ...JSON.parse(validPass), blast_radius: 'isolated' }), 'invalid_output'],
    [JSON.stringify({ ...JSON.parse(validPass), blast_radius: { scope: 'wide', note: 'x' } }), 'invalid_output'],
    [JSON.stringify({ ...JSON.parse(validPass), blast_radius: { scope: 'isolated', note: ' ' } }), 'invalid_output'],
    [JSON.stringify({ ...JSON.parse(validPass), blocking_issues: ['issue'] }), 'invalid_output'],
    [JSON.stringify({ ...JSON.parse(validFail), safe_to_merge: true }), 'invalid_output'],
  ])('rejects malformed or inconsistent output', (raw, reason) => {
    const result = classify(raw, 'success');
    expect(result.status).toBe(0);
    expect(result.outputs).toContain('outcome=infra');
    expect(result.outputs).toContain(`reason=${reason}`);
  });

  it('accepts only successful PASS while preserving a genuine FAIL from a failed action', () => {
    expect(classify(validPass).outputs).toContain('outcome=pass');
    expect(classify(validPass, 'failure').outputs).toContain('reason=action_failure');
    expect(classify(validFail, 'failure').outputs).toContain('outcome=fail');
    expect(classify(validFail, 'failure').outputs).toContain('reason=verdict_fail');
  });

  it('reports malformed nonempty output before a generic action failure', () => {
    const result = classify('not-json', 'failure');
    expect(result.outputs).toContain('outcome=infra');
    expect(result.outputs).toContain('reason=invalid_output');
  });

  it('treats tldr as optional but typed', () => {
    expect(classify(JSON.stringify({ ...JSON.parse(validPass), tldr: 'Short recap.' })).outputs)
      .toContain('outcome=pass');
    expect(classify(validPass).outputs).toContain('outcome=pass');
    expect(classify(JSON.stringify({ ...JSON.parse(validPass), tldr: 7 })).outputs)
      .toContain('reason=invalid_output');
  });

  it('distinguishes skipped and cancelled attempts', () => {
    expect(classify('', 'skipped').outputs).toContain('reason=not_attempted');
    expect(classify('', 'cancelled').outputs).toContain('reason=cancelled');
  });

  it('enforces the main report headings, order, confidence count, and LOW rule', () => {
    const summary = [
      '### Blast radius\nEvidence.',
      '### Irreversible or hard-to-reverse changes\nNone.',
      '### Coverage\nTests.',
      '### Rollback\nRevert.',
      '### Confidence\nConfidence: HIGH\nComplete.',
    ].join('\n');
    const high = JSON.stringify({ ...JSON.parse(validPass), summary });
    const low = JSON.stringify({ ...JSON.parse(validPass), summary: summary.replace('HIGH', 'LOW') });
    expect(classify(high, 'success', 'main').outputs).toContain('outcome=pass');
    expect(classify(low, 'success', 'main').outputs).toContain('outcome=infra');
    expect(classify(validPass, 'success', 'main').outputs).toContain('reason=invalid_output');
    expect(classify(JSON.stringify({ ...JSON.parse(validPass), summary: `${summary}\nConfidence: MEDIUM` }), 'success', 'main').outputs)
      .toContain('reason=invalid_output');
  });

  it.each([
    [{ type: 'error', error: { type: 'authentication_error', message: 'bad credential' } }, 'auth_rejected'],
    [{ type: 'result', is_error: true, total_cost_usd: 0, result: 'invalid bearer token' }, 'auth_rejected'],
    [{ type: 'error', status: 429, error: { message: 'capacity' } }, 'usage_limit'],
    [{ type: 'result', is_error: true, total_cost_usd: 0, result: 'insufficient credits' }, 'usage_limit'],
    [{ type: 'error', status: 404, error: { message: 'model claude-x not found' } }, 'model_unavailable'],
    [{ type: 'result', is_error: true, result: 'process timed out' }, 'timeout'],
  ])('classifies provider failures without treating them as cold starts', (event, reason) => {
    const result = classify('', 'failure', 'staging', event);
    expect(result.outputs).toContain(`reason=${reason}`);
    expect(result.outputs).toContain('cold_start=false');
  });

  it('recognizes only a proven zero-cost model-never-called result', () => {
    const cold = classify('', 'failure', 'staging', [
      { type: 'system', subtype: 'init', model: 'claude-opus-5' },
      { type: 'result', is_error: true, total_cost_usd: 0, result: 'startup failed' },
    ]);
    expect(cold.outputs).toContain('reason=cold_start');
    expect(cold.outputs).toContain('cold_start=true');
    const response = classify('', 'failure', 'staging', [
      { type: 'assistant', message: { model: 'claude-opus-5' } },
      { type: 'result', is_error: true, total_cost_usd: 0, usage: { cache_read_input_tokens: 5 }, result: 'failed' },
    ]);
    expect(response.outputs).not.toContain('reason=cold_start');
  });

  it('normalizes array, object, and JSONL logs in the standalone detector', () => {
    for (const body of [
      JSON.stringify([{ type: 'result', is_error: true, total_cost_usd: 0, result: 'startup' }]),
      JSON.stringify({ type: 'result', is_error: true, total_cost_usd: 0, result: 'startup' }),
      `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${JSON.stringify({ type: 'result', is_error: true, total_cost_usd: 0, result: 'startup' })}\n`,
    ]) {
      const directory = mkdtempSync(join(tmpdir(), 'ai-review-log-'));
      const log = join(directory, 'log.json');
      writeFileSync(log, body);
      expect(execute('detect-coldstart.sh', { EXEC_LOG: log }).outputs).toContain('cold_start=true');
    }
    expect(execute('detect-coldstart.sh', { EXEC_LOG: '/missing' }).outputs).toContain('cold_start=false');
  });

  it.each([
    ['malformed', '{'],
    ['no result', JSON.stringify({ type: 'system', subtype: 'init' })],
    ['non-error result', JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0 })],
    ['nonzero cost', JSON.stringify({ type: 'result', is_error: true, total_cost_usd: 0.01 })],
    ['missing cost', JSON.stringify({ type: 'result', is_error: true })],
    ['auth 401', JSON.stringify({ type: 'result', is_error: true, total_cost_usd: 0, result: '401 unauthorized' })],
    ['usage rejection', JSON.stringify({ type: 'result', is_error: true, total_cost_usd: 0, result: 'quota reached' })],
    ['model rejection', JSON.stringify({ type: 'error', status: 403, error: { message: 'model is not allowed' } })],
    ['assistant response', `${JSON.stringify({ type: 'assistant', message: { model: 'x' } })}\n${JSON.stringify({ type: 'result', is_error: true, total_cost_usd: 0 })}`],
    ['positive tokens', JSON.stringify({ type: 'result', is_error: true, total_cost_usd: 0, usage: { input_tokens: 1 } })],
  ])('does not cold-retry %s evidence', (_label, body) => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-review-not-cold-'));
    const log = join(directory, 'log.json');
    writeFileSync(log, body);
    expect(execute('detect-coldstart.sh', { EXEC_LOG: log }).outputs).toContain('cold_start=false');
  });

  it('classifies rejection evidence in array, object, and JSONL shapes', () => {
    expect(classify('', 'failure', 'staging', [{ type: 'error', status: 429 }]).outputs)
      .toContain('reason=usage_limit');
    expect(classify('', 'failure', 'staging', { type: 'error', error: { type: 'authentication_error' } }).outputs)
      .toContain('reason=auth_rejected');
    const jsonl = `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${JSON.stringify({ type: 'error', status: 404, message: 'model unavailable' })}\n`;
    expect(classify('', 'failure', 'staging', jsonl).outputs).toContain('reason=model_unavailable');
  });

  it('uses the standalone detector on the live classifier path', () => {
    expect(readFileSync(join(scripts, 'classify-review.sh'), 'utf8'))
      .toContain('detect-coldstart.sh" --check');
  });
});

describe('AI review gate and diagnostics', () => {
  const gate = (outcomes: NodeJS.ProcessEnv, preconditions: NodeJS.ProcessEnv = {}) => execute(
    'gate-review.sh',
    { PREPARED: 'true', CURRENT: 'true', DRAFT: 'false', ...preconditions, ...outcomes },
  );

  it('uses the constant pair order and accepts a later slot when slot 1 is absent', () => {
    expect(gate({ O_2P: 'pass' }).status).toBe(0);
    expect(gate({ O_1P: 'fail', O_1F: 'pass' }).status).toBe(1);
    expect(gate({ O_1P: 'infra', O_1F: 'pass' }).status).toBe(0);
  });

  it('accepts PASS and rejects FAIL at every literal ladder position', () => {
    for (const name of [
      'O_1P', 'O_1PR', 'O_1F', 'O_1FR', 'O_2P', 'O_2PR',
      'O_2F', 'O_2FR', 'O_3P', 'O_3PR', 'O_3F', 'O_3FR',
    ]) {
      expect(gate({ [name]: 'pass' }).status, name).toBe(0);
      expect(gate({ [name]: 'fail' }).status, name).toBe(1);
    }
  });

  it('fails all-infra, all-skip, draft, stale, and unprepared runs', () => {
    expect(gate({ O_1P: 'infra', O_3F: 'skip' }).status).toBe(1);
    expect(gate({ O_1P: 'skip', O_2P: 'skip' }).status).toBe(1);
    expect(gate({ O_1P: 'pass' }, { DRAFT: 'true' }).status).toBe(1);
    expect(gate({ O_1P: 'pass' }, { CURRENT: 'false' }).status).toBe(1);
    expect(gate({ O_1P: 'pass' }, { PREPARED: 'false' }).status).toBe(1);
  });

  it('prefixes every diagnostic line and redacts credential-shaped text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-review-reason-'));
    const log = join(directory, 'log.json');
    writeFileSync(log, `${JSON.stringify({ type: 'result', result: 'line one\n::error:: token=secret-value' })}\n`);
    const result = execute('failure-reason.sh', {
      EXEC_LOG: log, MODEL: 'claude-opus-5', SLOT: '1', ATTEMPT: 'try1p', REASON: 'action_failure',
    });
    expect(result.status).toBe(0);
    for (const line of result.stdout.trimEnd().split('\n')) expect(line).toMatch(/^  \| /);
    expect(result.stdout).not.toContain('secret-value');
  });

  it('normalizes array, object, and JSONL diagnostics', () => {
    for (const body of [
      JSON.stringify([{ type: 'result', result: 'array diagnostic' }]),
      JSON.stringify({ type: 'result', result: 'object diagnostic' }),
      `${JSON.stringify({ type: 'system' })}\n${JSON.stringify({ type: 'result', result: 'jsonl diagnostic' })}\n`,
    ]) {
      const directory = mkdtempSync(join(tmpdir(), 'ai-review-diagnostic-shape-'));
      const log = join(directory, 'log.json');
      writeFileSync(log, body);
      const result = execute('failure-reason.sh', { EXEC_LOG: log });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/diagnostic/);
    }
  });
});

const ladderStepSchema = z.object({
  id: z.string().optional(), if: z.string().optional(), run: z.string().optional(),
});
const ladderWorkflowSchema = z.object({
  jobs: z.object({ 'ai-review': z.object({ steps: z.array(ladderStepSchema) }) }),
});
const ladderWorkflow = ladderWorkflowSchema.parse(parse(
  readFileSync(join(root, '.github', 'workflows', 'ai-review.yml'), 'utf8'),
));
const ladderIds = [
  'try1p', 'try1pr', 'try1f', 'try1fr', 'try2p', 'try2pr',
  'try2f', 'try2fr', 'try3p', 'try3pr', 'try3f', 'try3fr',
];
type StubResult = { outcome: 'pass' | 'fail' | 'infra'; coldStart?: boolean; reason?: string };
type StepOutputs = Record<string, Record<string, string>>;

const evaluateAttempt = (expression: string, outputs: StepOutputs, cancelled: boolean) => {
  const body = expression.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return body.split(' && ').every((term) => {
    if (term === '!cancelled()') return !cancelled;
    const match = term.match(/^steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+) (==|!=) '([^']*)'$/);
    if (match === null) throw new Error(`Unsupported ladder condition: ${term}`);
    const [, stepName, outputName, operator, expected] = match;
    if (stepName === undefined || outputName === undefined || operator === undefined || expected === undefined) {
      throw new Error(`Incomplete ladder condition: ${term}`);
    }
    const actual = outputs[stepName]?.[outputName] ?? '';
    return operator === '==' ? actual === expected : actual !== expected;
  });
};

const simulateLadder = (
  slots: [boolean, boolean, boolean],
  results: Partial<Record<string, StubResult>>,
  cancelAfter = '',
  primaryModel = 'primary',
  fallbackModel = 'fallback',
) => {
  const outputs: StepOutputs = {
    prepare: { prepared: 'true' },
    target: { draft: 'false', invoke: 'true' },
    preflight: {
      has_slot_1: String(slots[0]), has_slot_2: String(slots[1]), has_slot_3: String(slots[2]),
    },
  };
  const calls: Array<{ id: string; model: string; reason: string }> = [];
  let cancelled = false;
  for (const id of ladderIds) {
    const step = ladderWorkflow.jobs['ai-review'].steps.find((candidate) => candidate.id === id);
    if (step?.if === undefined) throw new Error(`Missing ladder step ${id}`);
    const classifier = `classify${id.slice(3)}`;
    if (!evaluateAttempt(step.if, outputs, cancelled)) {
      outputs[classifier] = { outcome: 'skip', cold_start: 'false', reason: 'not_attempted' };
      continue;
    }
    const result = results[id] ?? { outcome: 'infra', reason: 'action_failure' };
    calls.push({
      id,
      model: id.includes('f') ? fallbackModel : primaryModel,
      reason: result.reason ?? result.outcome,
    });
    outputs[classifier] = {
      outcome: result.outcome,
      cold_start: String(result.coldStart ?? false),
      reason: result.reason ?? result.outcome,
    };
    if (cancelAfter === id) cancelled = true;
  }
  return calls;
};

describe('AI review attempt ladder', () => {
  it.each(['usage_limit', 'model_unavailable'])('moves %s to same-slot fallback before slot 2', (reason) => {
    const calls = simulateLadder([true, true, false], {
      try1p: { outcome: 'infra', reason },
      try1f: { outcome: 'pass' },
    });
    expect(calls.map(({ id }) => id)).toEqual(['try1p', 'try1f']);
  });

  it('keeps auth distinct and never cold-retries it', () => {
    const calls = simulateLadder([true, true, false], {
      try1p: { outcome: 'infra', reason: 'auth_rejected' },
      try1f: { outcome: 'pass' },
    });
    expect(calls).toEqual([
      { id: 'try1p', model: 'primary', reason: 'auth_rejected' },
      { id: 'try1f', model: 'fallback', reason: 'pass' },
    ]);
  });

  it('preserves the pair order when primary and fallback names are equal', () => {
    const calls = simulateLadder([true, false, false], {
      try1p: { outcome: 'infra', reason: 'usage_limit' },
      try1f: { outcome: 'fail' },
    }, '', 'claude-opus-5', 'claude-opus-5');
    expect(calls).toEqual([
      { id: 'try1p', model: 'claude-opus-5', reason: 'usage_limit' },
      { id: 'try1f', model: 'claude-opus-5', reason: 'fail' },
    ]);
  });

  it('keeps absent later slots silent and stops a known FAIL', () => {
    expect(simulateLadder([false, false, false], {}).map(({ id }) => id)).toEqual([]);
    expect(simulateLadder([true, false, false], {}).map(({ id }) => id)).toEqual(['try1p', 'try1f']);
    expect(simulateLadder([false, true, false], { try2p: { outcome: 'pass' } }).map(({ id }) => id))
      .toEqual(['try2p']);
    expect(simulateLadder([true, true, true], { try1p: { outcome: 'fail' } }).map(({ id }) => id))
      .toEqual(['try1p']);
  });

  it('cold-retries every pair exactly once, including slots 2 and 3', () => {
    const coldResults: Partial<Record<string, StubResult>> = {};
    for (const id of ladderIds) {
      coldResults[id] = { outcome: 'infra', coldStart: true, reason: 'cold_start' };
    }
    expect(simulateLadder([true, true, true], coldResults).map(({ id }) => id)).toEqual(ladderIds);
  });

  it('schedules nothing after cancellation', () => {
    expect(simulateLadder([true, true, true], {
      try1p: { outcome: 'infra', coldStart: true, reason: 'cold_start' },
    }, 'try1p').map(({ id }) => id)).toEqual(['try1p']);
  });

  it('clears a stale attempt log before classifying a missing current log', () => {
    const step = ladderWorkflow.jobs['ai-review'].steps.find((candidate) => candidate.id === 'classify2p');
    if (step?.run === undefined) {
      throw new Error('Missing classify2p run script');
    }
    const directory = mkdtempSync(join(tmpdir(), 'ai-review-stale-log-'));
    const destination = join(directory, 'attempt.json');
    const output = join(directory, 'output');
    writeFileSync(destination, JSON.stringify({
      type: 'error', error: { type: 'authentication_error', message: 'stale' },
    }));
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-c', step.run], {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_WORKSPACE: root,
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: directory,
        DEST_LOG: destination,
        OUTPUT_EXEC_FILE: '',
        RAW: '',
        TRY_OUTCOME: 'failure',
        REVIEW_MODE: 'staging',
      },
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('reason=empty_output');
    expect(readFileSync(output, 'utf8')).not.toContain('auth_rejected');
    expect(existsSync(destination)).toBe(false);
  });
});

describe('AI review tool policy', () => {
  const hook = (rootDirectory: string | undefined, payload: unknown | Buffer) => spawnSync(
    'bash', [join(scripts, 'review-tool-policy.sh')], {
      cwd: root, env: { ...process.env, AI_REVIEW_INPUT_ROOT: rootDirectory },
      input: Buffer.isBuffer(payload) ? payload : typeof payload === 'string' ? payload : JSON.stringify(payload),
      encoding: 'utf8', timeout: 5_000,
    },
  );

  it('allows structured output and normal reads under the inert root', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-review-hook-'));
    writeFileSync(join(directory, 'context.json'), '{}');
    expect(hook(directory, { tool_name: 'StructuredOutput', tool_input: {} }).status).toBe(0);
    expect(hook(directory, { tool_name: 'Read', tool_input: { file_path: 'context.json' } }).status).toBe(0);
    expect(hook(directory, { tool_name: 'Grep', tool_input: { pattern: 'x' } }).status).toBe(0);
    expect(hook(directory, { tool_name: 'Glob', tool_input: { pattern: '**/*.txt' } }).status).toBe(0);
  });

  it('denies malformed input, writes, traversal, absolute escapes, and symlink escapes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-review-hook-'));
    const symlink = join(directory, 'escape');
    spawnSync('ln', ['-s', '/etc', symlink]);
    expect(hook(directory, '{').status).toBe(2);
    expect(hook(directory, { tool_name: 'Write', tool_input: { file_path: 'x' } }).status).toBe(2);
    expect(hook(directory, { tool_name: 'Read', tool_input: { file_path: '../outside' } }).status).toBe(2);
    expect(hook(directory, { tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } }).status).toBe(2);
    expect(hook(directory, { tool_name: 'Read', tool_input: { file_path: join(symlink, 'passwd') } }).status).toBe(2);
    expect(hook(directory, { tool_name: 'Glob', tool_input: { pattern: '../*' } }).status).toBe(2);
  });

  it('fails closed when the root is absent or stdin is not UTF-8', () => {
    expect(hook(undefined, { tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } }).status).toBe(2);
    const directory = mkdtempSync(join(tmpdir(), 'ai-review-hook-'));
    expect(hook(directory, Buffer.from([0xff, 0xfe, 0xfd])).status).toBe(2);
  });
});

const makeGhStub = (directory: string) => {
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const stub = join(bin, 'gh');
  writeExecutable(stub, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GH_CALLS"
method=GET
for argument in "$@"; do
  case "$argument" in
    PATCH|POST) method="$argument" ;;
    body=@*) body_file="\${argument#body=@}" ;;
  esac
done
if [ "$method" = GET ]; then
  [ "\${GH_FAIL_GET:-false}" = true ] && exit 1
  cat "$GH_COMMENTS"
  exit 0
fi
[ "\${GH_FAIL_MUTATION:-false}" = true ] && exit 1
cp -- "$body_file" "$GH_BODY"
`);
  return bin;
};

const runPost = (environment: NodeJS.ProcessEnv, comments: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-post-'));
  const calls = join(directory, 'calls');
  const commentsFile = join(directory, 'comments.json');
  const body = join(directory, 'body.md');
  writeFileSync(calls, '');
  writeFileSync(commentsFile, comments);
  const bin = makeGhStub(directory);
  const result = execute('post-review.sh', {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    GH_CALLS: calls,
    GH_COMMENTS: commentsFile,
    GH_BODY: body,
    GITHUB_REPOSITORY: 'coderoadpl/togethercommunity-app',
    EVENT_NAME: 'pull_request',
    CURRENT: 'true',
    PR: '42',
    BASE_SHA: 'a'.repeat(40),
    HEAD_SHA: 'b'.repeat(40),
    RUN_URL: 'https://github.com/coderoadpl/togethercommunity-app/actions/runs/1',
    ...environment,
  });
  return {
    ...result,
    calls: readFileSync(calls, 'utf8'),
    body: existsSync(body) ? readFileSync(body, 'utf8') : '',
  };
};

const expectOrder = (body: string, markers: string[]) => {
  const positions = markers.map((marker) => {
    const index = body.indexOf(marker);
    expect(index, `missing rendered section: ${marker}`).toBeGreaterThan(-1);
    return index;
  });
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
};

const headedSummary = [
  '### Blast radius', 'Shared auth surface.', '',
  '### Coverage', 'Covered by tests.', '',
  '### Confidence', 'Confidence: HIGH',
].join('\n');

describe('AI review comment publication', () => {
  it('selects the latest paginated marker comment from github-actions[bot]', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-review-producer-'));
    const log = join(directory, 'execution.json');
    writeFileSync(log, JSON.stringify([
      { type: 'system', subtype: 'init', model: 'configured-model' },
      { type: 'assistant', message: { model: 'runtime-model' } },
      { type: 'result', num_turns: 4, usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 3 }, total_cost_usd: 0.25 },
    ]));
    const comments = [
      JSON.stringify([
        { id: 10, created_at: '2026-01-01T00:00:00Z', user: { login: 'github-actions[bot]' }, body: '<!-- ai-review-gate --> old' },
        { id: 11, created_at: '2026-01-03T00:00:00Z', user: { login: 'github-actions[bot]' }, body: 'unrelated last bot comment' },
      ]),
      JSON.stringify([
        { id: 12, created_at: '2026-01-04T00:00:00Z', user: { login: 'person' }, body: '<!-- ai-review-gate --> not the bot' },
        { id: 13, created_at: '2026-01-02T00:00:00Z', user: { login: 'github-actions[bot]' }, body: '<!-- ai-review-gate --> newest matching' },
      ]),
    ].join('\n');
    const result = runPost({
      O_2F: 'pass', RAW_2F: validPass, LOG_2F: log, MODEL_2F: 'configured-model',
    }, comments);
    expect(result.status).toBe(0);
    expect(result.calls).toContain('--paginate --method GET repos/coderoadpl/togethercommunity-app/issues/42/comments');
    expect(result.calls).toContain('--method PATCH repos/coderoadpl/togethercommunity-app/issues/comments/13');
    expect(result.calls).not.toContain('issues/comments/11');
    expect(result.body).toContain('Verdict produced by: `runtime-model` · token slot 2 · attempt `try2f` · requested `configured-model`');
    expect(result.body).toContain('input tokens 15');
    expect(result.body).toContain('API-equivalent cost $0.25');
    expect(result.body).not.toMatch(/billed|invoice/i);
  });

  it('creates a comment when no marker exists and labels an unreported runtime model', () => {
    const result = runPost({ O_1P: 'pass', RAW_1P: validPass, MODEL_1P: 'requested-model' }, JSON.stringify([
      { id: 20, created_at: '2026-01-01T00:00:00Z', user: { login: 'github-actions[bot]' }, body: 'another check' },
    ]));
    expect(result.status).toBe(0);
    expect(result.calls).toContain('--method POST repos/coderoadpl/togethercommunity-app/issues/42/comments');
    expect(result.body).toContain('`requested-model` (requested; runtime model unreported)');
  });

  it('does not call GitHub for dispatch or a stale target', () => {
    const dispatch = runPost({ EVENT_NAME: 'workflow_dispatch' }, '[]');
    const stale = runPost({ CURRENT: 'false' }, '[]');
    expect(dispatch.status).toBe(0);
    expect(dispatch.calls).toBe('');
    expect(stale.status).toBe(0);
    expect(stale.calls).toBe('');
  });

  it('surfaces API failures without changing an independently valid PASS gate', () => {
    const result = runPost({
      O_1P: 'pass', RAW_1P: validPass, MODEL_1P: 'model', GH_FAIL_MUTATION: 'true',
    }, '[]');
    expect(result.status).not.toBe(0);
    const gate = execute('gate-review.sh', {
      PREPARED: 'true', CURRENT: 'true', DRAFT: 'false', O_1P: 'pass',
    });
    expect(gate.status).toBe(0);
  });

  it('renders a headed PASS as verdict, TL;DR, then one collapsed block per heading', () => {
    const raw = JSON.stringify({
      ...JSON.parse(validPass),
      summary: headedSummary,
      tldr: 'Safe to merge. Auth paths were re-checked. Nothing irreversible.',
    });
    const result = runPost({ O_1P: 'pass', RAW_1P: raw, MODEL_1P: 'model' }, '[]');
    expect(result.status).toBe(0);
    expectOrder(result.body, [
      '<!-- ai-review-gate -->',
      '<sub>Base `',
      '## AI review: PASS',
      '**Safe to merge:** yes · **Blast radius:** isolated',
      '**TL;DR:** Safe to merge. Auth paths were re-checked. Nothing irreversible.',
      '<summary>Blast radius</summary>',
      '<summary>Coverage</summary>',
      '<summary>Confidence</summary>',
      '<summary>Run details</summary>',
    ]);
    expect(result.body).not.toContain('### Blast radius');
    expect(result.body).not.toContain('### Blocking issues');
    expect(result.body).not.toContain('<summary>Full report</summary>');
  });

  it('keeps blocking issues expanded above an unheaded report and the run footer', () => {
    const raw = JSON.stringify({ ...JSON.parse(validFail), tldr: 'One blocker remains.' });
    const result = runPost({ O_1P: 'fail', RAW_1P: raw, MODEL_1P: 'model' }, '[]');
    expect(result.status).toBe(0);
    expectOrder(result.body, [
      '## AI review: FAIL',
      '**Safe to merge:** no',
      '**TL;DR:** One blocker remains.',
      '### Blocking issues',
      '- app/x.ts:1 violates the rule.',
      '<summary>Full report</summary>',
      'Blocked.',
      '<summary>Run details</summary>',
      'Verdict produced by:',
    ]);
    expect(result.body).not.toContain('<summary>Blocking issues</summary>');
  });

  it('falls back to the first summary paragraph when a producer omits tldr', () => {
    const raw = JSON.stringify({ ...JSON.parse(validPass), summary: headedSummary });
    const result = runPost({ O_1P: 'pass', RAW_1P: raw, MODEL_1P: 'model' }, '[]');
    expect(result.status).toBe(0);
    expect(result.body).toContain('**TL;DR:** Shared auth surface.');
    expectOrder(result.body, [
      '**TL;DR:** Shared auth surface.',
      '<summary>Blast radius</summary>',
      '<summary>Run details</summary>',
    ]);
  });

  it('surfaces comment-list API failures and renders all no-verdict reasons', () => {
    const failed = runPost({ GH_FAIL_GET: 'true' }, '[]');
    expect(failed.status).not.toBe(0);
    const noVerdict = runPost({ R_1P: 'usage_limit', R_1F: 'auth_rejected' }, '[]');
    expect(noVerdict.body).toContain('NO VERDICT — infrastructure failure');
    expect(noVerdict.body).toContain('- try1p: usage_limit');
    expect(noVerdict.body).toContain('- try1f: auth_rejected');
    expect(noVerdict.body).toContain('Producer: none');
  });
});

const requiredDoctrine = [
  'FOUNDATION.md', 'architecture.md', 'CONTRIBUTING.md', 'app/CLAUDE.md',
  'app/core/CLAUDE.md', 'app/adapters/CLAUDE.md', 'app/apps/CLAUDE.md',
  'app/docs/architecture.md', 'app/docs/permission-table.md', 'app/docs/route-table.md',
  'app/docs/security.md', 'app/docs/deployment-risk-classes.md',
  'app/docs/deployment-environments.md', 'app/docs/go-live-checklist.md',
  'app/docs/visual-regression.md', 'app/docs/terminology-glossary.md',
  'app/eslint.config.js', 'app/.dependency-cruiser.cjs', 'app/package.json',
  'app/scripts/language-lint.ts', 'app/scripts/tenant-neutral-lint.ts',
  '.tenant-neutral-allow', 'app/scripts/tenant-scope-check.ts',
  'app/scripts/migration-lint.ts', 'app/config-regression/authorization.test.ts',
  'app/core/domain/authorization.ts', 'app/core/server/authorize.ts',
  'app/config-regression/public-surface.test.ts',
  'app/apps/server/src/public-route-manifest.ts',
  'app/apps/server/src/self-authenticating-route-manifest.ts',
];
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();

const runGit = (cwd: string, ...args: string[]) => {
  const result = spawnSync(realGit, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const writeFixtureFile = (repository: string, path: string, content: string | Buffer) => {
  const destination = join(repository, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
};

const changedEntryCount = (repository: string, base: string) => {
  const result = spawnSync(realGit, ['diff', '--name-status', '-z', base], { cwd: repository });
  if (result.status !== 0) throw new Error('Unable to count fixture changes');
  const tokens = result.stdout.toString('utf8').split('\0').filter((token) => token !== '');
  let count = 0;
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index];
    if (status === undefined) throw new Error('Malformed fixture name-status output');
    index += status.startsWith('R') || status.startsWith('C') ? 3 : 2;
    count += 1;
  }
  return count;
};

type PreparationFixture = {
  repository: string;
  baseRef: 'staging' | 'main';
  baseSha: string;
  headSha: string;
  headRef: string;
  mergeSha: string;
  sideSha: string;
  executionMarker: string;
};

const createPreparationFixture = (
  baseRef: 'staging' | 'main',
  totalChanges = 1,
  includeMerge = false,
): PreparationFixture => {
  const repository = mkdtempSync(join(tmpdir(), 'ai-review-repository-'));
  runGit(repository, 'init', '-b', 'main');
  runGit(repository, 'config', 'user.name', 'Fixture');
  runGit(repository, 'config', 'user.email', 'fixture@example.test');
  for (const path of requiredDoctrine) writeFixtureFile(repository, path, `${path}\n`);
  symlinkSync('CLAUDE.md', join(repository, 'app', 'AGENTS.md'));
  writeFixtureFile(repository, 'deleted.txt', 'delete me\n');
  writeFixtureFile(repository, 'rename-old.txt', 'rename me\n');
  runGit(repository, 'add', '-A');
  runGit(repository, 'commit', '-m', 'Base');
  const baseSha = runGit(repository, 'rev-parse', 'HEAD');

  let sideSha = '';
  if (baseRef === 'main') {
    runGit(repository, 'checkout', '-b', 'side');
    writeFixtureFile(repository, 'side.txt', 'not reachable from staging\n');
    runGit(repository, 'add', '-A');
    runGit(repository, 'commit', '-m', 'Side');
    sideSha = runGit(repository, 'rev-parse', 'HEAD');
    runGit(repository, 'checkout', 'main');
    runGit(repository, 'checkout', '-b', 'staging');
  } else {
    runGit(repository, 'checkout', '-b', 'staging');
  }

  const executionMarker = join(repository, 'UNTRUSTED_CODE_EXECUTED');
  let mergeSha = '';
  const headRef = baseRef === 'main' ? 'staging' : 'feature';
  if (baseRef === 'staging') runGit(repository, 'checkout', '-b', headRef);
  if (includeMerge) runGit(repository, 'checkout', '-b', 'feature-work');

  if (totalChanges === 383) {
    runGit(repository, 'mv', 'rename-old.txt', 'rename-new.txt');
    runGit(repository, 'rm', 'deleted.txt');
    writeFixtureFile(repository, 'binary.bin', Buffer.from([0, 255, 1, 254]));
    symlinkSync('FOUNDATION.md', join(repository, 'linked-doctrine'));
    writeFixtureFile(repository, '.claude/settings.json', '{"hooks":{"PreToolUse":"touch forbidden"}}\n');
    writeFixtureFile(repository, '.mcp.json', '{"mcpServers":{"hostile":{}}}\n');
    writeFixtureFile(repository, 'app/package.json', JSON.stringify({ scripts: { preinstall: `touch ${executionMarker}` } }));
    writeFixtureFile(repository, 'hostile-$(touch PWNED).txt', '::error:: should remain inert\n');
    writeFixtureFile(repository, 'workflow\n::warning::.txt', 'workflow command text\n');
  } else {
    writeFixtureFile(repository, 'changed.txt', 'changed\n');
  }

  if (includeMerge) {
    runGit(repository, 'add', '-A');
    runGit(repository, 'commit', '-m', 'Feature changes');
    runGit(repository, 'checkout', 'staging');
    runGit(repository, 'merge', '--no-ff', 'feature-work', '-m', 'Merge pull request #77 from fixture/feature-work');
    mergeSha = runGit(repository, 'rev-parse', 'HEAD');
    writeFixtureFile(repository, 'direct-commit.txt', 'direct\n');
  }

  runGit(repository, 'add', '-A');
  let currentCount = changedEntryCount(repository, baseSha);
  for (let index = currentCount; index < totalChanges; index += 1) {
    writeFixtureFile(repository, `bulk/file-${String(index).padStart(3, '0')}.txt`, `change ${index}\n`);
  }
  runGit(repository, 'add', '-A');
  currentCount = changedEntryCount(repository, baseSha);
  if (currentCount !== totalChanges) throw new Error(`Fixture has ${currentCount} changes, expected ${totalChanges}`);
  runGit(repository, 'add', '-A');
  runGit(repository, 'commit', '-m', includeMerge ? 'Direct release commit' : 'Head changes');
  const headSha = runGit(repository, 'rev-parse', 'HEAD');
  runGit(repository, 'update-ref', 'refs/pull/42/head', headSha);
  return { repository, baseRef, baseSha, headSha, headRef, mergeSha, sideSha, executionMarker };
};

const pullMetadata = (
  fixture: PreparationFixture,
  changes: { headRef?: string; headRepo?: string; headSha?: string; title?: string } = {},
) => ({
  number: 42,
  title: changes.title ?? 'Fixture review',
  body: 'Evidence only.',
  state: 'open',
  draft: false,
  base: {
    ref: fixture.baseRef,
    sha: fixture.baseSha,
    repo: { full_name: 'coderoadpl/togethercommunity-app' },
  },
  head: {
    ref: changes.headRef ?? fixture.headRef,
    sha: changes.headSha ?? fixture.headSha,
    repo: { full_name: changes.headRepo ?? 'coderoadpl/togethercommunity-app' },
  },
});

const runPreparation = (
  fixture: PreparationFixture,
  metadata = pullMetadata(fixture),
  options: {
    trustedRoot?: string;
    expectedHead?: string;
    candidate?: object;
    omitCandidate?: boolean;
    prepareMode?: 'prepare' | 'revalidate';
    environment?: NodeJS.ProcessEnv;
  } = {},
) => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-prepare-'));
  const bin = join(directory, 'bin');
  const responses = join(directory, 'responses');
  const runnerTemp = join(directory, 'runner');
  const output = join(directory, 'output');
  const ghCalls = join(directory, 'gh-calls');
  const gitCalls = join(directory, 'git-calls');
  mkdirSync(bin);
  mkdirSync(responses);
  mkdirSync(runnerTemp);
  writeFileSync(output, '');
  writeFileSync(ghCalls, '');
  writeFileSync(gitCalls, '');
  writeFileSync(join(responses, 'pr-42.json'), JSON.stringify(metadata));
  const candidate = options.candidate ?? {
    number: 77,
    title: 'Merged feature',
    body: 'Merged evidence.',
    merged_at: '2026-09-01T00:00:00Z',
    merge_commit_sha: fixture.mergeSha,
    base: { ref: 'staging' },
  };
  if (!options.omitCandidate) writeFileSync(join(responses, 'pr-77.json'), JSON.stringify(candidate));
  writeExecutable(join(bin, 'git'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GIT_STUB_CALLS"
rewritten=()
for argument in "$@"; do
  case "$argument" in
    https://github.com/coderoadpl/togethercommunity-app.git) rewritten+=("$FIXTURE_REPOSITORY") ;;
    protocol.file.allow=never) rewritten+=("protocol.file.allow=always") ;;
    *) rewritten+=("$argument") ;;
  esac
done
exec "$REAL_GIT" "\${rewritten[@]}"
`);
  writeExecutable(join(bin, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GH_STUB_CALLS"
endpoint="\${!#}"
number="\${endpoint##*/}"
response="$GH_RESPONSES/pr-$number.json"
[ -f "$response" ] || exit 1
cat "$response"
`);
  const inputRoot = join(runnerTemp, 'ai-review-input');
  const result = spawnSync('bash', [join(scripts, 'prepare-review.sh')], {
    cwd: fixture.repository,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      REAL_GIT: realGit,
      FIXTURE_REPOSITORY: fixture.repository,
      GIT_STUB_CALLS: gitCalls,
      GH_STUB_CALLS: ghCalls,
      GH_RESPONSES: responses,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: runnerTemp,
      INPUT_ROOT: inputRoot,
      TRUSTED_ROOT: options.trustedRoot ?? root,
      PR: '42',
      PREPARE_MODE: options.prepareMode ?? 'prepare',
      EXPECTED_BASE_SHA: fixture.baseSha,
      EXPECTED_HEAD_SHA: options.expectedHead ?? fixture.headSha,
      BASE_REF: fixture.baseRef,
      BASE_SHA: fixture.baseSha,
      HEAD_SHA: fixture.headSha,
      RUN_URL: 'https://github.com/coderoadpl/togethercommunity-app/actions/runs/42',
      ...options.environment,
    },
    encoding: 'utf8',
    timeout: 5_000,
  });
  return {
    ...result,
    output: readFileSync(output, 'utf8'),
    inputRoot,
    ghCalls: readFileSync(ghCalls, 'utf8'),
    gitCalls: readFileSync(gitCalls, 'utf8'),
  };
};

describe('AI review preparation', () => {
  it('routes staging and main to their configured primary models', () => {
    const staging = createPreparationFixture('staging');
    const configuredModels = {
      AI_REVIEW_MODEL: 'staging-primary',
      AI_REVIEW_MODEL_MAIN: 'main-primary',
      AI_REVIEW_MODEL_FALLBACK: 'shared-fallback',
    };
    const stagingResult = runPreparation(staging, pullMetadata(staging), { environment: configuredModels });
    expect(stagingResult.status, stagingResult.stderr).toBe(0);
    expect(outputValue(stagingResult.output, 'review_mode')).toBe('staging');
    expect(outputValue(stagingResult.output, 'primary_model')).toBe('staging-primary');
    expect(outputValue(stagingResult.output, 'fallback_model')).toBe('shared-fallback');

    const main = createPreparationFixture('main');
    const mainResult = runPreparation(main, pullMetadata(main), { environment: configuredModels });
    expect(mainResult.status, mainResult.stderr).toBe(0);
    expect(outputValue(mainResult.output, 'review_mode')).toBe('main');
    expect(outputValue(mainResult.output, 'primary_model')).toBe('main-primary');
    expect(outputValue(mainResult.output, 'fallback_model')).toBe('shared-fallback');
  });

  it('builds a compact, reconciling 383-file inventory with inert evidence', () => {
    const fixture = createPreparationFixture('main', 383, true);
    const result = runPreparation(fixture, pullMetadata(fixture, {
      title: '$(touch TITLE_EXECUTED)\n::error:: inert title',
    }));
    expect(result.status, result.stderr).toBe(0);
    const filesDocument = JSON.parse(readFileSync(join(result.inputRoot, 'files.json'), 'utf8'));
    const diffstat = JSON.parse(readFileSync(join(result.inputRoot, 'diffstat.json'), 'utf8'));
    const context = JSON.parse(readFileSync(join(result.inputRoot, 'context.json'), 'utf8'));
    const merged = JSON.parse(readFileSync(join(result.inputRoot, 'merged-prs.json'), 'utf8'));
    expect(filesDocument).not.toHaveProperty('snapshots');
    expect(filesDocument.base_decision_files).toEqual([]);
    expect(filesDocument.files).toHaveLength(383);
    expect(diffstat.total_files).toBe(383);
    expect(diffstat.files).toHaveLength(383);
    expect(Object.values(diffstat.areas).reduce((sum: number, value) => sum + Number(value), 0)).toBe(383);
    expect(filesDocument.files.every((entry: { id: number; patch: { file?: string } }) => (
      entry.id > 0 && (entry.patch.file === undefined || existsSync(join(result.inputRoot, entry.patch.file)))
    ))).toBe(true);
    expect(filesDocument.files.find((entry: { path: string }) => entry.path === 'binary.bin').head.kind).toBe('binary');
    expect(filesDocument.files.find((entry: { path: string }) => entry.path === 'linked-doctrine').head.kind).toBe('symlink');
    expect(filesDocument.files.find((entry: { path: string }) => entry.path === 'deleted.txt').head).toBeNull();
    expect(filesDocument.files.find((entry: { path: string }) => entry.path === 'rename-new.txt').source).toBe('rename-old.txt');
    expect(filesDocument.files.some((entry: { path: string }) => entry.path === 'hostile-$(touch PWNED).txt')).toBe(true);
    expect(filesDocument.files.some((entry: { path: string }) => entry.path === 'workflow\n::warning::.txt')).toBe(true);
    expect(existsSync(join(result.inputRoot, 'head', '.claude', 'settings.json.txt'))).toBe(true);
    expect(existsSync(join(result.inputRoot, 'head', '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(result.inputRoot, 'head', '.mcp.json.txt'))).toBe(true);
    expect(existsSync(join(result.inputRoot, 'head', 'app', 'package.json.txt'))).toBe(true);
    expect(context.title).toContain('::error:: inert title');
    expect(merged.merged_prs.map((entry: { number: number }) => entry.number)).toContain(77);
    expect(merged.direct_commits.length).toBeGreaterThan(0);
    expect(existsSync(fixture.executionMarker)).toBe(false);
    expect(existsSync(join(fixture.repository, 'PWNED'))).toBe(false);
    expect(result.gitCalls.match(/cat-file --batch/g)).toHaveLength(1);
    expect(result.gitCalls).not.toMatch(/cat-file blob/);
    expect(readFileSync(join(result.inputRoot, 'files.json'), 'utf8').length).toBeLessThan(300_000);
  });

  it('accepts staging fork metadata but rejects the wrong main promotion source', () => {
    const staging = createPreparationFixture('staging');
    const fork = runPreparation(staging, pullMetadata(staging, { headRepo: 'contributor/fork' }));
    expect(fork.status, fork.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(fork.inputRoot, 'context.json'), 'utf8')).fork).toBe(true);

    const main = createPreparationFixture('main');
    const wrongSource = runPreparation(main, pullMetadata(main, { headRef: 'release' }));
    expect(wrongSource.status).not.toBe(0);
    expect(wrongSource.stderr).toContain('Promotions must be same-repository staging to main');
    expect(wrongSource.gitCalls).not.toContain('fetch');
  });

  it('rejects malicious PR numbers, changed SHAs, missing trusted files, and unrelated histories', () => {
    const markerDirectory = mkdtempSync(join(tmpdir(), 'ai-review-number-'));
    const marker = join(markerDirectory, 'executed');
    const invalid = execute('prepare-review.sh', { PR: `42;touch ${marker}` });
    expect(invalid.status).not.toBe(0);
    expect(existsSync(marker)).toBe(false);

    const fixture = createPreparationFixture('staging');
    const changed = runPreparation(fixture, pullMetadata(fixture), { expectedHead: fixture.baseSha });
    expect(changed.status).not.toBe(0);
    expect(changed.stderr).toContain('PR head SHA changed before preparation');

    const revalidated = runPreparation(
      fixture,
      pullMetadata(fixture, { headSha: fixture.baseSha }),
      { prepareMode: 'revalidate' },
    );
    expect(revalidated.status, revalidated.stderr).toBe(0);
    expect(outputValue(revalidated.output, 'current')).toBe('false');

    const emptyTrusted = mkdtempSync(join(tmpdir(), 'ai-review-trusted-'));
    const missing = runPreparation(fixture, pullMetadata(fixture), { trustedRoot: emptyTrusted });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('bootstrap-not-installed');

    runGit(fixture.repository, 'checkout', '--orphan', 'disconnected');
    runGit(fixture.repository, 'read-tree', '--empty');
    runGit(fixture.repository, 'commit', '--allow-empty', '-m', 'Disconnected');
    const disconnectedSha = runGit(fixture.repository, 'rev-parse', 'HEAD');
    runGit(fixture.repository, 'update-ref', 'refs/pull/42/head', disconnectedSha);
    fixture.headSha = disconnectedSha;
    const disconnected = runPreparation(fixture, pullMetadata(fixture));
    expect(disconnected.status).not.toBe(0);
    expect(disconnected.stderr).toContain('No merge base exists');
  });

  it('records a successful API lookup with an unreachable merge separately from incompleteness', () => {
    const fixture = createPreparationFixture('main', 3, true);
    const result = runPreparation(fixture, pullMetadata(fixture), {
      candidate: {
        number: 77,
        title: 'Metadata points elsewhere',
        body: '',
        merged_at: '2026-09-01T00:00:00Z',
        merge_commit_sha: fixture.sideSha,
        base: { ref: 'staging' },
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const merged = JSON.parse(readFileSync(join(result.inputRoot, 'merged-prs.json'), 'utf8'));
    const context = JSON.parse(readFileSync(join(result.inputRoot, 'context.json'), 'utf8'));
    expect(merged.merged_prs).toEqual([]);
    expect(merged.unmatched_merges.some((entry: string) => entry.includes('#77'))).toBe(true);
    expect(merged.metadata_incomplete).toEqual([]);
    expect(context.completeness_errors).toEqual([]);
  });

  it('records a failed merged-PR GET as genuine incompleteness', () => {
    const fixture = createPreparationFixture('main', 3, true);
    const result = runPreparation(fixture, pullMetadata(fixture), {
      omitCandidate: true,
    });
    expect(result.status, result.stderr).toBe(0);
    const merged = JSON.parse(readFileSync(join(result.inputRoot, 'merged-prs.json'), 'utf8'));
    const context = JSON.parse(readFileSync(join(result.inputRoot, 'context.json'), 'utf8'));
    expect(merged.metadata_incomplete).toHaveLength(1);
    expect(context.completeness_errors).toEqual(['PR metadata unavailable for #77']);
  });
});

describe('AI review script wiring', () => {
  it('keeps the exact literal order and marker-aware paginated comment update', () => {
    const gate = readFileSync(join(scripts, 'gate-review.sh'), 'utf8');
    const post = readFileSync(join(scripts, 'post-review.sh'), 'utf8');
    const order = ['O_1P', 'O_1PR', 'O_1F', 'O_1FR', 'O_2P', 'O_2PR', 'O_2F', 'O_2FR', 'O_3P', 'O_3PR', 'O_3F', 'O_3FR'];
    expect(order.map((name) => gate.indexOf(name)))
      .toEqual([...order.map((name) => gate.indexOf(name))].sort((left, right) => left - right));
    expect(post).toContain('gh api --paginate');
    expect(post).toContain('github-actions[bot]');
    expect(post).toContain('<!-- ai-review-gate -->');
    expect(post).toContain('--method PATCH');
    expect(post).toContain('--method POST');
    expect(post).toContain('Verdict produced by:');
    expect(post).toContain('Producer: none');
  });

  it('keeps preparation pinned, inert, complete, and hostile-input aware', () => {
    const prepare = readFileSync(join(scripts, 'prepare-review.sh'), 'utf8');
    expect(prepare).toContain('https://github.com/coderoadpl/togethercommunity-app.git');
    expect(prepare).toContain('refs/ai-review/base');
    expect(prepare).toContain('refs/ai-review/head');
    expect(prepare).toContain('merge-base');
    expect(prepare).toContain('--name-status", "-z"');
    expect(prepare).toContain('--numstat", "-z"');
    expect(prepare).toContain('--no-ext-diff');
    expect(prepare).toContain('--no-textconv');
    expect(prepare).toContain('f"{path}.txt"');
    expect(prepare).toContain('Snapshot file/directory collision');
    expect(prepare).toContain('Symlink target:');
    expect(prepare).toContain('app/docs/decisions');
    expect(prepare).toContain('PROMPT-staging.md.txt');
    expect(prepare).toContain('"cat-file", "--batch"');
    expect(prepare).not.toContain('"cat-file", "blob"');
    expect(prepare).not.toContain('"snapshots": snapshots');
    expect(prepare).not.toContain('checkout ');
  });
});
