import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  compareRulesetBranches,
  deriveRequiredChecksFromWorkflowSources,
  deriveRequiredChecksFromWorkflows,
  IGNORED_WORKFLOW_FILES,
} from './rulesets-required-checks.js';

const snapshotSchema = z.object({
  staging: z.array(z.string()),
  main: z.array(z.string()),
});

const workflow = (text: string, file = 'ci.yml') =>
  deriveRequiredChecksFromWorkflowSources([{ file, text }]);

const pullRequestHeader = `
name: ci
on:
  pull_request:
    branches: [main, staging]
jobs:
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

  it('matches the committed required-check snapshot', () => {
    const repoRoot = join(import.meta.dirname, '..', '..');
    const expected = snapshotSchema.parse(JSON.parse(readFileSync(
      join(import.meta.dirname, '..', 'config-regression', 'rulesets-required-checks.snapshot.json'),
      'utf8',
    )));

    expect(deriveRequiredChecksFromWorkflows(repoRoot)).toEqual(expected);
  });

  it('reports missing and unknown checks independently by branch', () => {
    expect(compareRulesetBranches(
      {
        staging: ['check', 'smoke'],
        main: ['check', 'promotion-guard'],
      },
      {
        staging: ['check', 'legacy'],
        main: ['check', 'promotion-guard', 'obsolete'],
      },
    )).toEqual({
      staging: {
        expectedMissing: ['smoke'],
        requiredUnknown: ['legacy'],
      },
      main: {
        expectedMissing: [],
        requiredUnknown: ['obsolete'],
      },
    });
  });
});
