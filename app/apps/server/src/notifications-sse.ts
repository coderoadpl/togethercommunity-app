import { realtimeEventKey } from '#core/server/index.js';
import type {
  DmConversationRepository,
  NotificationRepository,
  RealtimeBusPort,
  RealtimeEvent,
} from '#core/server/index.js';

const SSE_HEARTBEAT_MS = 10_000;
/** Serverless caps a request at 30 s, so the stream closes first and the client reconnects. */
const SSE_LIFETIME_MS = 25_000;
const SSE_RETRY_MS = 1_000;
const REPLAY_LIMIT = 20;
/**
 * Live delivery follows publish order across instances, not `createdAt` order, and instance
 * clocks drift, so the replay window reaches back behind the cursor by more than that drift.
 */
const REPLAY_TOLERANCE_MS = 5_000;

export const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-store',
  connection: 'keep-alive',
} as const;

interface ReplayCursor {
  at: string;
  id: string;
}

const eventCursor = (event: RealtimeEvent): ReplayCursor => ({
  at: event.createdAt,
  id: realtimeEventKey(event),
});

const compareCursors = (left: ReplayCursor, right: ReplayCursor): number => {
  if (left.at !== right.at) return left.at < right.at ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
};

const replayFloor = (since: ReplayCursor): ReplayCursor => {
  const at = Date.parse(since.at);
  return Number.isNaN(at)
    ? since
    : { at: new Date(at - REPLAY_TOLERANCE_MS).toISOString(), id: '' };
};

export const parseLastEventId = (value: string | undefined): ReplayCursor | null => {
  if (value === undefined) return null;
  const separator = value.indexOf('|');
  if (separator <= 0 || separator === value.length - 1) return null;
  return { at: value.slice(0, separator), id: value.slice(separator + 1) };
};

export const replayRealtimeEvents = async (input: {
  tenantId: string;
  recipientUserId: string;
  since: ReplayCursor;
  notifications: NotificationRepository;
  dmConversations: DmConversationRepository;
  limit?: number;
}): Promise<RealtimeEvent[]> => {
  const limit = input.limit ?? REPLAY_LIMIT;
  const [notified, conversations] = await Promise.all([
    input.notifications.listForRecipient(input.tenantId, {
      recipientUserId: input.recipientUserId,
      limit,
    }),
    input.dmConversations.listForParticipant(input.tenantId, {
      userId: input.recipientUserId,
      limit,
    }),
  ]);
  const events: RealtimeEvent[] = [
    ...notified.notifications.map((notification): RealtimeEvent => ({
      kind: 'notification',
      tenantId: input.tenantId,
      recipientUserId: input.recipientUserId,
      notificationId: notification.id,
      createdAt: notification.createdAt,
    })),
    ...conversations.conversations
      .filter(
        (conversation) =>
          conversation.lastMessageId !== null
          && conversation.lastMessageSenderUserId !== input.recipientUserId,
      )
      .map((conversation): RealtimeEvent => ({
        kind: 'dm',
        tenantId: input.tenantId,
        recipientUserId: input.recipientUserId,
        conversationId: conversation.id,
        createdAt: conversation.lastMessageAt,
      })),
  ];
  const floor = replayFloor(input.since);
  return events
    .filter((event) => {
      const cursor = eventCursor(event);
      return compareCursors(cursor, input.since) !== 0 && compareCursors(cursor, floor) > 0;
    })
    .sort((left, right) => compareCursors(eventCursor(left), eventCursor(right)));
};

const sseEvent = (event: string, data: unknown, id?: string): string =>
  `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const streamEventId = (event: RealtimeEvent): string => {
  const cursor = eventCursor(event);
  return `${cursor.at}|${cursor.id}`;
};

const realtimeChunk = (event: RealtimeEvent): string => {
  const id = streamEventId(event);
  return event.kind === 'notification'
    ? sseEvent('notification', { id: event.notificationId }, id)
    : sseEvent('dm', { conversationId: event.conversationId }, id);
};

export const createNotificationEventStream = (input: {
  tenantId: string;
  recipientUserId: string;
  bus: RealtimeBusPort;
  unreadCount: () => Promise<number>;
  replay?: () => Promise<RealtimeEvent[]>;
  heartbeatMs?: number;
  lifetimeMs?: number;
}): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lifetime: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
    if (lifetime !== null) clearTimeout(lifetime);
    lifetime = null;
  };
  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
          cleanup();
        }
      };
      lifetime = setTimeout(() => {
        if (!open) return;
        open = false;
        cleanup();
        controller.close();
      }, input.lifetimeMs ?? SSE_LIFETIME_MS);
      /** Subscribing after the replay query would drop anything published while it runs. */
      let buffered: RealtimeEvent[] | null = [];
      unsubscribe = input.bus.subscribe(
        { tenantId: input.tenantId, recipientUserId: input.recipientUserId },
        (event) => {
          if (buffered === null) send(realtimeChunk(event));
          else buffered.push(event);
        },
      );
      try {
        send(`retry: ${String(SSE_RETRY_MS)}\n\n`);
        send(sseEvent('unread', { unread: await input.unreadCount() }));
        const replayed = (await input.replay?.()) ?? [];
        for (const event of replayed) send(realtimeChunk(event));
        const alreadySent = new Set(replayed.map(streamEventId));
        const pending = buffered;
        buffered = null;
        for (const event of pending) {
          if (!alreadySent.has(streamEventId(event))) send(realtimeChunk(event));
        }
      } catch (error) {
        open = false;
        cleanup();
        throw error;
      }
      if (!open) return;
      heartbeat = setInterval(() => {
        send(': heartbeat\n\n');
      }, input.heartbeatMs ?? SSE_HEARTBEAT_MS);
    },
    cancel: () => {
      cleanup();
    },
  });
};
