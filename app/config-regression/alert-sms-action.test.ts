import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const githubDir = join(import.meta.dirname, '..', '..', '.github');

const read = (...segments: string[]): string =>
  readFileSync(join(githubDir, ...segments), 'utf8');

const actionSchema = z.object({
  inputs: z.record(z.object({ required: z.boolean().optional(), default: z.string().optional() })),
  runs: z.object({
    steps: z.array(z.object({
      env: z.record(z.string()),
      run: z.string(),
    })),
  }),
});

const workflowSchema = z.object({
  jobs: z.record(z.object({
    steps: z.array(z.object({
      uses: z.string().optional(),
      with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    })),
  })),
});

const action = actionSchema.parse(parse(read('actions', 'alert-sms', 'action.yml')));
const guard = action.runs.steps[0];
if (guard === undefined) throw new Error('alert-sms declares no step');

const alertStepsOf = (workflow: string) =>
  Object.values(workflowSchema.parse(parse(read('workflows', workflow))).jobs)
    .flatMap((job) => job.steps)
    .filter((step) => step.uses === './.github/actions/alert-sms');

const SECRET_INPUTS = ['aws-access-key-id', 'aws-secret-access-key', 'phone-number'] as const;

describe('alert-sms composite action', () => {
  it('treats an alert as unsendable only when a credential it actually uses is empty', () => {
    const guarded = SECRET_INPUTS.map((input) => {
      const variable = Object.entries(guard.env)
        .find(([, expression]) => expression === `\${{ inputs.${input} }}`)?.[0];
      if (variable === undefined) throw new Error(`alert-sms does not read "${input}"`);
      return variable;
    });

    for (const variable of guarded) {
      expect(guard.run).toContain(`[ -z "$${variable}" ]`);
    }
    expect(guard.run).toContain('aws sns publish');
  });

  it('defaults the region rather than demanding a secret neither workflow holds', () => {
    expect(action.inputs['aws-region']?.default).toBe('eu-central-1');

    for (const workflow of ['prod-health.yml', 'prod-smoke.yml']) {
      for (const step of alertStepsOf(workflow)) {
        expect(step.with).not.toHaveProperty('aws-region');
      }
    }
  });

  it('pages from the smoke with the same credential set the health probe uses', () => {
    const inputsOf = (workflow: string) => alertStepsOf(workflow)
      .map((step) => SECRET_INPUTS.map((input) => `${input}=${String(step.with?.[input])}`).join(' '));

    const health = inputsOf('prod-health.yml');
    const smoke = inputsOf('prod-smoke.yml');

    expect(health.length).toBeGreaterThan(0);
    expect(smoke.length).toBeGreaterThan(0);
    expect(new Set([...health, ...smoke]).size).toBe(1);
  });
});
