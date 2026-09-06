import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const workflowSchema = z.object({
  on: z.object({
    schedule: z.array(z.object({ cron: z.string() })),
  }),
  jobs: z.object({
    smoke: z.object({
      if: z.string(),
      env: z.record(z.string()),
      steps: z.array(z.object({
        name: z.string().optional(),
        if: z.string().optional(),
        env: z.record(z.string()).optional(),
        run: z.string().optional(),
        with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      })),
    }),
  }),
});

const workflow = workflowSchema.parse(parse(readFileSync(
  join(import.meta.dirname, '..', '..', '.github', 'workflows', 'staging-smoke.yml'),
  'utf8',
)));

const step = (name: string) => {
  const found = workflow.jobs.smoke.steps.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`staging-smoke has no step named "${name}"`);
  return found;
};

describe('staging-smoke workflow', () => {
  it('runs on a successful staging deployment however its environment is labelled', () => {
    const condition = workflow.jobs.smoke.if;

    expect(condition).toContain("github.event.deployment_status.state == 'success'");
    expect(condition)
      .toContain("startsWith(github.event.deployment_status.environment, 'Preview')");
    expect(condition).toContain("github.event.deployment_status.environment == 'staging'");
    expect(condition).toContain("github.event.deployment.ref == 'staging'");
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
  });

  it('also runs on a schedule, so a missing deployment event cannot silence it', () => {
    expect(workflow.on.schedule.map((entry) => entry.cron)).toEqual(['17 6 * * *']);
    expect(workflow.jobs.smoke.if).toContain("github.event_name == 'schedule'");
  });

  it('smokes the staging tenant host against both database fingerprints', () => {
    const env = workflow.jobs.smoke.env;

    expect(env['STAGING_BASE_URL'])
      .toContain('https://coderoad.staging.togethercommunity.app');
    expect(env['PRODUCTION_DATABASE_FINGERPRINT'])
      .toBe("${{ vars.PRODUCTION_DATABASE_FINGERPRINT || '4ef296aa90bd' }}");
    expect(env['STAGING_DATABASE_FINGERPRINT'])
      .toBe('${{ vars.STAGING_DATABASE_FINGERPRINT }}');
  });

  it('sends the protection bypass secret to the smoke only', () => {
    expect(step('Smoke the staging deployment').env?.['VERCEL_AUTOMATION_BYPASS_SECRET'])
      .toBe('${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}');
    expect(step('Smoke the staging deployment').run).toContain('pnpm run smoke:staging');
  });

  it('keeps the bypass secret away from a dispatched foreign host', () => {
    expect(workflow.jobs.smoke.env['STAGING_HOST_URL'])
      .toBe('https://coderoad.staging.togethercommunity.app');
    expect(step('Decide whether the smoke can run').run)
      .toContain('if [ "$STAGING_BASE_URL" != "$STAGING_HOST_URL" ]');
    expect(step('Smoke the staging deployment').if).toBe("steps.gate.outputs.run == 'true'");
  });

  it('skips with a notice instead of paging when the bypass secret is absent', () => {
    const gate = step('Decide whether the smoke can run');

    expect(gate.run).toContain('if [ -z "$VERCEL_AUTOMATION_BYPASS_SECRET" ]');
    expect(gate.run).toContain('::notice::');
    expect(gate.run).toContain('run=false');
    expect(step('Smoke the staging deployment').if).toBe("steps.gate.outputs.run == 'true'");
  });

  it('fails without paging while the staging fingerprint is unpinned', () => {
    expect(step('Smoke the staging deployment').run)
      .toContain("grep -q '^smoke:staging: unpinned=true' staging-smoke.log");
    expect(step('Send an SMS alert').if)
      .toBe("steps.smoke.outputs.failed == 'true' && steps.smoke.outputs.unpinned != 'true'");
    expect(step('Fail the run on a failing smoke').if)
      .toBe("steps.smoke.outputs.failed == 'true'");
  });

  it('pages the on-call number with the failing checks', () => {
    const alert = step('Send an SMS alert');

    expect(String(alert.with?.['message']))
      .toBe('Together STAGING smoke FAILED: ${{ steps.smoke.outputs.failing }}');
    expect(alert.with?.['aws-access-key-id']).toBe('${{ secrets.ALERT_AWS_ACCESS_KEY_ID }}');
    expect(alert.with?.['aws-secret-access-key'])
      .toBe('${{ secrets.ALERT_AWS_SECRET_ACCESS_KEY }}');
    expect(alert.with?.['phone-number']).toBe('${{ secrets.ALERT_SMS_PHONE }}');
  });
});
