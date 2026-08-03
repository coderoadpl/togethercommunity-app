import type { RealtimeBusPort } from '#core/server/index.js';

const SSE_HEARTBEAT_MS = 25_000;

export const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-store',
  connection: 'keep-alive',
} as const;

const sseEvent = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export const createNotificationEventStream = (input: {
  tenantId: string;
  recipientUserId: string;
  bus: RealtimeBusPort;
  unreadCount: () => Promise<number>;
  heartbeatMs?: number;
}): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  };
  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(sseEvent('unread', { unread: await input.unreadCount() }));
      unsubscribe = input.bus.subscribe((event) => {
        if (event.tenantId !== input.tenantId || event.recipientUserId !== input.recipientUserId) return;
        send(sseEvent('notification', event.notification));
      });
      heartbeat = setInterval(() => send(': heartbeat\n\n'), input.heartbeatMs ?? SSE_HEARTBEAT_MS);
    },
    cancel: () => {
      cleanup();
    },
  });
};
