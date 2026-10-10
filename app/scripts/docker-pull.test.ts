import { describe, expect, it, vi } from 'vitest';

import { backoffDelayMs, isTransientPullFailure, pullImages } from './docker-pull.js';

const success = { code: 0, stdout: 'Pulled', stderr: '' };

describe('pullImages', () => {
  it('retries a transient failure and then succeeds', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'toomanyrequests' })
      .mockResolvedValueOnce(success);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await pullImages(['image:first'], { runner, sleep, random: () => 0 });

    expect(runner.mock.calls).toEqual([
      ['docker', ['pull', 'image:first']],
      ['docker', ['pull', 'image:first']],
    ]);
    expect(sleep.mock.calls).toEqual([[2000]]);
  });

  it('throws immediately with Docker output for a non-transient failure', async () => {
    const runner = vi.fn().mockResolvedValue({ code: 1, stdout: 'Pulling image\n', stderr: 'manifest unknown' });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pullImages(['image:missing'], { runner, sleep }))
      .rejects.toThrow('docker pull image:missing failed:\nPulling image\nmanifest unknown');

    expect(runner).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops after six transient failures and includes the last output', async () => {
    let attempts = 0;
    const runner = vi.fn(async () => {
      attempts += 1;
      return { code: 1, stdout: `Attempt ${String(attempts)}\n`, stderr: 'toomanyrequests' };
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pullImages(['image:first', 'image:second'], { runner, sleep, random: () => 0 }))
      .rejects.toThrow('docker pull image:first failed:\nAttempt 6\ntoomanyrequests');

    expect(runner).toHaveBeenCalledTimes(6);
    expect(runner.mock.calls).toEqual(
      Array.from({ length: 6 }, () => ['docker', ['pull', 'image:first']]),
    );
    expect(sleep.mock.calls).toEqual([[2000], [4000], [8000], [16000], [30000]]);
  });

  it('waits for each pull to finish before starting the next image', async () => {
    let finishFirst = (): void => {};
    const firstFinished = new Promise<void>((resolve) => { finishFirst = resolve; });
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args[1] === 'image:first') await firstFinished;
      return success;
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const pulling = pullImages(['image:first', 'image:second'], { runner, sleep });
    expect(runner.mock.calls).toEqual([['docker', ['pull', 'image:first']]]);
    finishFirst();
    await pulling;

    expect(runner.mock.calls).toEqual([
      ['docker', ['pull', 'image:first']],
      ['docker', ['pull', 'image:second']],
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('backoffDelayMs', () => {
  it('doubles from two seconds and caps the base delay at thirty seconds', () => {
    expect([1, 2, 3, 4, 5, 6].map((attempt) => backoffDelayMs(attempt, () => 0)))
      .toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('adds up to one second of jitter after capping the base delay', () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(2500);
    expect(backoffDelayMs(6, () => 0.999)).toBe(30999);
  });
});

describe('isTransientPullFailure', () => {
  it.each([
    'toomanyrequests: pull rate limit exceeded',
    'Rate exceeded',
    'net/http: TLS handshake timeout',
    'unexpected EOF',
    'read: connection reset by peer',
    'TOOMANYREQUESTS',
    'rate EXCEEDED',
  ])('recognizes %s', (output) => {
    expect(isTransientPullFailure(output)).toBe(true);
  });

  it.each(['', 'manifest unknown', 'permission denied', 'Cannot connect to the Docker daemon'])
    ('rejects %s', (output) => {
      expect(isTransientPullFailure(output)).toBe(false);
    });
});
