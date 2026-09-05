import { spawnSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 120_000;

export const PROMOTION_SUBJECT = /^Merge pull request #\d+ from coderoadpl\/staging$/;
export const PULL_REQUEST_SUBJECT = /^Merge pull request #(\d+) from coderoadpl\/\S+$/;
export const MERGE_SUBJECT_GREP = '^Merge pull request #';
export const FIELD_SEPARATOR = '\u001f';
export const RECORD_SEPARATOR = '\u001e';

export const gitOutput = (repoRoot: string, args: readonly string[]): string | null => {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

export const gitLines = (repoRoot: string, args: readonly string[]): string[] => {
  const output = gitOutput(repoRoot, args);
  return output === null || output.length === 0 ? [] : output.split('\n');
};
