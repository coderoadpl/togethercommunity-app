import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveVersion } from './derive-version.js';
import {
  FIELD_SEPARATOR,
  MERGE_SUBJECT_GREP,
  PULL_REQUEST_SUBJECT,
  RECORD_SEPARATOR,
  gitLines,
  gitOutput,
} from './merge-history.js';

const TITLE_PREFIX = /^(feat|fix|ui|docs|ci)(?:\([^)]*\))?:\s*(.+)$/i;
const OTHER = 'other';
const GROUPS = [
  { prefix: 'feat', heading: 'Features' },
  { prefix: 'fix', heading: 'Fixes' },
  { prefix: 'ui', heading: 'UI' },
  { prefix: 'docs', heading: 'Docs' },
  { prefix: 'ci', heading: 'CI' },
  { prefix: OTHER, heading: 'Other' },
] as const;

export interface ChangelogEntry {
  prefix: string;
  title: string;
  pullRequest: number;
}

export const parseMergeRecord = (record: string): ChangelogEntry | null => {
  const [subject = '', body = ''] = record.split(FIELD_SEPARATOR);
  const merge = PULL_REQUEST_SUBJECT.exec(subject.trim());
  if (merge === null) return null;
  const title =
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? subject.trim();
  const prefixed = TITLE_PREFIX.exec(title);
  return {
    prefix: prefixed?.[1]?.toLowerCase() ?? OTHER,
    title: prefixed?.[2] ?? title,
    pullRequest: Number(merge[1]),
  };
};

export const renderChangelog = (
  version: string,
  entries: readonly ChangelogEntry[],
): string => {
  const lines = [`# v${version}`, ''];
  if (entries.length === 0) {
    return `${[...lines, 'No pull request merges in this range.'].join('\n')}\n`;
  }
  for (const group of GROUPS) {
    const grouped = entries.filter((entry) => entry.prefix === group.prefix);
    if (grouped.length === 0) continue;
    lines.push(`## ${group.heading}`, '');
    for (const entry of grouped) {
      lines.push(`- ${entry.title} (#${String(entry.pullRequest)})`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
};

export const previousReleaseTag = (repoRoot: string): string | null => {
  const headTags = new Set(gitLines(repoRoot, ['tag', '--points-at', 'HEAD']));
  return (
    gitLines(repoRoot, ['tag', '--list', 'v*', '--sort=-v:refname', '--merged', 'HEAD']).find(
      (tag) => !headTags.has(tag),
    ) ?? null
  );
};

export const collectEntries = (repoRoot: string, from: string | null): ChangelogEntry[] => {
  const output =
    gitOutput(repoRoot, [
      'log',
      '--merges',
      `--format=%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`,
      `--grep=${MERGE_SUBJECT_GREP}`,
      ...(from === null ? ['HEAD'] : [`${from}..HEAD`]),
    ]) ?? '';
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => parseMergeRecord(record))
    .filter((entry): entry is ChangelogEntry => entry !== null);
};

const flagValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
};

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const repoRoot = join(import.meta.dirname, '..');
  const version = flagValue('--version') ?? deriveVersion({ repoRoot }).version;
  const from = flagValue('--from') ?? previousReleaseTag(repoRoot);
  process.stdout.write(renderChangelog(version, collectEntries(repoRoot, from)));
}
