import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, map, ok, unwrapOr, type Result } from './result.js';

const good: Result<number, string> = ok(2);
const bad: Result<number, string> = err('nope');

describe('Result helpers', () => {
  it('ok / err build the tagged union', () => {
    expect(good).toEqual({ ok: true, value: 2 });
    expect(bad).toEqual({ ok: false, error: 'nope' });
  });

  it('isOk / isErr narrow correctly', () => {
    expect(isOk(good)).toBe(true);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
    expect(isErr(good)).toBe(false);
  });

  it('unwrapOr returns the value or the fallback', () => {
    expect(unwrapOr(good, 99)).toBe(2);
    expect(unwrapOr(bad, 99)).toBe(99);
  });

  it('map transforms ok and passes err through untouched', () => {
    expect(map(good, (n: number) => n * 10)).toEqual({ ok: true, value: 20 });
    expect(map(bad, (n: number) => n * 10)).toBe(bad);
  });
});
