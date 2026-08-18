import { describe, expect, it, vi } from 'vitest';

import {
  connectNotificationsStream,
  streamlessPollInterval,
  type NotificationStreamSource,
} from './notifications-stream.js';

type StreamEvent = 'unread' | 'notification' | 'dm' | 'error';

class FakeEventSource implements NotificationStreamSource {
  closed = false;

  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(type: StreamEvent, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: StreamEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe('notifications stream wrapper', () => {
  it('invalidates on unread, notification and direct-message events', () => {
    const source = new FakeEventSource();
    const onEvent = vi.fn();
    connectNotificationsStream({ onEvent, onFallback: vi.fn(), createSource: () => source });

    source.emit('unread');
    source.emit('notification');
    source.emit('dm');

    expect(onEvent).toHaveBeenCalledTimes(3);
  });

  it('polls only where EventSource is missing', () => {
    expect(streamlessPollInterval()).toBe(30_000);
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
