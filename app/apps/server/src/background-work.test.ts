import { afterEach, describe, expect, it, vi } from 'vitest';

import { keepAlive } from './background-work.js';

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

afterEach(() => {
  Reflect.deleteProperty(globalThis, REQUEST_CONTEXT);
  vi.unstubAllEnvs();
});

describe('keepAlive', () => {
  it('does not throw outside a Vercel request context', () => {
    expect(() => { keepAlive(Promise.resolve()); }).not.toThrow();
  });

  it('does not throw on Vercel when the platform exposes no request context', () => {
    vi.stubEnv('VERCEL', '1');

    expect(() => { keepAlive(Promise.resolve()); }).not.toThrow();
  });

  it('hands the task to the platform request context on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    const waitUntil = vi.fn();
    Reflect.set(globalThis, REQUEST_CONTEXT, { get: () => ({ waitUntil }) });
    const task = Promise.resolve();

    keepAlive(task);

    expect(waitUntil).toHaveBeenCalledExactlyOnceWith(task);
  });

  it('does not throw when the platform request context refuses the task', () => {
    vi.stubEnv('VERCEL', '1');
    Reflect.set(globalThis, REQUEST_CONTEXT, {
      get: () => ({ waitUntil: () => { throw new Error('no request context'); } }),
    });

    expect(() => { keepAlive(Promise.resolve()); }).not.toThrow();
  });
});
