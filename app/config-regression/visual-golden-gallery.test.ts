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

const gitHubBodyLimit = 65_536;
const goldensRoot = join(import.meta.dirname, '..', 'tasks', 'visual-goldens');
const committedBaselines = readdirSync(goldensRoot, { encoding: 'utf8', recursive: true })
  .filter((path) => path.endsWith('.png'))
  .map((path) => `app/tasks/visual-goldens/${path}`);
const baseTipSha = 'a'.repeat(40);
const mergeBaseSha = 'b'.repeat(40);
const headSha = 'c'.repeat(40);
const omissionNote = (count: number) =>
  `\n\n_${String(count)} additional baseline change(s) omitted; review them in the Files tab._`;

type ChangedFile = { filename: string; status: string; previous_filename?: string };
type ExistingComment = { id: number; body: string; user: { type: string } };
type CommentCall = { kind: 'create' | 'update'; body: string };

const runGallery = async (files: ChangedFile[], comments: ExistingComment[] = []) => {
  const calls: CommentCall[] = [];
  const listFiles = () => undefined;
  const listComments = () => undefined;
  const github = {
    paginate: (method: unknown) => Promise.resolve(method === listFiles ? files : comments),
    rest: {
      pulls: { listFiles },
      issues: {
        listComments,
        createComment: ({ body }: { body: string }) => {
          calls.push({ kind: 'create', body });
          return Promise.resolve();
        },
        updateComment: ({ body }: { body: string }) => {
          calls.push({ kind: 'update', body });
          return Promise.resolve();
        },
      },
      repos: {
        compareCommits: () => Promise.resolve({ data: { merge_base_commit: { sha: mergeBaseSha } } }),
      },
    },
  };
  const context = {
    repo: { owner: 'coderoadpl', repo: 'togethercommunity-app' },
    payload: { pull_request: { number: 42, base: { sha: baseTipSha }, head: { sha: headSha } } },
  };
  const core = { warning: () => undefined };
  const script = workflow.jobs.publish.steps[0]?.with?.script ?? '';
  const run = new Function('github', 'context', 'core', `return (async () => {\n${script}\n})();`);
  const pending: unknown = Reflect.apply(run, undefined, [github, context, core]);
  await Promise.resolve(pending);
  return calls;
};

const shownRows = (body: string) => body.match(/<tr><td>.*?<\/tr>/g) ?? [];

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
    expect(script).toContain('const maxRows = 400;');
    expect(script).toContain('const maxBodyLength = 60000;');
    expect(script).toContain('let baseSha = baseTipSha;');
    expect(script).toContain("baseDescription = 'pull request base';");
    expect(script).toContain('catch (error)');
    expect(script).toContain('context.payload.pull_request.head.sha');
    expect(script).not.toContain('context.payload.pull_request.head.ref');
  });

  it('keeps a complete baseline regeneration under the GitHub comment body limit', async () => {
    const calls = await runGallery(committedBaselines.map((filename) => ({ filename, status: 'modified' })));

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.kind).toBe('create');
    const body = call?.body ?? '';
    expect(body.length).toBeLessThanOrEqual(gitHubBodyLimit);
    const rows = shownRows(body);
    const omitted = committedBaselines.length - rows.length;
    expect(rows.length).toBeGreaterThan(0);
    expect(body.endsWith(`</tbody></table>${omitted > 0 ? omissionNote(omitted) : ''}`)).toBe(true);
    expect(body.match(/<tr><td>/g)).toHaveLength(rows.length);
    expect(body.match(/<\/td><\/tr>/g)).toHaveLength(rows.length);
    const expectedNames = committedBaselines
      .map((path) => path.slice('app/tasks/visual-goldens/'.length))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, rows.length);
    expect(rows.map((row) => /^<tr><td><code>([^<]*)<\/code>/.exec(row)?.[1])).toEqual(expectedNames);
    for (const row of rows) {
      expect(row).toContain(`/raw/${mergeBaseSha}/`);
      expect(row).toContain(`/raw/${headSha}/`);
    }
  });

  it('shows every row and no omission note for a small change set', async () => {
    const files = ['alpha.png', 'beta/gamma.png', 'delta.png'].map((name, index) => ({
      filename: `app/tasks/visual-goldens/${name}`,
      status: ['added', 'modified', 'removed'][index] ?? 'modified',
    }));
    const calls = await runGallery(files, [
      { id: 7, body: '<!-- visual-golden-gallery -->\nstale', user: { type: 'Bot' } },
    ]);

    expect(calls.map(({ kind }) => kind)).toEqual(['update']);
    const body = calls[0]?.body ?? '';
    expect(shownRows(body)).toHaveLength(3);
    expect(body).not.toContain('omitted');
    expect(body.endsWith('</tbody></table>')).toBe(true);
  });

  it('keeps renames with long names within the limit', async () => {
    const directory = `app/tasks/visual-goldens/${'nested-directory-segment/'.repeat(6)}`;
    const files = Array.from({ length: 120 }, (_, index) => ({
      filename: `${directory}${'renamed-baseline-name-'.repeat(4)}${String(index).padStart(3, '0')}.png`,
      previous_filename: `${directory}${'original-baseline-name-'.repeat(4)}${String(index).padStart(3, '0')}.png`,
      status: 'renamed',
    }));
    const calls = await runGallery(files);

    expect(calls).toHaveLength(1);
    const body = calls[0]?.body ?? '';
    expect(body.length).toBeLessThanOrEqual(gitHubBodyLimit);
    const rows = shownRows(body);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(files.length);
    for (const row of rows) expect(row).toContain(' → ');
    expect(body.endsWith(`</tbody></table>${omissionNote(files.length - rows.length)}`)).toBe(true);
  });

  it('never drops a complete baseline regeneration by the row cap alone', () => {
    const script = workflow.jobs.publish.steps[0]?.with?.script ?? '';
    const maxRows = Number(/const maxRows = (\d+);/.exec(script)?.[1] ?? '0');
    const baselineCount = readdirSync(
      join(import.meta.dirname, '..', 'tasks', 'visual-goldens'),
      { encoding: 'utf8', recursive: true },
    ).filter((path) => path.endsWith('.png')).length;

    expect(maxRows).toBeGreaterThanOrEqual(baselineCount);
  });
});
