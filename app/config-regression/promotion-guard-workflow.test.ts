import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const workflowSchema = z.object({
  permissions: z.record(z.string()),
  on: z.object({
    pull_request: z.object({
      types: z.array(z.string()),
      branches: z.array(z.string()),
    }),
  }),
  jobs: z.object({
    'promotion-guard': z.object({
      name: z.string(),
      steps: z.array(z.object({
        name: z.string().optional(),
        uses: z.string().optional(),
        run: z.string().optional(),
        env: z.record(z.string()).optional(),
        with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      })),
    }),
  }),
  concurrency: z.object({
    group: z.string(),
    'cancel-in-progress': z.boolean(),
  }),
});

const workflowPath = join(import.meta.dirname, '..', '..', '.github', 'workflows', 'promotion-guard.yml');
const workflowText = readFileSync(workflowPath, 'utf8');
const workflow = workflowSchema.parse(parse(workflowText));
const scriptText = readFileSync(join(import.meta.dirname, '..', 'scripts', 'promotion-guard.ts'), 'utf8');
const job = workflow.jobs['promotion-guard'];

const step = (name: string) => {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`promotion-guard has no step named "${name}"`);
  return found;
};

describe('promotion guard workflow', () => {
  it('runs only for pull requests targeting main', () => {
    expect(workflow.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened']);
    expect(workflow.on.pull_request.branches).toEqual(['main']);
  });

  it('has the permissions needed to read checks and upsert one PR comment', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
      actions: 'read',
    });
  });

  it('serializes runs for the same promotion pull request', () => {
    expect(workflow.concurrency).toEqual({
      group: 'promotion-guard-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    });
  });

  it('checks out full history without persisted credentials', () => {
    const checkout = job.steps.find((candidate) => candidate.uses?.startsWith('actions/checkout@') ?? false);

    expect(checkout?.with).toMatchObject({
      'fetch-depth': 0,
      'persist-credentials': false,
    });
  });

  it('runs the testable TypeScript guard with the PR identity in env', () => {
    const guard = step('Run the promotion guard');

    expect(guard.run).toBe('pnpm exec tsx scripts/promotion-guard.ts');
    expect(guard.env).toMatchObject({
      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      PR_NUMBER: '${{ github.event.pull_request.number }}',
      HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
      HEAD_REF: '${{ github.head_ref }}',
      REPO: '${{ github.repository }}',
      STAGING_FREEZE: '${{ vars.STAGING_FREEZE }}',
    });
  });

  it('keeps the three promotion checks in the script', () => {
    expect(scriptText).toContain("message: 'promotions are pull requests from the staging branch itself'");
    expect(scriptText).toContain("message: 'staging moved on; wait for the freeze and re-run'");
    expect(scriptText).toContain("message: 'freeze staging first (STAGING_FREEZE=true) so auto-merge cannot move the tip during the promotion'");
    expect(scriptText).toContain("git(['rev-parse', 'origin/staging'])");
    expect(scriptText).toContain("['ci.yml', 'staging-smoke.yml']");
  });
});
