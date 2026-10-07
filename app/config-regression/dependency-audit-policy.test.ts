import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const stepSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  if: z.string().optional(),
  shell: z.string().optional(),
  run: z.string().optional(),
});

const defaultsSchema = z.object({
  run: z.object({ shell: z.string().optional() }),
});

const ciWorkflowSchema = z.object({
  defaults: defaultsSchema.optional(),
  jobs: z.object({
    check: z.object({
      'runs-on': z.string(),
      defaults: defaultsSchema.optional(),
      steps: z.array(stepSchema),
    }),
    'dependency-audit': z.object({
      'continue-on-error': z.boolean(),
      steps: z.array(stepSchema),
    }),
  }).passthrough(),
});

const workflowsDir = join(import.meta.dirname, '..', '..', '.github', 'workflows');
const readWorkflow = (file: string): unknown =>
  parse(readFileSync(join(workflowsDir, file), 'utf8'));

const ci = ciWorkflowSchema.parse(readWorkflow('ci.yml'));
const job = ci.jobs.check;
const policyStep = job.steps.find((step) => step.id === 'audit-policy');
const auditCommand = 'pnpm audit --prod --audit-level=moderate';

describe('dependency audit policy', () => {
  it('requires the audit for main and dependency-changing pull requests', () => {
    expect(policyStep).toBeDefined();
    expect(policyStep?.run).toContain('audit_required=false');
    expect(policyStep?.run).toContain(
      'if [ "$BASE_REF" = main ] || [ "$REF" = refs/heads/main ]; then\n' +
      '  audit_required=true',
    );
    expect(policyStep?.run).toContain(
      'elif [ "$EVENT_NAME" = pull_request ]; then\n' +
      '  changed="$(git -C .. diff --name-only "$BASE_SHA...$HEAD_SHA")"',
    );
    expect(policyStep?.run).toContain(
      "if printf '%s\\n' \"$changed\" | grep -Eq '^app/(package\\.json|pnpm-lock\\.yaml)$'; then\n" +
      '    audit_required=true',
    );
    expect(policyStep?.run).toContain(
      'echo "audit_required=$audit_required" >> "$GITHUB_OUTPUT"',
    );
  });

  it('gates the blocking audit on the policy output', () => {
    const auditStep = job.steps.find((step) => step.name === auditCommand);

    expect(auditStep?.run).toContain(auditCommand);
    expect(auditStep?.if).toBe("steps.audit-policy.outputs.audit_required == 'true'");
  });

  it('fails closed when the three-dot diff fails under the default bash -e shell', () => {
    expect(job['runs-on']).toBe('ubuntu-24.04');
    expect(ci.defaults?.run.shell).toBeUndefined();
    expect(job.defaults?.run.shell).toBeUndefined();
    expect(policyStep?.shell).toBeUndefined();
    expect(policyStep?.run).toContain(
      'changed="$(git -C .. diff --name-only "$BASE_SHA...$HEAD_SHA")"\n',
    );

    const result = spawnSync('bash', ['-e', '-c',
      `git() { return 42; }\n${policyStep?.run ?? ''}\necho policy-completed`,
    ], {
      encoding: 'utf8',
      env: {
        BASE_REF: 'staging',
        REF: 'refs/pull/1/merge',
        EVENT_NAME: 'pull_request',
        BASE_SHA: 'base',
        HEAD_SHA: 'head',
        GITHUB_OUTPUT: '/dev/null',
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(42);
    expect(result.stdout).toBe('');
  });

  it('runs the same audit in an advisory job', () => {
    const advisoryJob = ci.jobs['dependency-audit'];
    const auditStep = advisoryJob.steps.find((step) => step.name === auditCommand);

    expect(advisoryJob['continue-on-error']).toBe(true);
    expect(auditStep?.run).toContain(auditCommand);
  });
});
