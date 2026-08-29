import { NOTIFICATIONS_STREAM_PATH } from '#core/client/index.js';

export interface NotificationStreamSource {
  addEventListener(
    type: 'unread' | 'notification' | 'dm' | 'error' | 'open',
    listener: () => void,
  ): void;
  close(): void;
}

export interface NotificationsStreamHandle {
  close(): void;
}

export interface NotificationsStreamOptions {
  onEvent: () => void;
  /**
   * Called once the stream is unusable: no EventSource support, repeated errors,
   * or connections the host keeps cutting short.
   */
  onFallback: () => void;
  onStreaming?: () => void;
  createSource?: () => NotificationStreamSource;
  now?: () => number;
}

const MAX_STREAM_ERRORS = 2;

/** Serverless hosts cap a response well below this, so such a connection is a cut, not a drop. */
const SHORT_CONNECTION_MS = 60_000;

const MAX_SHORT_CONNECTIONS = 2;

const STREAMLESS_POLL_INTERVAL_MS = 30_000;

export const CONVERSATION_POLL_INTERVAL_MS = 5_000;

export const UNREAD_BADGE_POLL_INTERVAL_MS = 15_000;

export const streamlessPollInterval = (
  streamless: boolean,
  intervalMs: number = STREAMLESS_POLL_INTERVAL_MS,
): number | false => (streamless || typeof EventSource === 'undefined' ? intervalMs : false);

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
  const now = options.now ?? (() => Date.now());
  let errors = 0;
  let shortConnections = 0;
  let openedAt: number | null = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  source.addEventListener('open', () => {
    errors = 0;
    openedAt = now();
    options.onStreaming?.();
  });
  source.addEventListener('unread', options.onEvent);
  source.addEventListener('notification', options.onEvent);
  source.addEventListener('dm', options.onEvent);
  source.addEventListener('error', () => {
    errors += 1;
    if (openedAt !== null) {
      shortConnections = now() - openedAt < SHORT_CONNECTION_MS ? shortConnections + 1 : 0;
      openedAt = null;
    }
    if (errors < MAX_STREAM_ERRORS && shortConnections < MAX_SHORT_CONNECTIONS) return;
    close();
    options.onFallback();
  });
  return { close };
};
