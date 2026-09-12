import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const stepSchema = z.object({
  name: z.string().optional(),
  if: z.string().optional(),
  shell: z.string().optional(),
  uses: z.string().optional(),
  env: z.record(z.string()).optional(),
  run: z.string().optional(),
  with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const driftWorkflowSchema = z.object({
  name: z.string(),
  on: z.object({
    schedule: z.array(z.object({ cron: z.string() })),
    workflow_dispatch: z.null(),
  }).strict(),
  permissions: z.record(z.string()),
  concurrency: z.object({ group: z.string(), 'cancel-in-progress': z.boolean() }),
  jobs: z.object({
    'rulesets-drift': z.object({
      'timeout-minutes': z.number(),
      defaults: z.object({ run: z.object({ 'working-directory': z.string() }) }),
      steps: z.array(stepSchema),
    }),
  }).strict(),
});

const ciWorkflowSchema = z.object({
  jobs: z.object({
    check: z.object({ steps: z.array(stepSchema) }),
  }).passthrough(),
});

const workflowsDir = join(import.meta.dirname, '..', '..', '.github', 'workflows');
const readWorkflow = (file: string): unknown =>
  parse(readFileSync(join(workflowsDir, file), 'utf8'));

const workflow = driftWorkflowSchema.parse(readWorkflow('rulesets-drift.yml'));
const job = workflow.jobs['rulesets-drift'];
const ci = ciWorkflowSchema.parse(readWorkflow('ci.yml'));

const packageJson: { scripts: Record<string, string> } = JSON.parse(readFileSync(
  join(import.meta.dirname, '..', 'package.json'),
  'utf8',
));

const ciDriftStep = ci.jobs.check.steps.find(
  (step) => step.name === 'Check branch ruleset drift after workflow changes',
);

describe('rulesets-drift workflow', () => {
  it('runs daily on an off-minute cron and on demand, and never on a push', () => {
    expect(workflow.on.schedule.map((entry) => entry.cron)).toEqual(['43 5 * * *']);
    expect(Object.keys(workflow.on)).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.concurrency)
      .toEqual({ group: 'rulesets-drift', 'cancel-in-progress': false });
    expect(job['timeout-minutes']).toBeLessThanOrEqual(10);
  });

  it('keeps the token scope at the issue-writing minimum', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  it('reconciles the drift issue with the repository token', () => {
    const step = job.steps.at(-1);

    expect(step?.run).toBe('pnpm run rulesets-drift -- --update-issue');
    expect(step?.env).toEqual({ GITHUB_TOKEN: '${{ github.token }}' });
    expect(job.defaults.run['working-directory']).toBe('app');
    expect(packageJson.scripts['rulesets-drift']).toBe('tsx scripts/rulesets-drift.ts');
  });

  it('checks out without persisting credentials', () => {
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@') === true);

    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('gates the pull-request run on a workflow change without masking a git failure', () => {
    expect(ciDriftStep?.if).toBe("github.event_name == 'pull_request'");
    expect(ciDriftStep?.shell).toBe('bash');
    expect(ciDriftStep?.env).toEqual({
      BASE_SHA: '${{ github.event.pull_request.base.sha }}',
      GITHUB_TOKEN: '${{ github.token }}',
    });
    expect(ciDriftStep?.run).toContain(
      'changed="$(git -C .. diff --name-only "$BASE_SHA" HEAD -- .github/workflows/)"',
    );
    expect(ciDriftStep?.run).not.toContain('grep -q .');
    expect(ciDriftStep?.run).toContain('pnpm run rulesets-drift');
  });
});
