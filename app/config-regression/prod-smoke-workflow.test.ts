import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER } from '#core/contract/index.js';
import { SMOKE_TENANT_SLUG } from '#core/domain/index.js';

const workflowSchema = z.object({
  jobs: z.object({
    smoke: z.object({
      env: z.record(z.string()),
      steps: z.array(z.object({
        name: z.string().optional(),
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
  join(import.meta.dirname, '..', '..', '.github', 'workflows', 'prod-smoke.yml'),
  'utf8',
)));

const step = (name: string) => {
  const found = workflow.jobs.smoke.steps.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`prod-smoke has no step named "${name}"`);
  return found;
};

describe('prod-smoke workflow', () => {
  it('reseeds the smoke tenant with the operator secret before the checks', () => {
    const steps = workflow.jobs.smoke.steps.map((candidate) => candidate.name);
    const reseed = step('Reseed the smoke tenant');

    expect(steps.indexOf('Reseed the smoke tenant'))
      .toBeLessThan(steps.indexOf('Smoke the deployment'));
    expect(reseed.env?.['PROD_OPERATOR_SECRET']).toBe('${{ secrets.PROD_OPERATOR_SECRET }}');
    expect(reseed.run).toContain(API_PATHS.smokeTenantReseed);
    expect(reseed.run).toContain(SCHEDULER_OPERATOR_SECRET_HEADER);
  });

  it('reseeds only once the alias serves the commit under test', () => {
    const steps = workflow.jobs.smoke.steps.map((candidate) => candidate.name);
    const wait = step('Wait for the deployment to serve the expected commit');

    expect(steps.indexOf('Wait for the deployment to serve the expected commit'))
      .toBeLessThan(steps.indexOf('Reseed the smoke tenant'));
    expect(wait.run).toContain('$EXPECTED_SHA');
    expect(step('Reseed the smoke tenant').if).toContain("steps.alias.outputs.matched == 'true'");
    expect(step('Smoke the deployment').if).toContain("steps.alias.outputs.matched == 'true'");
    expect(step('Send an SMS alert').if).toContain("steps.alias.outputs.matched == 'false'");
    expect(step('Fail the run on a failing smoke').if)
      .toContain("steps.alias.outputs.matched == 'false'");
  });

  it('reseeds acme only while acme is the tenant under test', () => {
    expect(step('Reseed the smoke tenant').run)
      .toContain(`if [ "$SMOKE_TENANT" != "${SMOKE_TENANT_SLUG}" ]`);
  });

  it('skips the reseed with a notice when the operator secret is absent', () => {
    const reseed = step('Reseed the smoke tenant');

    expect(reseed.run).toContain('if [ -z "$PROD_OPERATOR_SECRET" ]');
    expect(reseed.run).toContain('::notice::');
  });

  it('keeps the operator secret away from a dispatched foreign host', () => {
    const reseed = step('Reseed the smoke tenant');

    expect(workflow.jobs.smoke.env['PROD_BASE_URL']).toBe('https://coderoad.togethercommunity.app');
    expect(reseed.run).toContain('if [ "$BASE_URL" != "$PROD_BASE_URL" ]');
    expect(reseed.run).toContain('::notice::');
  });

  it('smokes and pages even when the reseed fails', () => {
    const reseed = step('Reseed the smoke tenant');

    expect(reseed['continue-on-error']).toBe(true);
    expect(step('Send an SMS alert').if)
      .toContain("steps.reseed.outcome == 'failure'");
    expect(step('Fail the run on a failing smoke').if)
      .toContain("steps.reseed.outcome == 'failure'");
    expect(String(step('Send an SMS alert').with?.['message']))
      .toContain("steps.smoke.outputs.failing || steps.alias.outputs.failing || 'reseed'");
  });

  it('signs the smoke member in with the secret it is seeded with', () => {
    const env = step('Smoke the deployment').env ?? {};

    expect(workflow.jobs.smoke.env['SMOKE_TENANT'])
      .toBe(`\${{ vars.SMOKE_TENANT || '${SMOKE_TENANT_SLUG}' }}`);
    expect(env['SMOKE_MEMBER_EMAIL']).toBe('${{ secrets.SMOKE_MEMBER_EMAIL }}');
    expect(env['SMOKE_MEMBER_PASSWORD']).toBe('${{ secrets.SMOKE_MEMBER_PASSWORD }}');
    expect(env).not.toHaveProperty('SMOKE_CREATOR_PASSWORD');
  });
});
