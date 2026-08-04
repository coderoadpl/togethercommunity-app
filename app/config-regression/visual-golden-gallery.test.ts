import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowSource = readFileSync(
  join(import.meta.dirname, '..', '..', '.github', 'workflows', 'visual-golden-gallery.yml'),
  'utf8',
);
const workflow: {
  on: {
    pull_request_target: {
      branches: string[];
      types: string[];
    };
  };
  permissions: Record<string, never>;
  jobs: {
    publish: {
      permissions: Record<string, string>;
      steps: Array<{
        uses?: string;
        with?: { script?: string };
      }>;
    };
  };
} = parse(workflowSource);

describe('visual golden gallery workflow', () => {
  it('keeps privileged execution isolated from pull request code', () => {
    expect(workflow.on.pull_request_target).toEqual({
      branches: ['staging'],
      types: ['opened', 'reopened', 'synchronize'],
    });
    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.publish.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
    });
    expect(workflow.jobs.publish.steps).toHaveLength(1);
    expect(workflow.jobs.publish.steps[0]?.uses).toMatch(
      /^actions\/github-script@[0-9a-f]{40}$/,
    );
    expect(workflowSource).not.toContain('actions/checkout');
    expect(workflowSource.match(/pull-requests: write/g)).toHaveLength(1);
  });

  it('pins path, status, row cap, and fork comparison safeguards', () => {
    const script = workflow.jobs.publish.steps[0]?.with?.script ?? '';

    expect(script).toContain(
      "const baselinePath = /^app\\/tasks\\/visual-goldens\\/(?:[A-Za-z0-9._-]+\\/)*[A-Za-z0-9._-]+\\.png$/;",
    );
    expect(script).toContain("if (file.status === 'unchanged') return [];");
    expect(script).toContain("file.status === 'added' || file.status === 'copied'");
    expect(script).toContain("file.status === 'removed'");
    expect(script).toContain("file.status === 'renamed'");
    expect(script).toContain('left.name.localeCompare(right.name)');
    expect(script).toContain('const maxRows = 100;');
    expect(script).toContain('let baseSha = baseTipSha;');
    expect(script).toContain("baseDescription = 'pull request base';");
    expect(script).toContain('catch (error)');
    expect(script).toContain('context.payload.pull_request.head.sha');
    expect(script).not.toContain('context.payload.pull_request.head.ref');
  });

  it('has room for a complete baseline regeneration', () => {
    const script = workflow.jobs.publish.steps[0]?.with?.script ?? '';
    const maxRows = Number(/const maxRows = (\d+);/.exec(script)?.[1] ?? '0');
    const baselineCount = readdirSync(
      join(import.meta.dirname, '..', 'tasks', 'visual-goldens'),
      { encoding: 'utf8', recursive: true },
    ).filter((path) => path.endsWith('.png')).length;

    expect(maxRows).toBeGreaterThanOrEqual(baselineCount);
  });
});
