import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { API_PATHS } from '#core/contract/index.js';

const workflowSchema = z.object({
  permissions: z.record(z.string()).optional(),
  on: z.object({
    push: z.object({ branches: z.array(z.string()) }),
    schedule: z.array(z.object({ cron: z.string() })),
    workflow_dispatch: z.object({
      inputs: z.record(z.object({ description: z.string(), default: z.string() })),
    }),
  }),
  concurrency: z.object({ group: z.string(), 'cancel-in-progress': z.boolean() }),
  jobs: z.object({
    smoke: z.object({
      if: z.string().optional(),
      'timeout-minutes': z.number(),
      env: z.record(z.string()),
      steps: z.array(z.object({
        name: z.string().optional(),
        id: z.string().optional(),
        if: z.string().optional(),
        'continue-on-error': z.boolean().optional(),
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

const job = workflow.jobs.smoke;

const step = (name: string) => {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`staging-smoke has no step named "${name}"`);
  return found;
};

const pollMinutes = Number(job.env['ALIAS_POLL_ATTEMPTS']) * Number(job.env['ALIAS_POLL_SECONDS'])
  / 60;

describe('staging-smoke workflow', () => {
  it('runs on every push to staging without waiting for a deployment event', () => {
    expect(workflow.on.push.branches).toEqual(['staging']);
    expect(job.if).toBeUndefined();
    expect(JSON.stringify(workflow.on)).not.toContain('deployment_status');
    expect(workflow.concurrency).toEqual({ group: 'staging-smoke', 'cancel-in-progress': true });
  });

  it('also runs on a schedule and on demand, so a missing push cannot silence it', () => {
    expect(workflow.on.schedule.map((entry) => entry.cron)).toEqual(['17 6 * * *']);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(['base_url', 'expected_sha']);
    expect(workflow.on.workflow_dispatch.inputs['base_url']?.default).toBe('');
    expect(workflow.on.workflow_dispatch.inputs['expected_sha']?.default).toBe('');
  });

  it('smokes the pushed commit and lets a dispatch name its own target', () => {
    const resolve = step('Resolve the deployment under test').run ?? '';

    expect(step('Resolve the deployment under test').env)
      .toMatchObject({ DISPATCH_BASE_URL: '${{ inputs.base_url }}' });
    expect(step('Resolve the deployment under test').env)
      .toMatchObject({ DISPATCH_SHA: '${{ inputs.expected_sha }}' });
    expect(step('Resolve the deployment under test').env)
      .toMatchObject({ PUSH_SHA: '${{ github.sha }}' });
    expect(resolve).toContain('echo "expected_sha=$PUSH_SHA"');
    expect(resolve).toContain('echo "base_url=${DISPATCH_BASE_URL:-$STAGING_HOST_URL}"');
  });

  it('waits for the staging alias to serve the expected commit before smoking', () => {
    const wait = step('Wait for the staging alias to serve the expected commit');

    expect(pollMinutes).toBe(15);
    expect(wait.run).toContain('x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(wait.run).toContain('"$STAGING_BASE_URL/api/health"');
    expect(wait.run).toContain("jq -r '.data.sha // \"\"'");
    expect(wait.run).toContain('sleep "$ALIAS_POLL_SECONDS"');
    expect(job['timeout-minutes']).toBeGreaterThan(pollMinutes);
  });

  it('reports a stale alias as its own failure instead of paging about the smoke', () => {
    expect(step('Smoke the staging deployment').if)
      .toBe("steps.gate.outputs.run == 'true' && steps.alias.outputs.matched == 'true'");
    expect(step('Fail the run on a stale staging alias').if)
      .toBe("steps.alias.outputs.matched == 'false'");
    expect(step('Send an SMS alert').if).toBe(
      "steps.smoke.outputs.failed == 'true' && steps.smoke.outputs.unpinned != 'true'"
      + " && steps.previous.outputs.notify == 'true'",
    );
  });

  it('pages only on a state change, not on a smoke that was already failing', () => {
    const previous = step('Decide whether the failure is new');

    expect(previous.if).toBe(
      "steps.smoke.outputs.failed == 'true' && steps.smoke.outputs.unpinned != 'true'",
    );
    expect(job.steps.indexOf(previous))
      .toBeLessThan(job.steps.indexOf(step('Send an SMS alert')));
    expect(previous.env?.['GH_TOKEN']).toBe('${{ github.token }}');
    expect(previous.run).toContain(
      'actions/workflows/staging-smoke.yml/runs?branch=staging&status=completed&per_page=2',
    );
    expect(previous.run).toContain('notify=true');
    expect(previous.run).toContain('notify=false');
    expect(previous.run).toContain('::notice::');
    expect(workflow.permissions?.['actions']).toBe('read');
  });

  it('smokes the staging tenant host against both database fingerprints', () => {
    expect(job.env['STAGING_HOST_URL']).toBe(
      "https://${{ vars.STAGING_HOST || format('{0}.staging.togethercommunity.app', vars.SMOKE_TENANT || 'acme') }}",
    );
    expect(step('Smoke the staging deployment').env?.['STAGING_BASE_URL'])
      .toBe('${{ steps.target.outputs.base_url }}');
    expect(job.env['PRODUCTION_DATABASE_FINGERPRINT'])
      .toBe("${{ vars.PRODUCTION_DATABASE_FINGERPRINT || '4ef296aa90bd' }}");
    expect(job.env['STAGING_DATABASE_FINGERPRINT'])
      .toBe('${{ vars.STAGING_DATABASE_FINGERPRINT }}');
  });

  it('drops the secrets staging cannot decrypt before measuring its health', () => {
    const sanitize = step('Sanitize the staging tenant secrets');

    expect(job.steps.indexOf(sanitize))
      .toBeLessThan(job.steps.indexOf(step('Smoke the staging deployment')));
    expect(sanitize.if)
      .toBe("steps.gate.outputs.run == 'true' && steps.alias.outputs.matched == 'true'");
    expect(sanitize.env?.['STAGING_OPERATOR_SECRET'])
      .toBe('${{ secrets.STAGING_OPERATOR_SECRET }}');
    expect(sanitize.run).toContain('x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(sanitize.run).toContain('x-scheduler-operator-secret: $STAGING_OPERATOR_SECRET');
    expect(sanitize.run).toContain(API_PATHS.sanitizeStagingSecrets);
  });

  it('skips the sanitize with a notice instead of failing when the operator secret is absent', () => {
    const sanitize = step('Sanitize the staging tenant secrets');

    expect(sanitize.run).toContain('if [ -z "$STAGING_OPERATOR_SECRET" ]');
    expect(sanitize.run).toContain('::notice::');
    expect(sanitize['continue-on-error']).toBe(true);
  });

  it('tells the smoke whether the sanitize step ran', () => {
    const sanitize = step('Sanitize the staging tenant secrets');

    expect(sanitize.run).toContain('sanitized=false');
    expect(sanitize.run).toContain('sanitized=true');
    expect(step('Smoke the staging deployment').env?.['SANITIZED'])
      .toBe('${{ steps.sanitize.outputs.sanitized }}');
  });

  it('sends the protection bypass secret to the smoke only', () => {
    expect(step('Smoke the staging deployment').env?.['VERCEL_AUTOMATION_BYPASS_SECRET'])
      .toBe('${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}');
    expect(step('Smoke the staging deployment').run).toContain('pnpm run smoke:staging');
  });

  it('keeps the bypass secret away from a dispatched foreign host', () => {
    expect(step('Decide whether the smoke can run').run)
      .toContain('if [ "$STAGING_BASE_URL" != "$STAGING_HOST_URL" ]');
    expect(step('Decide whether the smoke can run').env?.['STAGING_BASE_URL'])
      .toBe('${{ steps.target.outputs.base_url }}');
  });

  it('skips with a notice instead of paging when the bypass secret is absent', () => {
    const gate = step('Decide whether the smoke can run');

    expect(gate.run).toContain('if [ -z "$VERCEL_AUTOMATION_BYPASS_SECRET" ]');
    expect(gate.run).toContain('::notice::');
    expect(gate.run).toContain('run=false');
    expect(step('Smoke the staging deployment').if)
      .toContain("steps.gate.outputs.run == 'true'");
  });

  it('passes green with the pin instruction while the staging fingerprint is unpinned', () => {
    expect(step('Smoke the staging deployment').run)
      .toContain("grep -q '^smoke:staging: unpinned=true' staging-smoke.log");
    expect(step('Fail the run on a failing smoke').if)
      .toBe("steps.smoke.outputs.failed == 'true' && steps.smoke.outputs.unpinned != 'true'");
    expect(step('Summarize the staging smoke').run).toContain('STAGING_DATABASE_FINGERPRINT');
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
