import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { loadManifest } from '../scripts/dispatch-ci.js';

const githubDir = join(import.meta.dirname, '..', '..', '.github');
const read = (...segments: string[]): string => readFileSync(join(githubDir, ...segments), 'utf8');

const stepSchema = z.object({
  name: z.string().optional(),
  if: z.union([z.string(), z.boolean()]).optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(z.string()).optional(),
  with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const workflowSchema = z.object({
  jobs: z.record(z.object({
    services: z.unknown().optional(),
    env: z.record(z.string()).optional(),
    steps: z.array(stepSchema),
  }).passthrough()),
});

const actionSchema = z.object({
  inputs: z.record(z.object({ required: z.boolean().optional(), default: z.string().optional() })),
  runs: z.object({
    using: z.literal('composite'),
    steps: z.array(z.object({ uses: z.string().optional(), shell: z.string().optional(), env: z.record(z.string()), run: z.string() })),
  }),
});

const manifest = loadManifest();
const ci = workflowSchema.parse(parse(read('workflows', manifest.workflow)));
const action = actionSchema.parse(parse(read('actions', 'service-container', 'action.yml')));
const actionPath = './.github/actions/service-container';

const SERVICE_JOBS = [
  { job: 'check', service: 'postgres', port: '5432:5432', url: ['DATABASE_URL', 'localhost:5432'] },
  { job: 'smoke', service: 'postgres', port: '5432:5432', url: ['DATABASE_URL', 'localhost:5432'] },
  { job: 'e2e', service: 'postgres', port: '5432:5432', url: ['E2E_DATABASE_URL', 'localhost:5432'] },
  { job: 'telemetry-mongodb', service: 'mongodb', port: '27017:27017', url: ['MONGODB_TEST_URL', '127.0.0.1:27017'] },
] as const;

const jobOf = (id: string) => {
  const found = ci.jobs[id];
  if (found === undefined) throw new Error(`${manifest.workflow} has no job "${id}"`);
  return found;
};

const usesPnpmScript = (run: string | undefined): boolean =>
  run !== undefined && /\bpnpm (run|exec)\b/.test(run);

describe('service containers in ci.yml', () => {
  it('declares no job-level services, so no job can die before its first step on a registry error', () => {
    const withServices = Object.entries(ci.jobs).filter(([, entry]) => entry.services !== undefined).map(([id]) => id);

    expect(withServices).toEqual([]);
  });

  it('starts a service container only in the jobs that need a database', () => {
    const starters = Object.entries(ci.jobs)
      .filter(([, entry]) => entry.steps.some((step) => step.uses === actionPath))
      .map(([id]) => id);

    expect(starters.sort()).toEqual(SERVICE_JOBS.map((entry) => entry.job).sort());
  });

  it.each(SERVICE_JOBS)('starts $service in $job through the action before any step that uses it', ({ job, service, port, url }) => {
    const { steps, env } = jobOf(job);
    const index = steps.findIndex((step) => step.uses === actionPath);
    const start = steps[index];
    const nodeSetup = steps.findIndex((step) => step.uses?.startsWith('actions/setup-node@') === true);
    const firstScript = steps.findIndex((step) => usesPnpmScript(step.run));

    expect(steps.filter((step) => step.uses === actionPath)).toHaveLength(1);
    expect(start?.name).toBe(`${manifest.serviceContainerStepPrefix}: ${service}`);
    expect(start?.if).toBeUndefined();
    expect(start?.with?.['name']).toBe(service);
    expect(start?.with?.['port']).toBe(port);
    expect(nodeSetup).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(nodeSetup);
    expect(firstScript).toBeGreaterThan(index);

    const [variable, address] = url;
    const declared = env?.[variable] ?? steps.find((step) => step.env?.[variable] !== undefined)?.env?.[variable];
    expect(declared).toContain(address);
  });

  it('keeps the postgres credentials the jobs connect with', () => {
    for (const { job } of SERVICE_JOBS.filter((entry) => entry.service === 'postgres')) {
      const start = jobOf(job).steps.find((step) => step.uses === actionPath);

      expect(String(start?.with?.['container-env']).trim().split('\n')).toEqual([
        'POSTGRES_USER=together',
        'POSTGRES_PASSWORD=together',
        'POSTGRES_DB=together',
      ]);
      expect(start?.with?.['health-cmd']).toBe('pg_isready -U together');
    }
  });
});

describe('service-container composite action', () => {
  it('passes every input to the script through the environment, never through shell text', () => {
    const [step] = action.runs.steps;

    expect(action.runs.steps).toHaveLength(1);
    expect(step?.uses).toBeUndefined();
    expect(step?.run).toBe('node "$GITHUB_WORKSPACE/app/scripts/service-container.ts"');
    expect(step?.run).not.toContain('${{');
    expect(Object.values(step?.env ?? {}).sort())
      .toEqual(Object.keys(action.inputs).map((input) => `\${{ inputs.${input} }}`).sort());
  });

  it('requires the image, name, port and health command', () => {
    for (const input of ['name', 'image', 'port', 'health-cmd']) {
      expect(action.inputs[input]?.required).toBe(true);
    }
  });
});
