import { describe, expect, it, vi } from 'vitest';

import {
  CONVERSATION_POLL_INTERVAL_MS,
  connectNotificationsStream,
  streamlessPollInterval,
  type NotificationStreamSource,
} from './notifications-stream.js';

type StreamEvent = 'unread' | 'notification' | 'dm' | 'error' | 'open';

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

  it('polls where EventSource is missing or the stream fell back', () => {
    expect(streamlessPollInterval(false)).toBe(30_000);
    expect(streamlessPollInterval(true, CONVERSATION_POLL_INTERVAL_MS)).toBe(5_000);
  });

  it('forgets errors once the stream reopens', () => {
    const source = new FakeEventSource();
    const onFallback = vi.fn();
    connectNotificationsStream({ onEvent: vi.fn(), onFallback, createSource: () => source });

    source.emit('error');
    source.emit('open');
    source.emit('error');

    expect(onFallback).not.toHaveBeenCalled();
    expect(source.closed).toBe(false);
  });

  it('reports streaming again when a reconnected source opens', () => {
    const source = new FakeEventSource();
    const onStreaming = vi.fn();
    connectNotificationsStream({
      onEvent: vi.fn(),
      onFallback: vi.fn(),
      onStreaming,
      createSource: () => source,
    });

    source.emit('open');

    expect(onStreaming).toHaveBeenCalledTimes(1);
  });

  it('falls back once the host keeps cutting connections short', () => {
    const source = new FakeEventSource();
    const onFallback = vi.fn();
    let clock = 0;
    connectNotificationsStream({
      onEvent: vi.fn(),
      onFallback,
      createSource: () => source,
      now: () => clock,
    });

    source.emit('open');
    clock = 1_000;
    source.emit('error');
    expect(onFallback).not.toHaveBeenCalled();

    source.emit('open');
    clock = 2_000;
    source.emit('error');

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(source.closed).toBe(true);
  });

  it('keeps streaming across the planned stream rotation', () => {
    const source = new FakeEventSource();
    const onFallback = vi.fn();
    let clock = 0;
    connectNotificationsStream({
      onEvent: vi.fn(),
      onFallback,
      createSource: () => source,
      now: () => clock,
    });

    source.emit('open');
    clock = 25_000;
    source.emit('error');
    source.emit('open');
    clock = 50_000;
    source.emit('error');

    expect(onFallback).not.toHaveBeenCalled();
    expect(source.closed).toBe(false);
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
