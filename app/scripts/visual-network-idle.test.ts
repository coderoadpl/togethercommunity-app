import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisualNetworkIdle } from './visual-network-idle.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('visual network idle', () => {
  it('requires 500 uninterrupted quiet milliseconds after the latest frame navigation', async () => {
    const tracker = createVisualNetworkIdle();
    const resolved = vi.fn();
    const waiting = tracker.wait().then(resolved);
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).not.toHaveBeenCalled();
    tracker.frameNavigated();
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(resolved).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts the quiet window when a request interrupts it', async () => {
    const tracker = createVisualNetworkIdle();
    const request = {};
    const resolved = vi.fn();
    const waiting = tracker.wait().then(resolved);
    await vi.advanceTimersByTimeAsync(499);
    tracker.requestStarted(request, 'https://example.test/font.woff2');
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).not.toHaveBeenCalled();
    tracker.requestEnded(request);
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('resolves after idle, a late request and a child-frame navigation', async () => {
    const tracker = createVisualNetworkIdle();
    await vi.advanceTimersByTimeAsync(500);
    await tracker.wait();
    const request = {};
    tracker.requestStarted(request, 'https://example.test/late');
    tracker.requestEnded(request);
    tracker.frameNavigated();
    const resolved = vi.fn();
    const waiting = tracker.wait().then(resolved);
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('keeps idle latched through later requests without a frame navigation', async () => {
    const tracker = createVisualNetworkIdle();
    await vi.advanceTimersByTimeAsync(500);
    const request = {};
    tracker.requestStarted(request, 'https://example.test/late');
    await tracker.wait();
    tracker.requestEnded(request);
    await tracker.wait();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at 30000 milliseconds and names only requests still in flight', async () => {
    const tracker = createVisualNetworkIdle();
    const finished = {};
    tracker.requestStarted(finished, 'https://example.test/finished');
    tracker.requestStarted({}, 'https://example.test/held-one');
    tracker.requestStarted({}, 'https://example.test/held-two');
    tracker.requestEnded(finished);
    const rejected = vi.fn();
    const waiting = tracker.wait().catch(rejected);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(rejected).toHaveBeenCalledExactlyOnceWith(new Error('Network idle timed out after 30000 ms; requests still in flight: https://example.test/held-one, https://example.test/held-two'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for an in-flight request to end after a navigation, then for quiet', async () => {
    const tracker = createVisualNetworkIdle();
    await vi.advanceTimersByTimeAsync(500);
    const request = {};
    tracker.requestStarted(request, 'https://example.test/previous-document');
    tracker.frameNavigated();
    const resolved = vi.fn();
    const waiting = tracker.wait().then(resolved);
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).not.toHaveBeenCalled();
    tracker.requestEnded(request);
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('does not restart a quiet window on an unknown request end', async () => {
    const tracker = createVisualNetworkIdle();
    const waiting = tracker.wait();
    await vi.advanceTimersByTimeAsync(499);
    tracker.requestEnded({});
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves concurrent waiters and remains usable after a wait times out', async () => {
    const tracker = createVisualNetworkIdle();
    const request = {};
    tracker.requestStarted(request, 'https://example.test/held');
    const expired = expect(tracker.wait()).rejects.toThrow('30000 ms');
    await vi.advanceTimersByTimeAsync(30_000);
    await expired;
    const first = tracker.wait();
    const second = tracker.wait();
    tracker.requestEnded(request);
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([first, second]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
