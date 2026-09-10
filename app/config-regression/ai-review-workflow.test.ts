import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

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

const actionPin = 'anthropics/claude-code-action/base-action@44423bdec74b97d67543eb16c110546762c110b2';
const checkoutPin = 'actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955';
const attemptIds = [
  'try1p', 'try1pr', 'try1f', 'try1fr',
  'try2p', 'try2pr', 'try2f', 'try2fr',
  'try3p', 'try3pr', 'try3f', 'try3fr',
];
const primaryAttempts = new Set(['try1p', 'try1pr', 'try2p', 'try2pr', 'try3p', 'try3pr']);

const schemaLiteral = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    summary: { type: 'string' },
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

  it('contains twelve explicit, sequential, timeout-bounded action positions', () => {
    const attempts = job.steps.filter((candidate) => candidate.uses === actionPin);
    expect(attempts.map((candidate) => candidate.id)).toEqual(attemptIds);
    for (const attempt of attempts) {
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

  it('routes primary then fallback on each token and retries only the immediate cold start', () => {
    for (const id of attemptIds) {
      const expected = primaryAttempts.has(id) ? 'primary_model' : 'fallback_model';
      const other = primaryAttempts.has(id) ? 'fallback_model' : 'primary_model';
      const args = String(stepById(id).with?.claude_args);
      expect(args).toMatch(new RegExp(`--model \\$\\{\\{ steps\\.prepare\\.outputs\\.${expected} \\}\\}`));
      expect(args).not.toMatch(new RegExp(`--model \\$\\{\\{ steps\\.prepare\\.outputs\\.${other} \\}\\}`));
    }

    const normalAttempts = ['try1f', 'try2p', 'try2f', 'try3p', 'try3f'];
    for (const id of normalAttempts) {
      const index = attemptIds.indexOf(id);
      const condition = stepById(id).if ?? '';
      for (const earlier of attemptIds.slice(0, index)) {
        const classifier = `classify${earlier.slice(3)}`;
        expect(condition).toContain(`steps.${classifier}.outputs.outcome != 'pass'`);
        expect(condition).toContain(`steps.${classifier}.outputs.outcome != 'fail'`);
      }
    }
    for (const retry of ['1pr', '1fr', '2pr', '2fr', '3pr', '3fr']) {
      const normal = retry.slice(0, -1);
      const condition = stepById(`try${retry}`).if ?? '';
      expect(condition).toContain(`steps.classify${normal}.outputs.cold_start == 'true'`);
      expect(condition).toContain('!cancelled()');
    }
    expect(source).not.toContain('--fallback-model');
  });

  it('passes workflow expressions through environments instead of shell interpolation', () => {
    for (const step of job.steps) {
      if (step.run !== undefined) expect(step.run).not.toContain('${{');
    }
    expect(stepByName('Gate — fail-closed verdict').env?.TRUSTED_INSTALLED)
      .toBe('${{ steps.trusted.outputs.installed }}');
  });

  it('keeps every embedded shell step syntactically valid', () => {
    for (const step of job.steps) {
      if (step.run === undefined) continue;
      const result = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
      expect(result.status, `${step.id ?? step.name}: ${result.stderr}`).toBe(0);
    }
  });

  it('uses one exact five-field schema and the read-only hook contract on every action', () => {
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
    expect(stepByName('Report missing review capacity').run)
      .toContain('no CLAUDE_CODE_OAUTH_TOKEN_1/2/3 is available');
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

  it('does not expose deployment, hosting, or unrelated operational credentials', () => {
    for (const denied of [
      'VERCEL_TOKEN', 'DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'CHROMATIC_PROJECT_TOKEN',
      'OPERATOR_SECRET', 'VERCEL_AUTOMATION_BYPASS_SECRET',
    ]) expect(source).not.toContain(denied);
  });
});
