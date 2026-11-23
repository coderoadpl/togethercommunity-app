import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  backoffDelayMs as dockerPullBackoff,
  isTransientPullFailure as dockerPullTransient,
} from './docker-pull.js';
import {
  backoffDelayMs,
  failureAnnotation,
  HEALTH_POLL_MS,
  HEALTH_WAIT_MS,
  isTransientPullFailure,
  MAX_PULL_ATTEMPTS,
  parseContainerState,
  parseServiceSpec,
  runArguments,
  startServiceContainer,
  type CommandResult,
  type ServiceDeps,
} from './service-container.js';

const inputs = {
  SERVICE_CONTAINER_NAME: 'postgres',
  SERVICE_CONTAINER_IMAGE: 'registry.example/postgres:16@sha256:' + 'a'.repeat(64),
  SERVICE_CONTAINER_PORT: '5432:5432',
  SERVICE_CONTAINER_ENV: 'POSTGRES_USER=together\nPOSTGRES_DB=together\n',
  SERVICE_CONTAINER_HEALTH_CMD: 'pg_isready -U together',
  SERVICE_CONTAINER_HEALTH_INTERVAL: '10s',
  SERVICE_CONTAINER_HEALTH_TIMEOUT: '5s',
  SERVICE_CONTAINER_HEALTH_RETRIES: '5',
};

const spec = parseServiceSpec(inputs);

const healthy = JSON.stringify({ Status: 'running', Health: { Status: 'healthy', Log: [] } });
const starting = JSON.stringify({ Status: 'running', Health: { Status: 'starting', Log: [] } });
const ok = (output = ''): CommandResult => ({ code: 0, output });
const failed = (output: string): CommandResult => ({ code: 1, output });

const harness = (responses: Partial<Record<string, CommandResult[]>>) => {
  let clock = 0;
  const calls: string[][] = [];
  const queues = new Map(Object.entries(responses).map(([command, results]) => [command, [...results ?? []]]));
  const deps: ServiceDeps = {
    docker: vi.fn(async (args: string[]) => {
      calls.push(args);
      const command = args[0] ?? '';
      const queue = queues.get(command) ?? [];
      return (queue.length > 1 ? queue.shift() : queue[0]) ?? ok();
    }),
    sleep: vi.fn(async (milliseconds: number) => { clock += milliseconds; }),
    now: () => clock,
    random: () => 0,
    log: vi.fn(),
  };
  return { deps, calls, commands: () => calls.map((args) => args[0]) };
};

describe('service container spec', () => {
  it('reads the inputs from the environment', () => {
    expect(spec).toEqual({
      name: 'postgres',
      image: inputs.SERVICE_CONTAINER_IMAGE,
      port: '5432:5432',
      env: ['POSTGRES_USER=together', 'POSTGRES_DB=together'],
      healthCmd: 'pg_isready -U together',
      healthInterval: '10s',
      healthTimeout: '5s',
      healthRetries: '5',
    });
  });

  it.each([
    ['SERVICE_CONTAINER_IMAGE', '', 'SERVICE_CONTAINER_IMAGE is not set'],
    ['SERVICE_CONTAINER_PORT', '5432', 'SERVICE_CONTAINER_PORT "5432" must match'],
    ['SERVICE_CONTAINER_ENV', 'not a pair', 'SERVICE_CONTAINER_ENV entry "not a pair" must match'],
    ['SERVICE_CONTAINER_HEALTH_RETRIES', '0', 'SERVICE_CONTAINER_HEALTH_RETRIES "0" must match'],
  ])('rejects %s=%j', (key, value, message) => {
    expect(() => parseServiceSpec({ ...inputs, [key]: value })).toThrow(`service-container: ${message}`);
  });

  it('starts the container detached from the pulled image with the port, environment and health check', () => {
    expect(runArguments(spec)).toEqual([
      'run', '--detach', '--pull', 'never', '--name', 'postgres', '--publish', '5432:5432',
      '--env', 'POSTGRES_USER=together', '--env', 'POSTGRES_DB=together',
      '--health-cmd', 'pg_isready -U together', '--health-interval', '10s', '--health-timeout', '5s',
      '--health-retries', '5', inputs.SERVICE_CONTAINER_IMAGE,
    ]);
  });
});

describe('startServiceContainer', () => {
  it('retries a throttled pull and then waits until the container is healthy', async () => {
    const { deps, commands } = harness({
      pull: [failed('Error response from daemon: toomanyrequests: Rate exceeded'), ok('pulled')],
      inspect: [ok(starting), ok(healthy)],
    });

    expect(await startServiceContainer(spec, deps)).toEqual({ ok: true, pullAttempts: 2 });
    expect(commands()).toEqual(['pull', 'pull', 'run', 'inspect', 'inspect']);
    expect(vi.mocked(deps.sleep).mock.calls).toEqual([[2000], [HEALTH_POLL_MS]]);
  });

  it('does not retry a non-transient pull error and reports the registry message', async () => {
    const { deps, commands } = harness({ pull: [failed('Pulling\nmanifest unknown: manifest unknown\n')] });

    expect(await startServiceContainer(spec, deps)).toEqual({
      ok: false,
      problem: `could not pull ${spec.image} after 1 attempt(s)`,
      lastMessage: 'manifest unknown: manifest unknown',
    });
    expect(commands()).toEqual(['pull']);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('stops after a bounded number of throttled pulls with a bounded total wait', async () => {
    const { deps, commands } = harness({ pull: [failed('toomanyrequests: You have reached your pull rate limit')] });

    expect(await startServiceContainer(spec, deps)).toEqual({
      ok: false,
      problem: `could not pull ${spec.image} after ${String(MAX_PULL_ATTEMPTS)} attempt(s) (registry throttling or a network error)`,
      lastMessage: 'toomanyrequests: You have reached your pull rate limit',
    });
    expect(commands()).toEqual(Array.from({ length: MAX_PULL_ATTEMPTS }, () => 'pull'));
    const waits = vi.mocked(deps.sleep).mock.calls.map(([milliseconds]) => milliseconds);
    expect(waits).toEqual([2000, 4000, 8000, 16000, 30000]);
    expect(waits.reduce((total, wait) => total + wait, 0)).toBeLessThanOrEqual(3 * 60_000);
  });

  it('fails when docker cannot start the container', async () => {
    const { deps, commands } = harness({ run: [failed('docker: Error response from daemon: port is already allocated.')] });

    expect(await startServiceContainer(spec, deps)).toEqual({
      ok: false,
      problem: 'could not start container postgres',
      lastMessage: 'docker: Error response from daemon: port is already allocated.',
    });
    expect(commands()).toEqual(['pull', 'run']);
  });

  it('logs the full output of a failed docker run and reports the daemon error, not the help hint', async () => {
    const output = [
      'docker: Error response from daemon: Conflict. The container name "/postgres" is already in use.',
      '',
      "Run 'docker run --help' for more information",
      '',
    ].join('\n');
    const { deps } = harness({ run: [{ code: 125, output }] });

    expect(await startServiceContainer(spec, deps)).toEqual({
      ok: false,
      problem: 'could not start container postgres',
      lastMessage: 'docker: Error response from daemon: Conflict. The container name "/postgres" is already in use.',
    });
    expect(vi.mocked(deps.log).mock.calls.flat().join('\n')).toContain(output);
  });

  it('logs the full output of a failed pull', async () => {
    const output = 'Error response from daemon: manifest for postgres:16 not found\nSee \'docker pull --help\'.\n';
    const { deps } = harness({ pull: [failed(output)] });

    const result = await startServiceContainer(spec, deps);

    expect(result).toMatchObject({ ok: false, lastMessage: 'Error response from daemon: manifest for postgres:16 not found' });
    expect(vi.mocked(deps.log).mock.calls.flat().join('\n')).toContain(output);
  });

  it('gives up at once on an unhealthy container and prints its logs', async () => {
    const unhealthy = JSON.stringify({
      Status: 'running',
      Health: { Status: 'unhealthy', Log: [{ Output: 'no response\n' }] },
    });
    const { deps, commands } = harness({ inspect: [ok(unhealthy)], logs: [ok('FATAL: bad config\n')] });

    expect(await startServiceContainer(spec, deps)).toEqual({
      ok: false,
      problem: 'container postgres did not become healthy within 180 s (state: running, health unhealthy)',
      lastMessage: 'no response',
    });
    expect(commands()).toEqual(['pull', 'run', 'inspect', 'logs']);
    expect(deps.log).toHaveBeenCalledWith('FATAL: bad config\n');
  });

  it('stops waiting for health after a bounded time', async () => {
    const { deps, calls } = harness({ inspect: [ok(starting)], logs: [ok('still starting\n')] });

    const result = await startServiceContainer(spec, deps);

    expect(result).toEqual({
      ok: false,
      problem: 'container postgres did not become healthy within 180 s (state: running, health starting)',
      lastMessage: 'still starting',
    });
    expect(calls.filter((args) => args[0] === 'inspect')).toHaveLength(HEALTH_WAIT_MS / HEALTH_POLL_MS + 1);
  });
});

describe('pull retry policy', () => {
  it.each([
    'toomanyrequests: pull rate limit exceeded',
    'Rate exceeded',
    'net/http: TLS handshake timeout',
    'unexpected EOF',
    'read: connection reset by peer',
    'manifest unknown',
    'permission denied',
    '',
  ])('classifies %j like the docker-pull script', (output) => {
    expect(isTransientPullFailure(output)).toBe(dockerPullTransient(output));
  });

  it('backs off like the docker-pull script', () => {
    for (const attempt of [1, 2, 3, 4, 5, 6]) {
      for (const random of [0, 0.5, 0.999]) {
        expect(backoffDelayMs(attempt, () => random)).toBe(dockerPullBackoff(attempt, () => random));
      }
    }
  });
});

describe('container state', () => {
  it.each([
    ['not JSON', 'nope', null],
    ['no health check', JSON.stringify({ Status: 'exited' }), { status: 'exited', health: null, lastProbe: null }],
    ['a probe log', JSON.stringify({ Status: 'running', Health: { Status: 'starting', Log: [{ Output: 'a\nb\n' }] } }),
      { status: 'running', health: 'starting', lastProbe: 'b' }],
  ])('parses %s', (_label, output, expected) => {
    expect(parseContainerState(output)).toEqual(expected);
  });
});

describe('failure annotation', () => {
  it('says the failure is CI infrastructure, not a test failure, with the last registry message', () => {
    expect(failureAnnotation('could not pull image after 6 attempt(s)', 'toomanyrequests: Rate exceeded')).toBe(
      '::error title=CI infrastructure::CI infrastructure failure (image pull or container start), not a test failure: could not pull image after 6 attempt(s). Last message: toomanyrequests: Rate exceeded',
    );
  });

  it('keeps a multi-line message on one annotation line', () => {
    expect(failureAnnotation('problem', 'a\nb')).not.toContain('\n');
  });
});

describe('service container entry point', () => {
  const stub = [
    '#!/bin/sh',
    'echo "$*" >> "$STUB_LOG"',
    'case "$1" in',
    '  pull) if [ -n "$STUB_PULL_ERROR" ]; then echo "$STUB_PULL_ERROR" >&2; exit 1; fi; echo pulled ;;',
    '  run) if [ -n "$STUB_RUN_ERROR" ]; then echo "$STUB_RUN_ERROR" >&2; echo >&2; echo "See \'docker run --help\'." >&2; exit 125; fi; echo container-id ;;',
    `  inspect) echo '${healthy}' ;;`,
    'esac',
    '',
  ].join('\n');

  const runEntry = (extra: Record<string, string>) => {
    const directory = mkdtempSync(join(tmpdir(), 'service-container-'));
    try {
      writeFileSync(join(directory, 'docker'), stub);
      chmodSync(join(directory, 'docker'), 0o755);
      const log = join(directory, 'calls.log');
      const result = spawnSync(process.execPath, [join(import.meta.dirname, 'service-container.ts')], {
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...inputs, ...extra, PATH: `${directory}:${process.env['PATH'] ?? ''}`, STUB_LOG: log },
      });
      if (result.error !== undefined) throw result.error;
      return { result, calls: readFileSync(log, 'utf8').trim().split('\n') };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it('pulls, starts and reports a healthy container through the docker command', () => {
    const { result, calls } = runEntry({});

    expect(result.status).toBe(0);
    expect(calls.map((line) => line.split(' ')[0])).toEqual(['pull', 'run', 'inspect']);
    expect(calls[1]).toContain('--publish 5432:5432');
    expect(result.stdout).toContain('postgres is healthy');
  });

  it('fails with the infrastructure annotation on a pull error', () => {
    const { result, calls } = runEntry({ STUB_PULL_ERROR: 'manifest unknown' });

    expect(result.status).toBe(1);
    expect(calls).toHaveLength(1);
    expect(result.stdout).toContain(
      '::error title=CI infrastructure::CI infrastructure failure (image pull or container start), not a test failure:',
    );
    expect(result.stdout).toContain('Last message: manifest unknown');
  });

  it('prints the whole docker run output before the annotation and names the daemon error in it', () => {
    const conflict = 'docker: Error response from daemon: Conflict. The container name "/postgres" is already in use.';
    const { result, calls } = runEntry({ STUB_RUN_ERROR: conflict });
    const annotationAt = result.stdout.indexOf('::error ');

    expect(result.status).toBe(1);
    expect(calls.map((line) => line.split(' ')[0])).toEqual(['pull', 'run']);
    expect(result.stdout.indexOf(conflict)).toBeGreaterThanOrEqual(0);
    expect(result.stdout.indexOf(conflict)).toBeLessThan(annotationAt);
    expect(result.stdout.indexOf("See 'docker run --help'.")).toBeLessThan(annotationAt);
    expect(result.stdout.slice(annotationAt)).toContain(`Last message: ${conflict}`);
    expect(result.stdout.slice(annotationAt)).not.toContain('--help');
  });
});
