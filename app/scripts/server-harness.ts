import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const tsxBin = join(rootDir, 'node_modules', '.bin', 'tsx');
export const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const run = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  cwd = rootDir,
): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) =>
      resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }),
    );
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

export const ephemeralPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate an ephemeral port')));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });

const portIsFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });

export const killServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  signalGroup('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL');
};

export interface BootServerOptions {
  port: number;
  healthUrl: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export const bootServer = async ({
  port,
  healthUrl,
  env,
  timeoutMs = 20_000,
}: BootServerOptions): Promise<ChildProcess> => {
  if (!(await portIsFree(port))) throw new Error(`Port ${String(port)} is already occupied`);
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    detached: true,
    env: { ...process.env, ...env, PORT: String(port) },
  });
  let logs = '';
  let exitInfo: string | null = null;
  child.stdout?.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.on('exit', (code, signal) => {
    exitInfo = `code=${String(code)} signal=${String(signal)}`;
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitInfo !== null) {
      throw new Error(
        `Server exited before becoming ready (${exitInfo}).\n--- server output ---\n${logs}`,
      );
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return child;
    } catch {
      await delay(250);
      continue;
    }
    await delay(250);
  }

  await killServer(child);
  throw new Error(
    `Server did not become ready within ${String(timeoutMs)}ms on port ${String(port)}.\n--- server output ---\n${logs}`,
  );
};
