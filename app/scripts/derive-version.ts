import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pkg from '../package.json' with { type: 'json' };

import {
  FIELD_SEPARATOR,
  MERGE_SUBJECT_GREP,
  PROMOTION_SUBJECT,
  PULL_REQUEST_SUBJECT,
  gitLines,
  gitOutput,
} from './merge-history.js';

const MAIN_REF_CANDIDATES = [
  'refs/versioning/main',
  'refs/remotes/origin/main',
  'refs/heads/main',
];
const VERSIONING_REFSPEC = '+refs/heads/*:refs/versioning/*';
const UNKNOWN = 'unknown';

export interface DerivedVersion {
  version: string;
  major: number;
  minor: number;
  patch: number;
  sha: string;
  promotion: boolean;
  complete: boolean;
}

export interface DeriveVersionOptions {
  repoRoot: string;
  allowFetch?: boolean;
  env?: NodeJS.ProcessEnv;
}

const semverCore = (version: string): readonly [number, number, number] => {
  const core = version.split('+')[0]?.split('-')[0] ?? '';
  const [major, minor, patch] = core.split('.').map(Number);
  return [major ?? 0, minor ?? 0, patch ?? 0];
};

const isShallow = (repoRoot: string): boolean =>
  gitOutput(repoRoot, ['rev-parse', '--is-shallow-repository']) === 'true';

const resolveMainRef = (repoRoot: string): string | null =>
  MAIN_REF_CANDIDATES.find(
    (ref) => gitOutput(repoRoot, ['rev-parse', '--verify', '--quiet', ref]) !== null,
  ) ?? null;

const historyIsComplete = (repoRoot: string): boolean =>
  !isShallow(repoRoot) && resolveMainRef(repoRoot) !== null;

const remoteUrl = (repoRoot: string, env: NodeJS.ProcessEnv): string | null => {
  const configured = gitOutput(repoRoot, ['remote', 'get-url', 'origin']);
  if (configured !== null && configured.length > 0) return configured;
  const owner = env['VERCEL_GIT_REPO_OWNER'];
  const slug = env['VERCEL_GIT_REPO_SLUG'];
  if (env['VERCEL_GIT_PROVIDER'] !== 'github' || owner === undefined || slug === undefined) {
    return null;
  }
  return `https://github.com/${owner}/${slug}.git`;
};

// Vercel clones ten commits deep, on the deployed branch only and with no
// remote configured, so the promotion history has to be fetched back before
// anything can be counted.
const deepenHistory = (repoRoot: string, env: NodeJS.ProcessEnv): void => {
  const url = remoteUrl(repoRoot, env);
  if (url === null) return;
  const fetchArgs = ['fetch', '--quiet', '--no-tags'];
  if (isShallow(repoRoot)) fetchArgs.push('--unshallow');
  gitOutput(repoRoot, [...fetchArgs, url, VERSIONING_REFSPEC]);
};

const promotionCommits = (repoRoot: string, mainRef: string): string[] =>
  gitLines(repoRoot, [
    'log',
    '--first-parent',
    '--merges',
    `--format=%H${FIELD_SEPARATOR}%s`,
    `--grep=${MERGE_SUBJECT_GREP}`,
    mainRef,
  ])
    .map((line) => line.split(FIELD_SEPARATOR))
    .filter(([, subject]) => PROMOTION_SUBJECT.test(subject ?? ''))
    .map(([sha]) => sha ?? '');

const pullRequestMergeCount = (repoRoot: string, revisions: readonly string[]): number =>
  gitLines(repoRoot, [
    'log',
    '--merges',
    '--format=%s',
    `--grep=${MERGE_SUBJECT_GREP}`,
    ...revisions,
  ]).filter((subject) => PULL_REQUEST_SUBJECT.test(subject)).length;

export const deriveVersion = ({
  repoRoot,
  allowFetch = true,
  env = process.env,
}: DeriveVersionOptions): DerivedVersion => {
  const sha =
    gitOutput(repoRoot, ['rev-parse', 'HEAD']) ?? env['VERCEL_GIT_COMMIT_SHA'] ?? UNKNOWN;
  const promotion = PROMOTION_SUBJECT.test(
    gitOutput(repoRoot, ['log', '-1', '--format=%s']) ?? '',
  );

  if (allowFetch && !historyIsComplete(repoRoot)) deepenHistory(repoRoot, env);

  const mainRef = historyIsComplete(repoRoot) ? resolveMainRef(repoRoot) : null;
  if (mainRef === null) {
    const [major, minor, patch] = semverCore(pkg.version);
    return {
      version: `${pkg.version}+${UNKNOWN}`,
      major,
      minor,
      patch,
      sha,
      promotion,
      complete: false,
    };
  }

  const promotions = promotionCommits(repoRoot, mainRef);
  const lastPromotion = promotions[0];
  const [major] = semverCore(pkg.version);
  const minor = promotions.length;
  const patch = pullRequestMergeCount(
    repoRoot,
    lastPromotion === undefined ? ['HEAD'] : ['HEAD', `^${lastPromotion}`],
  );

  return {
    version: `${major}.${minor}.${patch}`,
    major,
    minor,
    patch,
    sha,
    promotion,
    complete: true,
  };
};

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const derived = deriveVersion({ repoRoot: join(import.meta.dirname, '..') });
  process.stdout.write(
    process.argv.includes('--json')
      ? `${JSON.stringify(derived, null, 2)}\n`
      : `${derived.version}\n`,
  );
}
