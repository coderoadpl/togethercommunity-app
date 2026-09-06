import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const githubDir = join(import.meta.dirname, '..', '..', '.github');

const read = (...segments: string[]): string =>
  readFileSync(join(githubDir, ...segments), 'utf8');

const stepSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  if: z.string().optional(),
  uses: z.string().optional(),
  with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const actionSchema = z.object({
  inputs: z.record(z.object({ required: z.boolean().optional(), default: z.string().optional() })),
  outputs: z.record(z.object({ value: z.string() })),
  runs: z.object({ steps: z.array(stepSchema.extend({ run: z.string().optional() })) }),
});

const workflowSchema = z.object({
  permissions: z.record(z.string()),
  jobs: z.record(z.object({ steps: z.array(stepSchema) })),
});

const action = actionSchema.parse(parse(read('actions', 'alert-gate', 'action.yml')));

const MONITORS = [
  { workflow: 'prod-health.yml', environment: 'production' },
  { workflow: 'prod-smoke.yml', environment: 'production' },
  { workflow: 'staging-smoke.yml', environment: 'staging' },
] as const;

const monitors = MONITORS.map(({ workflow, environment }) => {
  const parsed = workflowSchema.parse(parse(read('workflows', workflow)));
  const steps = Object.values(parsed.jobs).flatMap((job) => job.steps);
  return {
    workflow,
    environment,
    permissions: parsed.permissions,
    steps,
    gates: steps.filter((step) => step.uses === './.github/actions/alert-gate'),
    alerts: steps.filter((step) => step.uses === './.github/actions/alert-sms'),
  };
});

describe('alert-gate composite action', () => {
  it('decides from the previous completed run and the failing set, and records the next state', () => {
    const [previous, decide, record] = action.runs.steps.slice(1);

    expect(previous?.run).toContain('actions/workflows/$MONITOR/runs?$query');
    expect(previous?.run).toContain('status=completed&per_page=1');
    expect(previous?.run).toContain('actions/artifacts?name=$artifact');
    expect(decide?.run).toContain('app/scripts/alert-gate.ts');
    expect(record?.uses).toContain('actions/upload-artifact@');
    expect(record?.with?.['overwrite']).toBe(true);
    expect(Object.keys(action.outputs))
      .toEqual(['should_page', 'recovered', 'observe_only', 'pageable', 'reason']);
  });

  it('keys its recorded state by monitor and environment', () => {
    const previous = action.runs.steps[1];

    expect(previous?.run).toContain('artifact="alert-gate-${MONITOR%.yml}-$ENVIRONMENT"');
    for (const input of ['monitor', 'environment', 'github-token']) {
      expect(action.inputs[input]?.required).toBe(true);
    }
  });

  it.each(monitors)('routes every page of $workflow through the gate', (monitor) => {
    expect(monitor.gates).toHaveLength(1);
    expect(monitor.gates[0]?.with).toMatchObject({
      monitor: monitor.workflow,
      environment: monitor.environment,
      'github-token': '${{ github.token }}',
    });
    expect(monitor.permissions['actions']).toBe('read');

    for (const alert of monitor.alerts) {
      expect(alert.if ?? '')
        .toMatch(/steps\.alert\.outputs\.(should_page|recovered) == 'true'|inputs\.test_sms/);
    }
  });

  it.each(monitors)('lets $workflow announce its own recovery', (monitor) => {
    const recovery = monitor.alerts
      .filter((alert) => (alert.if ?? '').includes("steps.alert.outputs.recovered == 'true'"));

    expect(recovery).toHaveLength(1);
    expect(String(recovery[0]?.with?.['message'])).toContain('RECOVERED');
  });
});
