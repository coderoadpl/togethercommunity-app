import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const newestFileMtime = (directory: string): number => {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestFileMtime(path));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
};

const fileMtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

const rebuildWeb = (rootDir: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(command, ['run', 'build:web'], {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm run build:web exited with code ${String(code)}`));
    });
  });

/** Rebuild the server-served SPA only when source mtimes prove it is stale. */
export const ensureWebBundleFresh = async (rootDir: string): Promise<void> => {
  const sourceDir = join(rootDir, 'apps/web/src');
  const indexPath = join(rootDir, 'dist/web/index.html');
  const newestSource = newestFileMtime(sourceDir);
  const bundle = fileMtime(indexPath);
  if (bundle >= newestSource) return;

  const reason = bundle === 0 ? 'is missing' : 'is older than apps/web/src';
  console.warn(
    `\n*** STALE WEB BUNDLE: dist/web/index.html ${reason}. Rebuilding with pnpm run build:web. ***\n`,
  );
  await rebuildWeb(rootDir);

  if (fileMtime(indexPath) < newestSource) {
    throw new Error('Web build completed, but dist/web/index.html is still older than apps/web/src');
  }
};
