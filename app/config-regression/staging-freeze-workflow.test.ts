import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const stepSchema = z.object({
  name: z.string().optional(),
  uses: z.string().optional(),
  env: z.record(z.string()).optional(),
  run: z.string().optional(),
});

const workflowSchema = z.object({
  name: z.string(),
  permissions: z.record(z.string()),
  on: z.object({
    pull_request: z.object({
      branches: z.array(z.string()),
      types: z.array(z.string()),
    }),
    workflow_dispatch: z.null(),
    repository_dispatch: z.object({
      types: z.array(z.string()),
    }),
  }),
  jobs: z.record(z.object({
    'runs-on': z.string(),
    'timeout-minutes': z.number(),
    steps: z.array(stepSchema),
  })),
});

const workflow = workflowSchema.parse(parse(readFileSync(
  join(import.meta.dirname, '..', '..', '.github', 'workflows', 'staging-freeze.yml'),
  'utf8',
)));

const job = workflow.jobs['staging-freeze'];
if (job === undefined) throw new Error('staging-freeze workflow has no staging-freeze job');

const step = (name: string) => {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`staging-freeze has no step named "${name}"`);
  return found;
};

describe('staging-freeze workflow', () => {
  it('guards pull requests whose base branch is staging', () => {
    expect(workflow.name).toBe('staging-freeze');
    expect(workflow.on.pull_request.branches).toEqual(['staging']);
    expect(workflow.on.pull_request.types)
      .toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review']);
  });

  it('can be re-run manually or by a staging-unfreeze repository dispatch', () => {
    expect(workflow.on.workflow_dispatch).toBeNull();
    expect(workflow.on.repository_dispatch.types).toEqual(['staging-unfreeze']);
  });

  it('exposes the required staging-freeze job with read-only contents permission', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['staging-freeze']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job['runs-on']).toBe('ubuntu-24.04');
  });

  it('fails only when STAGING_FREEZE is true', () => {
    const check = step('Check staging freeze');
    const run = check.run ?? '';

    expect(check.uses).toBeUndefined();
    expect(check.env?.['STAGING_FREEZE']).toBe('${{ vars.STAGING_FREEZE }}');
    expect(run).toContain('if [ "$STAGING_FREEZE" = "true" ]');
    expect(run).toContain('::error::staging is frozen for a promotion (STAGING_FREEZE=true); merges resume when the variable is cleared');
    expect(run).toContain('exit 1');
    expect(run).toContain('echo "staging open"');
  });

  it('does not check out repository contents', () => {
    expect(job.steps.some((candidate) => candidate.uses?.startsWith('actions/checkout'))).toBe(false);
  });
});
