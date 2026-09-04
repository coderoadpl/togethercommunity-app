import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import pkg from '../package.json' with { type: 'json' };

import { deriveVersion } from './derive-version.js';

const workspaces: string[] = [];
let clock = 0;

const git = (cwd: string, args: readonly string[]): string => {
  clock += 1;
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.test',
      GIT_AUTHOR_DATE: stamp,
      GIT_COMMITTER_DATE: stamp,
    },
  });
};

const workspace = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  workspaces.push(dir);
  return dir;
};

const commit = (repo: string, message: string): void => {
  git(repo, ['commit', '--quiet', '--allow-empty', '-m', message]);
};

const mergePullRequest = (
  repo: string,
  target: string,
  branch: string,
  number: number,
  title: string,
): void => {
  git(repo, ['checkout', '--quiet', target]);
  git(repo, [
    'merge',
    '--quiet',
    '--no-ff',
    '-m',
    `Merge pull request #${String(number)} from coderoadpl/${branch}\n\n${title}`,
    branch,
  ]);
};

const landPullRequest = (repo: string, branch: string, number: number, title: string): void => {
  git(repo, ['checkout', '--quiet', '-b', branch, 'staging']);
  commit(repo, `work on ${branch}`);
  mergePullRequest(repo, 'staging', branch, number, title);
};

const promote = (repo: string, number: number): void => {
  mergePullRequest(repo, 'main', 'staging', number, 'promote staging to production');
  git(repo, ['checkout', '--quiet', 'staging']);
};

const trunkRepo = (): string => {
  const repo = workspace('together-version-');
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  commit(repo, 'root');
  git(repo, ['branch', 'staging']);
  git(repo, ['checkout', '--quiet', 'staging']);
  return repo;
};

const derive = (repoRoot: string, allowFetch = false) =>
  deriveVersion({ repoRoot, allowFetch, env: {} });

afterEach(() => {
  while (workspaces.length > 0) {
    const dir = workspaces.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('version derivation', () => {
  it('counts promotions as MINOR and staging merges as PATCH', () => {
    const repo = trunkRepo();

    landPullRequest(repo, 'run-one', 1, 'feat: one');
    promote(repo, 2);

    git(repo, ['checkout', '--quiet', 'main']);
    expect(derive(repo)).toMatchObject({ version: '0.1.0', minor: 1, patch: 0, promotion: true });

    git(repo, ['checkout', '--quiet', 'staging']);
    landPullRequest(repo, 'run-two', 3, 'fix: two');
    landPullRequest(repo, 'run-three', 4, 'ui: three');
    expect(derive(repo)).toMatchObject({ version: '0.1.2', minor: 1, patch: 2, promotion: false });

    promote(repo, 5);
    git(repo, ['checkout', '--quiet', 'main']);
    expect(derive(repo)).toMatchObject({ version: '0.2.0', promotion: true, complete: true });

    git(repo, ['checkout', '--quiet', 'staging']);
    expect(derive(repo).version).toBe('0.2.0');
  });

  it('counts only pull request merges', () => {
    const repo = trunkRepo();

    landPullRequest(repo, 'run-one', 1, 'feat: one');
    promote(repo, 2);
    git(repo, ['checkout', '--quiet', '-b', 'side', 'staging']);
    commit(repo, 'side work');
    git(repo, ['checkout', '--quiet', 'staging']);
    git(repo, ['merge', '--quiet', '--no-ff', '-m', "Merge branch 'side' into staging", 'side']);

    expect(derive(repo).version).toBe('0.1.0');
  });

  it('reports every pull request as PATCH while main carries no promotion', () => {
    const repo = trunkRepo();

    landPullRequest(repo, 'run-one', 1, 'feat: one');
    landPullRequest(repo, 'run-two', 2, 'fix: two');

    expect(derive(repo)).toMatchObject({ version: '0.0.2', minor: 0, patch: 2, complete: true });
  });

  it('falls back to the manifest version when the clone is too shallow', () => {
    const origin = trunkRepo();
    landPullRequest(origin, 'run-one', 1, 'feat: one');
    promote(origin, 2);
    landPullRequest(origin, 'run-two', 3, 'fix: two');
    const shallow = join(workspace('together-version-clone-'), 'checkout');
    git(origin, ['clone', '--quiet', '--depth=1', '--branch=staging', `file://${origin}`, shallow]);

    expect(derive(shallow)).toMatchObject({
      version: `${pkg.version}+unknown`,
      complete: false,
      sha: git(origin, ['rev-parse', 'staging']).trim(),
    });
  });

  it('recovers the full number by deepening a shallow clone', () => {
    const origin = trunkRepo();
    landPullRequest(origin, 'run-one', 1, 'feat: one');
    promote(origin, 2);
    landPullRequest(origin, 'run-two', 3, 'fix: two');
    const shallow = join(workspace('together-version-clone-'), 'checkout');
    git(origin, ['clone', '--quiet', '--depth=1', '--branch=staging', `file://${origin}`, shallow]);

    expect(derive(shallow, true)).toMatchObject({ version: '0.1.1', complete: true });
  });
});
