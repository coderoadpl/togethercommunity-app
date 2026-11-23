import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const permissionsSchema = z.record(z.enum(['read', 'write', 'none']));
const workflowSchema = z.object({
  permissions: permissionsSchema,
  jobs: z.record(z.object({ permissions: permissionsSchema.optional() })),
});

const cases = [
  {
    file: 'ci.yml',
    defaults: { contents: 'read' },
    jobs: {
      plan: { contents: 'read' },
      check: { contents: 'read' },
      'dependency-audit': { contents: 'read' },
      'telemetry-mongodb': { contents: 'read' },
      visual: { contents: 'read' },
      smoke: { contents: 'read' },
      e2e: { contents: 'read' },
      'dispatch-ci': { contents: 'read', actions: 'read' },
      'release-tag': { contents: 'write' },
    },
  },
  {
    file: 'cla.yml',
    defaults: {},
    jobs: {
      cla: { contents: 'write', 'pull-requests': 'write', issues: 'write', statuses: 'write' },
    },
  },
  {
    file: 'promotion-guard.yml',
    defaults: { contents: 'read' },
    jobs: { 'promotion-guard': { contents: 'read', 'pull-requests': 'write', actions: 'read' } },
  },
  {
    file: 'release-sdk.yml',
    defaults: { contents: 'read' },
    jobs: { publish: { contents: 'read', 'id-token': 'write' } },
  },
  {
    file: 'rulesets-drift.yml',
    defaults: { contents: 'read' },
    jobs: { 'rulesets-drift': { contents: 'read', issues: 'write' } },
  },
  {
    file: 'staging-links.yml',
    defaults: {},
    jobs: { publish: { deployments: 'write', 'pull-requests': 'write' } },
  },
  {
    file: 'storybook-pages.yml',
    defaults: { contents: 'read' },
    jobs: {
      build: { contents: 'read' },
      publish: { contents: 'read', pages: 'write', 'id-token': 'write' },
    },
  },
];

describe('workflow token least privilege', () => {
  it.each(cases)('grants only the required jobs write access in $file', (entry) => {
    const path = join(import.meta.dirname, '..', '..', '.github', 'workflows', entry.file);
    const workflow = workflowSchema.parse(parse(readFileSync(path, 'utf8')));
    expect(workflow.permissions).toEqual(entry.defaults);
    expect(Object.values(workflow.permissions)).not.toContain('write');
    expect(Object.fromEntries(Object.entries(workflow.jobs).map(([name, job]) => [
      name, job.permissions ?? workflow.permissions,
    ]))).toEqual(entry.jobs);
  });
});
