import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type AppError, type Result } from '@core/domain/index.js';

import { emit } from './output.js';

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    stdout.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    stderr.push(String(line));
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const emitResult = <T>(result: Result<T, AppError>, json: boolean, human: (value: T) => string): void =>
  emit(result, json, human);

describe('emit — human mode', () => {
  it('prints the human string to stdout and leaves exit code unset on success', () => {
    emitResult(ok({ id: 'p1' }), false, (v) => `product ${v.id}`);
    expect(stdout).toEqual(['product p1']);
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints error(code): message to stderr and maps the exit code from the taxonomy', () => {
    emitResult(err({ code: 'unauthorized', message: 'log in' }), false, () => 'unused');
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['error(unauthorized): log in']);
    expect(process.exitCode).toBe(3);
  });
});

describe('emit — json mode', () => {
  it('prints exactly one success envelope and no exit code', () => {
    emitResult(ok({ n: 1 }), true, () => 'ignored');
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0] ?? '')).toEqual({ ok: true, data: { n: 1 } });
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints exactly one error envelope on stdout and still sets the exit code', () => {
    emitResult(err({ code: 'not_found', message: 'gone' }), true, () => 'ignored');
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0] ?? '')).toEqual({ ok: false, error: { code: 'not_found', message: 'gone' } });
    expect(process.exitCode).toBe(5);
  });
});

describe('emit — exit code per error kind', () => {
  it.each([
    ['validation', 2],
    ['unauthorized', 3],
    ['invalid_credentials', 3],
    ['forbidden', 4],
    ['not_found', 5],
    ['conflict', 6],
    ['tenant_not_found', 7],
    ['integration_not_configured', 8],
    ['integration_auth', 9],
    ['internal', 10],
    ['integration_unavailable', 11],
  ] as const)('maps %s to exit %d', (code, exit) => {
    emitResult(err({ code, message: code }), true, () => '');
    expect(process.exitCode).toBe(exit);
  });
});
