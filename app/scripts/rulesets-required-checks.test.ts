import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { expectedRequiredChecks, loadManifest, parseManifest } from './dispatch-ci.js';
import {
  compareRulesetBranches,
  deriveCheckProducersFromWorkflowSources,
  deriveProducedChecksFromWorkflows,
  deriveProducedChecksFromWorkflowSources,
  IGNORED_WORKFLOW_FILES,
  readWorkflowSources,
  RULESET_BRANCHES,
  ungatedCheckViolations,
} from './rulesets-required-checks.js';

const snapshotSchema = z.object({
  staging: z.array(z.string()),
  main: z.array(z.string()),
});

const workflow = (text: string, file = 'ci.yml') =>
  deriveProducedChecksFromWorkflowSources([{ file, text }]);

const pullRequestHeader = `
name: ci
on:
  pull_request:
    branches: [main, staging]
jobs:
`;

const repoRoot = join(import.meta.dirname, '..', '..');

const legacyPerJobChecks = [
  'check',
  'visual',
  'smoke',
  'e2e (auth)',
  'e2e (team-admins)',
  'e2e (poc)',
  'e2e (subs)',
  'e2e (marketing)',
  'e2e (coupon)',
  'e2e (public-authz)',
  'e2e (member-activity)',
  'e2e (member-shell)',
  'e2e (impersonation)',
  'e2e (two-factor)',
  'e2e (image-assets)',
  'e2e (custom-domain)',
  'e2e (meta-capi)',
];

const planDrivenRaw = (overrides: Record<string, unknown> = {}) => ({
  gate: 'dispatch-ci',
  workflow: 'ci.yml',
  planJob: 'plan',
  jobs: [
    { id: 'check', mode: 'required', runOn: { branches: ['main'] } },
    { id: 'e2e', mode: 'required', matrix: [{ suite: 'auth', browser: true }, { suite: 'poc', browser: false }] },
  ],
  afterGate: [],
  separateRequiredChecks: { staging: [], main: [] },
  ungatedChecks: { staging: [], main: [] },
  postDeploy: { staging: [], production: [] },
  deletionProtectedBranches: [],
  serviceContainerStepPrefix: 'Start service container',
  ...overrides,
});

const planDrivenManifest = parseManifest(planDrivenRaw());

const planDrivenWorkflow = `${pullRequestHeader}
  plan:
    runs-on: ubuntu-24.04
    steps: []
  check:
    needs: [plan]
    if: needs.plan.outputs.run-check == 'true'
    runs-on: ubuntu-24.04
    steps: []
  e2e:
    name: e2e (\${{ matrix.suite }})
    needs: [plan]
    if: needs.plan.outputs.run-e2e == 'true' && needs.plan.outputs.matrix-e2e != '[]'
    strategy:
      matrix:
        include: \${{ fromJSON(needs.plan.outputs.matrix-e2e) }}
    runs-on: ubuntu-24.04
    steps: []
  dispatch-ci:
    if: always()
    needs: [plan, check, e2e]
    runs-on: ubuntu-24.04
    steps: []
  release-tag:
    if: github.event_name == 'push'
    needs: [dispatch-ci]
    runs-on: ubuntu-24.04
    steps: []
`;

describe('ruleset required checks', () => {
  it('derives matrix contexts from the suite axis', () => {
    expect(workflow(`${pullRequestHeader}
  e2e:
    strategy:
      matrix:
        suite: [auth, coupon]
    runs-on: ubuntu-24.04
    steps: []
`)).toEqual({
      staging: ['e2e (auth)', 'e2e (coupon)'],
      main: ['e2e (auth)', 'e2e (coupon)'],
    });
  });

  it('expands every matrix axis, not just the first one', () => {
    expect(workflow(`${pullRequestHeader}
  e2e:
    strategy:
      matrix:
        suite: [auth]
        node: [22, 24]
    runs-on: ubuntu-24.04
    steps: []
`).main).toEqual(['e2e (auth, 22)', 'e2e (auth, 24)']);
  });

  it('treats an include-only matrix as one combination per entry', () => {
    expect(workflow(`${pullRequestHeader}
  e2e:
    strategy:
      matrix:
        include:
          - suite: auth
          - suite: poc
    runs-on: ubuntu-24.04
    steps: []
`).main).toEqual(['e2e (auth)', 'e2e (poc)']);
  });

  it('applies matrix exclude and include on top of the axis product', () => {
    expect(workflow(`${pullRequestHeader}
  e2e:
    strategy:
      matrix:
        suite: [auth, poc]
        node: [22, 24]
        exclude:
          - suite: poc
            node: 22
        include:
          - suite: auth
            node: 24
            shard: slow
          - suite: subs
            node: 24
    runs-on: ubuntu-24.04
    steps: []
`).main).toEqual([
      'e2e (auth, 22)',
      'e2e (auth, 24, slow)',
      'e2e (poc, 24)',
      'e2e (subs, 24)',
    ]);
  });

  it('throws instead of guessing when a matrix shape cannot be resolved', () => {
    expect(() => workflow(`${pullRequestHeader}
  e2e:
    strategy:
      matrix:
        suite: \${{ fromJSON(needs.plan.outputs.suites) }}
    runs-on: ubuntu-24.04
    steps: []
`)).toThrow('matrix axis "suite"');
  });

  it('uses job names, job ids, and pull-request expression names', () => {
    expect(workflow(`
name: ai-review
on:
  pull_request:
    branches: [staging]
jobs:
  check:
    runs-on: ubuntu-24.04
    steps: []
  named:
    name: custom-name
    runs-on: ubuntu-24.04
    steps: []
  dynamic:
    name: \${{ github.event_name == 'workflow_dispatch' && 'ai-review-dry-run' || 'ai-review' }}
    runs-on: ubuntu-24.04
    steps: []
`, 'ai-review.yml')).toEqual({
      staging: ['check', 'custom-name', 'ai-review'],
      main: [],
    });
  });

  it('renders matrix values inside a job name expression', () => {
    expect(workflow(`${pullRequestHeader}
  e2e:
    name: e2e \${{ matrix.suite }}
    strategy:
      matrix:
        suite: [auth, poc]
    runs-on: ubuntu-24.04
    steps: []
`).main).toEqual(['e2e auth', 'e2e poc']);
  });

  it('throws instead of falling back to the job id on an unresolvable name', () => {
    expect(() => workflow(`
name: gatekeeper
on:
  pull_request:
    branches: [main]
jobs:
  review:
    name: \${{ inputs.mode || github.head_ref }}
    runs-on: ubuntu-24.04
    steps: []
`, 'gatekeeper.yml')).toThrow('does not resolve to a pull-request check name');
  });

  it('honours negated pull-request guards instead of matching the bare word', () => {
    expect(workflow(`${pullRequestHeader}
  push-only:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-24.04
    steps: []
  branch-only:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    steps: []
  release:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    steps: []
  gated:
    if: github.repository == 'owner/repo' && github.event_name == 'pull_request'
    runs-on: ubuntu-24.04
    steps: []
`)).toEqual({ staging: ['gated'], main: ['gated'] });
  });

  it('drops jobs that cannot fail and workflows that cannot report on every push', () => {
    expect(workflow(`
name: advisory
on:
  pull_request:
    branches: [main]
jobs:
  advisory:
    continue-on-error: true
    runs-on: ubuntu-24.04
    steps: []
`, 'advisory.yml').main).toEqual([]);

    expect(workflow(`
name: paths
on:
  pull_request:
    branches: [main]
    paths: ['app/**']
jobs:
  scoped:
    runs-on: ubuntu-24.04
    steps: []
`, 'paths.yml').main).toEqual([]);

    expect(workflow(`
name: opened-only
on:
  pull_request:
    branches: [main]
    types: [opened, reopened]
jobs:
  announce:
    runs-on: ubuntu-24.04
    steps: []
`, 'opened-only.yml').main).toEqual([]);
  });

  it('skips the workflows the ignore list names, and nothing else', () => {
    expect(Object.keys(IGNORED_WORKFLOW_FILES)).toEqual(['chromatic.yml']);
    expect(workflow(`
name: chromatic
on:
  pull_request:
    branches: [main]
jobs:
  chromatic:
    runs-on: ubuntu-24.04
    steps: []
`, 'chromatic.yml').main).toEqual([]);
  });

  it('resolves the plan-driven jobs and matrix through the manifest for each branch', () => {
    expect(deriveProducedChecksFromWorkflowSources(
      [{ file: 'ci.yml', text: planDrivenWorkflow }],
      planDrivenManifest,
    )).toEqual({
      staging: ['plan', 'e2e (auth)', 'e2e (poc)', 'dispatch-ci'],
      main: ['plan', 'check', 'e2e (auth)', 'e2e (poc)', 'dispatch-ci'],
    });
  });

  it('applies the plan only to the workflow the manifest names', () => {
    expect(() => deriveProducedChecksFromWorkflowSources(
      [{ file: 'other.yml', text: planDrivenWorkflow }],
      planDrivenManifest,
    )).toThrow('matrix include is not a list of scalar objects');
  });

  it('names a check that another workflow reports outside the gate and the manifest lists', () => {
    const lint = `
name: lint
on:
  pull_request:
    branches: [main, staging]
jobs:
  lint:
    runs-on: ubuntu-24.04
    steps: []
`;
    const producers = deriveCheckProducersFromWorkflowSources(
      [{ file: 'ci.yml', text: planDrivenWorkflow }, { file: 'lint.yml', text: lint }],
      planDrivenManifest,
    );
    const listing = (field: 'separateRequiredChecks' | 'ungatedChecks') => parseManifest(planDrivenRaw({
      [field]: { staging: [{ name: 'lint', reason: 'listed' }], main: [{ name: 'lint', reason: 'listed' }] },
    }));

    expect(ungatedCheckViolations(producers, planDrivenManifest)).toEqual(RULESET_BRANCHES.map((branch) =>
      `${branch}: "lint" from lint.yml job "lint" reports on every pull request push without the gate, so add the job to the dispatch-ci manifest, list it in separateRequiredChecks.${branch}, or list it with a reason in ungatedChecks.${branch}.`));
    expect(ungatedCheckViolations(producers, listing('separateRequiredChecks'))).toEqual([]);
    expect(ungatedCheckViolations(producers, listing('ungatedChecks'))).toEqual([]);
  });

  it('matches the committed expected required-check snapshot', () => {
    const expected = snapshotSchema.parse(JSON.parse(readFileSync(
      join(import.meta.dirname, '..', 'config-regression', 'rulesets-required-checks.snapshot.json'),
      'utf8',
    )));

    expect(expectedRequiredChecks(loadManifest())).toEqual(expected);
  });

  it('has every expected required check produced by exactly one job for its branch', () => {
    const manifest = loadManifest();
    const producers = deriveCheckProducersFromWorkflowSources(readWorkflowSources(repoRoot), manifest);
    const expected = expectedRequiredChecks(manifest);

    for (const branch of RULESET_BRANCHES) {
      for (const name of expected[branch]) {
        const jobs = producers[branch]
          .filter((producer) => producer.name === name)
          .map((producer) => `${producer.file}:${producer.job}`);
        expect(jobs, `${branch}: ${name}`).toHaveLength(1);
      }
    }
  });

  it('still produces every legacy per-job check under its exact name', () => {
    const produced = deriveProducedChecksFromWorkflows(repoRoot, loadManifest());

    for (const branch of RULESET_BRANCHES) {
      expect(produced[branch]).toEqual(expect.arrayContaining(legacyPerJobChecks));
    }
  });

  it('splits required checks that are not expected into legacy, ungated and unknown', () => {
    const producer = (name: string, file = 'ci.yml', job = name) => ({ name, file, job });

    expect(compareRulesetBranches(
      {
        staging: ['dispatch-ci', 'staging-freeze'],
        main: ['dispatch-ci', 'promotion-guard'],
      },
      {
        staging: ['check', 'lint', 'staging-freeze', 'vanished'],
        main: ['dispatch-ci', 'promotion-guard', 'obsolete', 'shadow'],
      },
      {
        staging: [
          producer('dispatch-ci'),
          producer('staging-freeze', 'staging-freeze.yml'),
          producer('check'),
          producer('lint', 'lint.yml'),
        ],
        main: [
          producer('dispatch-ci'),
          producer('promotion-guard', 'promotion-guard.yml'),
          producer('check'),
          producer('shadow', 'ci.yml', 'release-tag'),
        ],
      },
      loadManifest(),
    )).toEqual({
      staging: {
        expectedMissing: ['dispatch-ci'],
        requiredLegacy: ['check'],
        requiredUngated: ['lint'],
        requiredUnknown: ['vanished'],
      },
      main: {
        expectedMissing: [],
        requiredLegacy: [],
        requiredUngated: ['shadow'],
        requiredUnknown: ['obsolete'],
      },
    });
  });

  it('classifies a required check produced by a second workflow file as ungated', () => {
    const lint = `
name: lint
on:
  pull_request:
    branches: [main, staging]
jobs:
  check:
    runs-on: ubuntu-24.04
    steps: []
`;
    const producers = deriveCheckProducersFromWorkflowSources(
      [{ file: 'ci.yml', text: planDrivenWorkflow }, { file: 'lint.yml', text: lint }],
      planDrivenManifest,
    );

    expect(compareRulesetBranches(
      { staging: ['dispatch-ci'], main: ['dispatch-ci'] },
      { staging: ['dispatch-ci', 'check', 'e2e (auth)'], main: ['dispatch-ci', 'check', 'e2e (auth)'] },
      producers,
      planDrivenManifest,
    )).toEqual({
      staging: { expectedMissing: [], requiredLegacy: ['e2e (auth)'], requiredUngated: ['check'], requiredUnknown: [] },
      main: { expectedMissing: [], requiredLegacy: ['e2e (auth)'], requiredUngated: ['check'], requiredUnknown: [] },
    });
  });
});
