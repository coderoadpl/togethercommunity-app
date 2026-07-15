import { describe, expect, it, vi } from 'vitest';

import { connectNotificationsStream, type NotificationStreamSource } from './notifications-stream.js';

class FakeEventSource implements NotificationStreamSource {
  closed = false;

  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(type: 'unread' | 'notification' | 'error', listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: 'unread' | 'notification' | 'error'): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe('notifications stream wrapper', () => {
  it('invalidates on unread and notification events', () => {
    const source = new FakeEventSource();
    const onEvent = vi.fn();
    connectNotificationsStream({ onEvent, onFallback: vi.fn(), createSource: () => source });

    source.emit('unread');
    source.emit('notification');

    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('falls back to polling after the stream errors twice', () => {
    const source = new FakeEventSource();
    const onFallback = vi.fn();
    connectNotificationsStream({ onEvent: vi.fn(), onFallback, createSource: () => source });

    source.emit('error');
    expect(onFallback).not.toHaveBeenCalled();
    expect(source.closed).toBe(false);

    source.emit('error');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(source.closed).toBe(true);
  });

  it('falls back immediately when EventSource is unavailable', () => {
    const onFallback = vi.fn();
    const handle = connectNotificationsStream({ onEvent: vi.fn(), onFallback });

    expect(onFallback).toHaveBeenCalledTimes(1);
    handle.close();
  });

  it('close stops the underlying source', () => {
    const source = new FakeEventSource();
    const handle = connectNotificationsStream({
      onEvent: vi.fn(),
      onFallback: vi.fn(),
      createSource: () => source,
    });

    handle.close();

    expect(source.closed).toBe(true);
  });
});
