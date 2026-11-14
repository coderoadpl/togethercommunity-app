import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

interface PullResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface PullOptions {
  runner?: (command: string, args: string[]) => Promise<PullResult>;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export const isTransientPullFailure = (output: string): boolean =>
  /toomanyrequests|Rate exceeded|TLS handshake timeout|unexpected EOF|connection reset/i.test(output);

export const backoffDelayMs = (attempt: number, random: () => number): number =>
  Math.min(2000 * 2 ** (attempt - 1), 30_000) + Math.floor(random() * 1000);

const runPull = (command: string, args: string[]): Promise<PullResult> =>
  new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => resolve({ code: 1, stdout, stderr: `${stderr}${String(error)}` }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export const dockerfileBaseImages = (dockerfile: string): string[] => {
  const images = new Set<string>();
  const stages = new Set<string>();
  for (const match of dockerfile.matchAll(/^\s*FROM\s+(?:--\S+\s+)*(?<image>\S+)(?:\s+AS\s+(?<stage>\S+))?/gimu)) {
    const image = match.groups?.['image'];
    const stage = match.groups?.['stage'];
    if (image !== undefined && !stages.has(image.toLowerCase())) images.add(image);
    if (stage !== undefined) stages.add(stage.toLowerCase());
  }
  return [...images];
};

export const pullImages = async (images: string[], options: PullOptions = {}): Promise<void> => {
  const { runner = runPull, sleep = setTimeout, random = Math.random } = options;
  for (const image of images) {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const result = await runner('docker', ['pull', image]);
      if (result.code === 0) break;
      const output = `${result.stdout}${result.stderr}`;
      if (attempt === 6 || !isTransientPullFailure(output)) {
        throw new Error(`docker pull ${image} failed:\n${output}`);
      }
      await sleep(backoffDelayMs(attempt, random));
    }
  }
};
