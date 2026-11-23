import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { loadManifest } from '../scripts/dispatch-ci.js';

const stepSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  if: z.union([z.string(), z.boolean()]).optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(z.string()).optional(),
  with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const jobSchema = z.object({
  name: z.string().optional(),
  if: z.union([z.string(), z.boolean()]).optional(),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  'continue-on-error': z.boolean().optional(),
  'timeout-minutes': z.number().optional(),
  permissions: z.record(z.string()).optional(),
  outputs: z.record(z.string()).optional(),
  strategy: z.object({
    'fail-fast': z.boolean().optional(),
    matrix: z.record(z.unknown()),
  }).optional(),
  defaults: z.object({ run: z.object({ 'working-directory': z.string() }) }).optional(),
  steps: z.array(stepSchema),
}).passthrough();

const workflowSchema = z.object({
  on: z.unknown(),
  jobs: z.record(jobSchema),
}).passthrough();

const anyWorkflowSchema = z.object({
  jobs: z.record(z.object({ name: z.string().optional() }).passthrough()),
}).passthrough();

const workflowsDir = join(import.meta.dirname, '..', '..', '.github', 'workflows');
const manifest = loadManifest();
const ciText = readFileSync(join(workflowsDir, manifest.workflow), 'utf8');
const ci = workflowSchema.parse(parse(ciText));

const packageJson = z.object({ scripts: z.record(z.string()) }).parse(JSON.parse(readFileSync(
  join(import.meta.dirname, '..', 'package.json'),
  'utf8',
)));

const job = (id: string) => {
  const found = ci.jobs[id];
  if (found === undefined) throw new Error(`ci.yml has no job "${id}"`);
  return found;
};

const needsOf = (id: string): string[] => {
  const needs = job(id).needs;
  if (needs === undefined) return [];
  return typeof needs === 'string' ? [needs] : needs;
};

const plannedIds = manifest.jobs.map((entry) => entry.id);
const planOutput = (key: string): string => `needs.${manifest.planJob}.outputs.${key}`;
const pinned = /^[^@]+@[0-9a-f]{40}$/;

describe('dispatch-ci workflow binding', () => {
  it('declares exactly the plan job, the manifest jobs, the gate and the after-gate jobs', () => {
    expect(Object.keys(ci.jobs).sort()).toEqual(
      [manifest.planJob, ...plannedIds, manifest.gate, ...manifest.afterGate].sort(),
    );
    expect(Object.keys(ci.jobs)[0]).toBe(manifest.planJob);
  });

  it('triggers on pull requests and pushes for main and staging without filters', () => {
    expect(ci.on).toEqual({
      pull_request: { branches: ['main', 'staging'] },
      push: { branches: ['main', 'staging'] },
    });
    expect(ciText).not.toContain('pull_request_target');
    expect(ciText).not.toMatch(/paths(-ignore)?:|branches-ignore:/);
  });

  it('plans with plain node, without credentials or a dependency install', () => {
    const plan = job(manifest.planJob);

    expect(needsOf(manifest.planJob)).toEqual([]);
    expect(plan.if).toBeUndefined();
    expect(plan.permissions).toEqual({ contents: 'read' });
    expect(plan.defaults?.run['working-directory']).toBe('app');
    expect(plan.steps.map((step) => step.uses?.split('@')[0] ?? step.run)).toEqual([
      'actions/checkout',
      'actions/setup-node',
      'node scripts/dispatch-ci.ts plan',
    ]);
    expect(plan.steps[0]?.with?.['persist-credentials']).toBe(false);
    expect(plan.steps[1]?.with).toEqual({ 'node-version': 24 });
    expect(plan.steps[2]?.id).toBe('plan');
  });

  it('exposes the plan, one run flag per job and the matrix of each matrix job', () => {
    const expected: Record<string, string> = { plan: '${{ steps.plan.outputs.plan }}' };
    for (const entry of manifest.jobs) {
      expected[`run-${entry.id}`] = `\${{ steps.plan.outputs.run-${entry.id} }}`;
      if (entry.matrix !== null) expected[`matrix-${entry.id}`] = `\${{ steps.plan.outputs.matrix-${entry.id} }}`;
    }

    expect(job(manifest.planJob).outputs).toEqual(expected);
  });

  it.each(manifest.jobs)('runs $id only when the plan says so, with its manifest mode', (entry) => {
    const ciJob = job(entry.id);
    const runFlag = `${planOutput(`run-${entry.id}`)} == 'true'`;

    expect(needsOf(entry.id)).toEqual([manifest.planJob]);
    expect(ciJob['continue-on-error'] === true).toBe(entry.mode === 'advisory');
    if (entry.matrix === null) {
      expect(ciJob.if).toBe(runFlag);
      expect(ciJob.name).toBeUndefined();
      expect(ciJob.strategy).toBeUndefined();
      return;
    }
    expect(ciJob.if).toBe(`${runFlag} && ${planOutput(`matrix-${entry.id}`)} != '[]'`);
    expect(ciJob.name).toBe(`${entry.id} (\${{ matrix.suite }})`);
    expect(ciJob.strategy).toEqual({
      'fail-fast': false,
      matrix: { include: `\${{ fromJSON(${planOutput(`matrix-${entry.id}`)}) }}` },
    });
  });

  it('marks a job advisory in the manifest exactly when ci.yml lets it continue on error', () => {
    const advisory = manifest.jobs.filter((entry) => entry.mode === 'advisory').map((entry) => entry.id);
    const continueOnError = Object.entries(ci.jobs)
      .filter(([, entry]) => entry['continue-on-error'] === true)
      .map(([id]) => id);

    expect(advisory.length).toBeGreaterThan(0);
    expect(continueOnError.sort()).toEqual(advisory.sort());
  });

  it('starts Chrome in an e2e leg from the matrix browser flag', () => {
    const e2e = job('e2e');
    const chromeSteps = e2e.steps.filter((step) =>
      step.id === 'setup-chrome' || step.run === '"$CHROME_PATH" --version');

    expect(chromeSteps).toHaveLength(2);
    for (const step of chromeSteps) expect(step.if).toBe('matrix.browser');
    expect(ciText).not.toContain("matrix.suite == 'team-admins'");
  });

  it('runs every sub-gate of the check script as its own step, in order', () => {
    const chain = (packageJson.scripts['check'] ?? '').split(' && ');
    const steps = job('check').steps.filter((step) => step.name?.startsWith('pnpm run ') === true);

    expect(chain.length).toBeGreaterThan(1);
    expect(chain.every((command) => command.startsWith('pnpm run '))).toBe(true);
    expect(steps.map((step) => step.run)).toEqual(chain);
    expect(steps.map((step) => step.name)).toEqual(chain);
    expect(job('check').steps.some((step) => step.run === 'pnpm run check')).toBe(false);
  });

  it('runs the gate after every other job except the after-gate jobs', () => {
    const gate = job(manifest.gate);

    expect(gate.name).toBe(manifest.gate);
    expect(gate.if).toBe('always()');
    expect(needsOf(manifest.gate).sort()).toEqual([manifest.planJob, ...plannedIds].sort());
    expect(gate.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(gate['timeout-minutes']).toBeLessThanOrEqual(10);
    expect(gate.defaults?.run['working-directory']).toBe('app');
  });

  it('gates with plain node on a sparse checkout, passing needs and the plan through the environment', () => {
    const steps = job(manifest.gate).steps;
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@') === true);
    const gateStep = steps.at(-1);

    expect(checkout?.with?.['persist-credentials']).toBe(false);
    expect(checkout?.with?.['sparse-checkout-cone-mode']).toBe(false);
    expect(String(checkout?.with?.['sparse-checkout']).trim().split('\n').sort()).toEqual([
      'app/ci/dispatch-ci.manifest.json',
      'app/package.json',
      'app/scripts/dispatch-ci.ts',
    ]);
    expect(steps.some((step) => step.run?.includes('pnpm') === true)).toBe(false);
    expect(gateStep?.run).toBe('node scripts/dispatch-ci.ts gate');
    expect(gateStep?.env).toEqual({
      DISPATCH_CI_NEEDS: '${{ toJSON(needs) }}',
      DISPATCH_CI_PLAN: `\${{ ${planOutput('plan')} }}`,
      GITHUB_TOKEN: '${{ github.token }}',
    });
  });

  it.each(manifest.afterGate)('runs %s only after the gate succeeded', (id) => {
    const condition = String(job(id).if);

    expect(needsOf(id)).toEqual([manifest.gate]);
    expect(condition).toContain(`needs.${manifest.gate}.result == 'success'`);
    expect(condition).not.toContain('always()');
  });

  it('pins every action of the plan and gate jobs to a full commit SHA', () => {
    for (const id of [manifest.planJob, manifest.gate]) {
      for (const step of job(id).steps) {
        if (step.uses !== undefined) expect(step.uses).toMatch(pinned);
      }
    }
  });

  it('reports the gate name from exactly one job across every workflow file', () => {
    const producers = readdirSync(workflowsDir)
      .filter((file) => /\.ya?ml$/.test(file))
      .flatMap((file) => {
        const workflow = anyWorkflowSchema.parse(parse(readFileSync(join(workflowsDir, file), 'utf8')));
        return Object.entries(workflow.jobs)
          .filter(([id, entry]) => (entry.name ?? id).includes(manifest.gate))
          .map(([id]) => `${file}:${id}`);
      });

    expect(producers).toEqual([`${manifest.workflow}:${manifest.gate}`]);
  });
});
