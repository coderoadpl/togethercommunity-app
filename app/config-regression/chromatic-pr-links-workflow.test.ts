import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const stepSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  if: z.string().optional(),
  uses: z.string().optional(),
  'continue-on-error': z.boolean().optional(),
  env: z.record(z.string()).optional(),
  run: z.string().optional(),
  with: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const chromaticWorkflowSchema = z.object({
  permissions: z.record(z.string()).optional(),
  concurrency: z.object({
    group: z.string(),
    'cancel-in-progress': z.literal(true),
  }),
  jobs: z.record(z.object({
    permissions: z.record(z.string()).optional(),
    steps: z.array(stepSchema),
  })),
});

const pagesWorkflowSchema = z.object({
  jobs: z.object({
    build: z.object({
      strategy: z.object({
        matrix: z.object({
          include: z.array(z.object({
            ref: z.string(),
            path: z.union([z.string(), z.null()]),
          })),
        }),
      }),
    }),
    publish: z.object({
      steps: z.array(z.object({
        uses: z.string().optional(),
        with: z.record(z.string()).optional(),
      })),
    }),
  }),
});

const workflowRoot = join(import.meta.dirname, '..', '..', '.github', 'workflows');
const marker = '<!-- chromatic-preview -->';

const readWorkflow = (file: string) => readFileSync(join(workflowRoot, file), 'utf8');

const workflows = [
  {
    file: 'chromatic-preview.yml',
    job: 'chromatic-preview',
    cliStep: 'Publish Chromatic preview',
  },
  {
    file: 'chromatic.yml',
    job: 'chromatic',
    cliStep: 'Run Chromatic',
  },
];

const loadChromatic = (file: string) => {
  const source = readWorkflow(file);
  return { source, workflow: chromaticWorkflowSchema.parse(parse(source)) };
};

const getJob = (file: string, jobName: string) => {
  const loaded = loadChromatic(file);
  const job = loaded.workflow.jobs[jobName];
  if (job === undefined) throw new Error(`${file} has no ${jobName} job`);
  return { ...loaded, job };
};

const getStep = (
  job: z.infer<typeof chromaticWorkflowSchema>['jobs'][string],
  name: string,
) => {
  const found = job.steps.find((step) => step.name === name);
  if (found === undefined) throw new Error(`workflow has no step named "${name}"`);
  return found;
};

describe('Chromatic pull request link comments', () => {
  it.each(workflows)('checks out the pull request head with complete history in $file', ({ file, job }) => {
    const loaded = getJob(file, job);
    const checkout = loaded.job.steps.find((step) => step.uses?.startsWith('actions/checkout@') === true);
    if (checkout === undefined) throw new Error(`${file} has no checkout step`);

    expect(checkout.with).toMatchObject({
      ref: '${{ github.event.pull_request.head.sha || github.sha }}',
      'fetch-depth': 0,
      'persist-credentials': false,
    });
  });

  it.each(workflows)('cancels superseded Chromatic runs in $file', ({ file, job }) => {
    const loaded = getJob(file, job);

    expect(loaded.workflow.concurrency.group).toContain('${{ github.event.pull_request.number || github.ref }}');
    expect(loaded.workflow.concurrency['cancel-in-progress']).toBe(true);
  });

  it.each(workflows)('skips Chromatic when the pull request has no UI changes in $file', ({ file, job, cliStep }) => {
    const loaded = getJob(file, job);
    const checkout = loaded.job.steps.find((step) => step.uses?.startsWith('actions/checkout@') === true);
    const detector = getStep(loaded.job, 'Detect UI changes');
    const install = loaded.job.steps.find((step) => step.run === 'pnpm install --frozen-lockfile');
    const chromatic = getStep(loaded.job, cliStep);
    const comment = getStep(loaded.job, 'Upsert Chromatic preview comment');
    const detectorScript = detector.run ?? '';
    const chromaticScript = chromatic.run ?? '';
    const commentScript = comment.run ?? '';
    if (checkout === undefined) throw new Error(`${file} has no checkout step`);
    if (install === undefined) throw new Error(`${file} has no pnpm install step`);

    expect(detector.id).toBe('ui-changes');
    expect(detector.env).toMatchObject({
      EVENT_NAME: '${{ github.event_name }}',
      BASE_SHA: '${{ github.event.pull_request.base.sha }}',
      HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
    });
    expect(loaded.job.steps.indexOf(detector)).toBe(loaded.job.steps.indexOf(checkout) + 1);
    expect(detectorScript).toContain('git -C "$GITHUB_WORKSPACE" diff --name-only "$BASE_SHA...$HEAD_SHA"');
    expect(detectorScript).toContain("'app/apps/web/**'");
    expect(detectorScript).toContain("'app/apps/server/src/**'");
    expect(detectorScript).toContain("'app/core/**'");
    expect(detectorScript).toContain("'app/.storybook/**'");
    expect(detectorScript).not.toContain("'app/apps/web/src/**/*.stories.*'");
    expect(detectorScript).toContain("'app/package.json'");
    expect(detectorScript).toContain("'app/pnpm-lock.yaml'");
    expect(detectorScript).toContain("'app/tasks/visual-goldens/**'");
    expect(detectorScript).toContain(`'.github/workflows/${file}'`);
    expect(install.if).toBeUndefined();
    expect(chromatic.if).toBeUndefined();
    expect(chromatic.env).toMatchObject({
      CHROMATIC_SKIP: "${{ steps.ui-changes.outputs.changed == 'false' }}",
    });
    expect(chromaticScript).toContain('--skip');
    expect(chromaticScript).toContain('pnpm exec chromatic "$@"');
    expect(comment.env).toMatchObject({
      CHROMATIC_SKIPPED: "${{ steps.ui-changes.outputs.changed == 'false' }}",
    });
    expect(commentScript).toContain('Chromatic skipped: no UI changes');
  });

  it.each(workflows)('captures diagnostics and comments from $file', ({ file, job, cliStep }) => {
    const loaded = getJob(file, job);
    const chromatic = getStep(loaded.job, cliStep);
    const comment = getStep(loaded.job, 'Upsert Chromatic preview comment');
    const commentScript = comment.run ?? '';

    expect(loaded.job.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
    });
    expect(loaded.workflow.permissions?.['pull-requests']).toBeUndefined();
    expect(chromatic.run).toContain('--diagnostics-file=chromatic-diagnostics.json');
    expect(chromatic.run).toContain('--exit-once-uploaded');
    expect(loaded.job.steps.indexOf(chromatic)).toBeLessThan(loaded.job.steps.indexOf(comment));

    expect(comment.if).toBe("github.event_name == 'pull_request'");
    expect(comment['continue-on-error']).toBe(true);
    expect(comment.env).toMatchObject({
      GH_TOKEN: '${{ github.token }}',
      PR_NUMBER: '${{ github.event.pull_request.number }}',
      BASE_REF: '${{ github.event.pull_request.base.ref }}',
      COMMIT_SHA: '${{ github.event.pull_request.head.sha }}',
    });

    expect(commentScript).toContain(marker);
    expect(commentScript).toContain('chromatic-diagnostics.json');
    expect(commentScript).toContain('.storybookUrl');
    expect(commentScript).toContain('.buildUrl');
    expect(commentScript).toContain('.changeCount');
    expect(commentScript).toContain('.componentCount');
    expect(commentScript).toContain('gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments"');
    expect(commentScript).toContain('contains(\\"$marker\\")');
    expect(commentScript).toContain('--method PATCH');
    expect(commentScript).toContain('--method POST');
  });

  it('links to the permanently published Storybook paths from storybook-pages', () => {
    const pages = pagesWorkflowSchema.parse(parse(readWorkflow('storybook-pages.yml')));
    const pagePaths = Object.fromEntries(
      pages.jobs.build.strategy.matrix.include.map((entry) => [entry.ref, entry.path]),
    );
    const publishPaths = pages.jobs.publish.steps
      .map((step) => step.with?.path)
      .filter((path): path is string => path !== undefined);

    expect(pagePaths).toEqual({ main: '.', staging: 'staging' });
    expect(publishPaths).toEqual(['site', 'site/staging', 'site']);

    for (const { file, job } of workflows) {
      const commentScript = getStep(
        getJob(file, job).job,
        'Upsert Chromatic preview comment',
      ).run ?? '';

      expect(commentScript).toContain('pages_url="https://${owner}.github.io/${repo_name}/"');
      expect(commentScript).toContain('if [ "$BASE_REF" = "staging" ]; then');
      expect(commentScript).toContain('pages_url="${pages_url}staging/"');
      expect(commentScript).not.toContain('${BASE_REF}/');
    }
  });
});
