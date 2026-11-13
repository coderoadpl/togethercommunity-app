import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const linkPattern = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const externalTargetPattern = /^(https?:|mailto:|tel:|\/\/|#)/;

const isInside = (root: string, target: string): boolean => {
  const relativeTarget = relative(root, target);
  return !(
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  );
};

export const lintLinks = (
  repoRoot: string,
  files: ReadonlyMap<string, string>,
): string[] => {
  const problems: string[] = [];
  const realRoot = realpathSync(repoRoot);
  for (const [rel, raw] of files) {
    const proseOnly = raw.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    for (const match of proseOnly.matchAll(linkPattern)) {
      const target = match[1] ?? '';
      if (externalTargetPattern.test(target)) continue;
      const path = target.split('#')[0];
      if (!path) continue;
      if (isAbsolute(path)) {
        problems.push(`[link] ${rel}: "${target}" resolves against the filesystem root; use a relative path`);
        continue;
      }
      const resolved = resolve(dirname(join(repoRoot, rel)), path);
      if (!isInside(repoRoot, resolved)) {
        problems.push(`[link] ${rel}: "${target}" resolves outside the repository`);
        continue;
      }
      if (!existsSync(resolved)) {
        problems.push(`[link] ${rel}: "${target}" points at a missing file`);
        continue;
      }
      if (!isInside(realRoot, realpathSync(resolved))) {
        problems.push(`[link] ${rel}: "${target}" resolves outside the repository through a symbolic link`);
      }
    }
  }
  return problems;
};
