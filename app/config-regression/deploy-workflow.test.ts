import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const appRoot = join(import.meta.dirname, '..');
const stepSchema = z.object({
  name: z.string().optional(),
  uses: z.string().optional(),
  env: z.record(z.string()).optional(),
  run: z.string().optional(),
});
const workflowSchema = z.object({
  on: z.record(z.unknown()),
  jobs: z.record(z.object({
    if: z.string().optional(),
    environment: z.object({
      name: z.string(),
      deployment: z.boolean().optional(),
    }).optional(),
    steps: z.array(stepSchema),
  })),
});
const workflow = (name: string) => workflowSchema.parse(parse(readFileSync(
  join(appRoot, '..', '.github', 'workflows', `${name}.yml`), 'utf8',
)));
const deploy = workflow('deploy');
const job = (name: string) => {
  const found = deploy.jobs[name];
  if (!found) throw new Error(`Missing job ${name}`);
  return found;
};
const step = (jobName: string, name: string) => {
  const found = job(jobName).steps.find((candidate) => candidate.name === name);
  if (!found?.run) throw new Error(`Missing script ${name}`);
  return { ...found, run: found.run };
};
const directories: string[] = [];
const temporaryDirectory = () => {
  const directory = mkdtempSync(join(appRoot, '.deploy-test-'));
  directories.push(directory);
  return directory;
};
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true })));

const runDeploy = (branch: string, aliases: string, failAlias = '') => {
  const root = temporaryDirectory();
  const bin = join(root, 'vercel-cli/node_modules/.bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, 'vercel-deploy'));
  const calls = join(root, 'calls.jsonl');
  const output = join(root, 'output');
  writeFileSync(calls, '');
  writeFileSync(output, '');
  writeFileSync(join(bin, 'vercel'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'deploy') process.stdout.write(JSON.stringify({url: 'https://test-deploy.vercel.app'}));
if (args[0] === 'alias' && args[3] === process.env.FAIL_ALIAS) process.exit(1);
`, { mode: 0o755 });
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step('deploy', 'Deploy prebuilt output').run], {
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'],
      RUNNER_TEMP: root, GITHUB_OUTPUT: output, CALLS: calls, FAIL_ALIAS: failAlias,
      VERCEL_TOKEN: 'test-token', VERCEL_ORG_ID: 'test-team', STAGING_ALIASES: aliases,
      GITHUB_REF: `refs/heads/${branch}`, GITHUB_REF_NAME: branch,
      GITHUB_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'example/app', GITHUB_REPOSITORY_OWNER: 'example',
    },
  });
  return {
    status: result.status,
    output: readFileSync(output, 'utf8'),
    calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => z.array(z.string()).parse(JSON.parse(line))),
  };
};

describe('prebuilt deployment boundary', () => {
  it('isolates database builds from hosting credentials and deployment records', () => {
    expect(deploy.on).toEqual({ push: { branches: ['main', 'staging'] }, workflow_dispatch: null });
    expect(job('build').environment).toEqual({
      name: "${{ github.ref == 'refs/heads/main' && 'production-build' || 'staging-build' }}",
      deployment: false,
    });
    expect(job('deploy').environment?.name)
      .toBe("${{ github.ref == 'refs/heads/main' && 'production-deploy' || 'staging-deploy' }}");
    expect(JSON.stringify(job('build'))).not.toContain('VERCEL_TOKEN');
    expect(JSON.stringify(job('deploy'))).not.toContain('DATABASE_URL');
    expect(job('deploy').steps.filter((candidate) => candidate.env?.['VERCEL_TOKEN']))
      .toEqual([expect.objectContaining({ name: 'Deploy prebuilt output' })]);
    expect(job('deploy').steps.filter((candidate) => candidate.uses).map((candidate) => candidate.uses))
      .toEqual([expect.stringMatching(/^actions\/setup-node@/), expect.stringMatching(/^actions\/download-artifact@/)]);
    for (const name of ['build', 'deploy']) {
      expect(step(name, 'Install Vercel CLI').run).toContain('--ignore-scripts');
    }
  });

  it('supplies the body-consumption switch to the builder, alongside the commit stamp', () => {
    expect(step('build', 'Build prebuilt deployment').env).toMatchObject({
      NODEJS_HELPERS: '0',
      VERCEL_API_FUNCTION_BUNDLING: '${{ vars.VERCEL_API_FUNCTION_BUNDLING }}',
      APP_COMMIT_SHA: '${{ github.sha }}', VERCEL_GIT_COMMIT_SHA: '${{ github.sha }}',
    });
  });

  it('deploys staging once, then moves every tenant and platform alias to it', () => {
    const result = runDeploy('staging', 'tenant.staging.example.com\nplatform.staging.example.com\n');
    expect(result.status).toBe(0);
    expect(result.calls[0]).toEqual([
      'deploy', '--prebuilt', '--regions', 'fra1', '--yes', '--json', '--scope', 'test-team',
      '--meta', 'githubOrg=example', '--meta', 'githubRepo=app',
      '--meta', 'githubCommitRef=staging', '--meta', `githubCommitSha=${'a'.repeat(40)}`,
    ]);
    expect(result.calls.slice(1)).toEqual(['tenant', 'platform'].map((host) => [
      'alias', 'set', 'https://test-deploy.vercel.app', `${host}.staging.example.com`, '--scope', 'test-team',
    ]));
    expect(result.output).toBe('url=https://tenant.staging.example.com\n');
  });

  it.each(['', 'https://tenant.staging.example.com', 'valid.example.com\n--token=bad'])('rejects an invalid alias list before deployment: %s', (aliases) => {
    const result = runDeploy('staging', aliases);
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual([]);
  });

  it('fails instead of reporting success if an alias cannot be moved', () => {
    const result = runDeploy('staging', 'tenant.example.com\nplatform.example.com', 'platform.example.com');
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
  });

  it('deploys production with --prod and never changes staging aliases', () => {
    const result = runDeploy('main', 'tenant.staging.example.com');
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toContain('--prod');
    expect(result.output).toBe('url=https://test-deploy.vercel.app\n');
  });
});

for (const [name, branch, shaVariable] of [
  ['staging-smoke', 'staging', 'DEPLOYMENT_SHA'], ['prod-smoke', 'main', 'WORKFLOW_SHA'],
] as const) {
  it(`${name} follows only successful trusted deploys and attests their SHA`, () => {
    const smoke = workflow(name);
    expect(smoke.on['workflow_run']).toEqual({ workflows: ['deploy'], types: ['completed'], branches: [branch] });
    expect(smoke.on).not.toHaveProperty('push');
    const smokeJob = smoke.jobs['smoke'];
    expect(smokeJob?.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(smokeJob?.if).toContain(`github.event.workflow_run.head_branch == '${branch}'`);
    expect(smokeJob?.if).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    expect(smokeJob?.if).toContain("github.event.workflow_run.event == 'push' || github.event.workflow_run.event == 'workflow_dispatch'");
    const target = smokeJob?.steps.find((candidate) => candidate.name === 'Resolve the deployment under test');
    expect(target?.env?.[shaVariable]).toBe('${{ github.event.workflow_run.head_sha }}');
    const root = temporaryDirectory();
    const output = join(root, 'output');
    const result = spawnSync('bash', ['-e', '-c', target?.run ?? 'exit 1'], {
      env: {
        PATH: process.env['PATH'], EVENT_NAME: 'workflow_run', GITHUB_OUTPUT: output,
        STAGING_HOST_URL: 'https://tenant.staging.example.com', SMOKE_TENANT: 'fixture',
        WORKFLOW_SHA: 'deployed-sha', DEPLOYMENT_SHA: 'deployed-sha', GITHUB_SHA: 'default-branch-sha',
      },
    });
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('expected_sha=deployed-sha\n');
    if (branch === 'main') {
      expect(smoke.on).toHaveProperty('deployment_status');
      expect(smokeJob?.if).toContain("github.event.deployment_status.environment == 'Production'");
    }
  });
}
