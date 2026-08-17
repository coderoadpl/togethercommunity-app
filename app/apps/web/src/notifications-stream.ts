import { NOTIFICATIONS_STREAM_PATH } from '#core/client/index.js';

export interface NotificationStreamSource {
  addEventListener(type: 'unread' | 'notification' | 'dm' | 'error', listener: () => void): void;
  close(): void;
}

export interface NotificationsStreamHandle {
  close(): void;
}

export interface NotificationsStreamOptions {
  onEvent: () => void;
  /** Called once the stream is unusable (no EventSource support or repeated errors). */
  onFallback: () => void;
  createSource?: () => NotificationStreamSource;
}

const MAX_STREAM_ERRORS = 2;

const STREAMLESS_POLL_INTERVAL_MS = 30_000;

export const streamlessPollInterval = (): number | false =>
  typeof EventSource === 'undefined' ? STREAMLESS_POLL_INTERVAL_MS : false;

const defaultSource = (): NotificationStreamSource | null =>
  typeof EventSource === 'undefined' ? null : new EventSource(NOTIFICATIONS_STREAM_PATH);

export const connectNotificationsStream = (
  options: NotificationsStreamOptions,
): NotificationsStreamHandle => {
  const source = options.createSource?.() ?? defaultSource();
  if (source === null) {
    options.onFallback();
    return { close: () => undefined };
  }
  let errors = 0;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  source.addEventListener('unread', options.onEvent);
  source.addEventListener('notification', options.onEvent);
  source.addEventListener('dm', options.onEvent);
  source.addEventListener('error', () => {
    errors += 1;
    if (errors < MAX_STREAM_ERRORS) return;
    close();
    options.onFallback();
  });
  return { close };
};
