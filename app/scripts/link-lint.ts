import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const linkPattern = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const externalTargetPattern = /^(https?:|mailto:|tel:|\/\/|#)/;

export const lintLinks = (
  repoRoot: string,
  files: ReadonlyMap<string, string>,
): string[] => {
  const problems: string[] = [];
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
      const relativeTarget = relative(repoRoot, resolved);
      if (
        relativeTarget === '..' ||
        relativeTarget.startsWith(`..${sep}`) ||
        isAbsolute(relativeTarget)
      ) {
        problems.push(`[link] ${rel}: "${target}" resolves outside the repository`);
        continue;
      }
      if (!existsSync(resolved)) {
        problems.push(`[link] ${rel}: "${target}" points at a missing file`);
      }
    }
  }
  return problems;
};
