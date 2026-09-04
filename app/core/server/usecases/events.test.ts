import { describe, expect, it } from 'vitest';

import {
  NO_DM_BLOCKS,
  type Identity,
  type Member,
  type Notification,
  type Post,
  type Product,
  type ProductGrant,
  type Space,
  type SpaceEvent,
  type SpaceEventRsvp,
  type SpaceEventRsvpStatus,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  IdGenerator,
  NotificationChannelPort,
  NotificationRepository,
  SpaceEventRepository,
  SpaceEventRsvpRepository,
  SpaceSubscription,
  ThreadSubscription,
} from '../ports.js';
import {
  createEvent,
  deleteEvent,
  getEvent,
  getEventIcs,
  listSpaceEvents,
  listUpcomingEvents,
  rsvpEvent,
  updateEvent,
  type EventsDeps,
} from './events.js';

const NOW = '2026-09-01T10:00:00.000Z';
const SOON = '2026-09-02T18:00:00.000Z';
const SOON_END = '2026-09-02T20:00:00.000Z';
const LONG_AGO = '2026-08-01T18:00:00.000Z';
const LONG_AGO_END = '2026-08-01T20:00:00.000Z';
const BUNNY_EMBED = 'https://iframe.mediadelivery.net/embed/12345/6a7b8c9d-1e2f-4a5b-8c9d-0e1f2a3b4c5d';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: 'u1',
  email: 'u1@example.com',
  name: 'User One',
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'tenant',
  tenantName: 'Tenant',
  staffRole: null,
  memberId: 'm1',
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  ...overrides,
});

const ctx = (overrides: Partial<Identity> = {}): Ctx => ({ identity: identity(overrides) });

const staffCtx = (): Ctx => ctx({ userId: 'u-staff', memberId: null, staffRole: 'admin' });

const member = (overrides: Partial<Member> & { id: string; userId: string }): Member => ({
  tenantId: 't1',
  email: `${overrides.userId}@example.com`,
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: NOW,
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
  dmOptOutAt: null,
  ...overrides,
});

const space = (overrides: Partial<Space> & { id: string }): Space => ({
  tenantId: 't1',
  slug: overrides.id,
  name: 'Otwarta',
  description: null,
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: NOW,
  ...overrides,
});

const event = (overrides: Partial<SpaceEvent> & { id: string }): SpaceEvent => ({
  tenantId: 't1',
  spaceId: 's-open',
  title: 'Warsztat',
  description: null,
  startsAt: SOON,
  endsAt: SOON_END,
  location: null,
  url: null,
  liveEmbedUrl: null,
  replayUrl: null,
  discussionRootPostId: null,
  createdByUserId: 'u-staff',
  createdAt: NOW,
  updatedAt: null,
  deletedAt: null,
  ...overrides,
});

const product = (id: string): Product => ({
  id,
  tenantId: 't1',
  type: 'course',
  slug: id,
  title: id,
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: NOW,
});

const grant = (memberId: string, productId: string): ProductGrant => ({
  id: `grant-${memberId}-${productId}`,
  tenantId: 't1',
  memberId,
  productId,
  source: 'manual',
  startsAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  legacyId: null,
  createdAt: NOW,
});

class SequenceIds implements IdGenerator {
  private next = 1;

  nextId(): string {
    const id = `id-${String(this.next)}`;
    this.next += 1;
    return id;
  }
}

class FixedClock implements Clock {
  constructor(private readonly stamp: string) {}

  nowIso(): string {
    return this.stamp;
  }
}

class FakeEvents implements SpaceEventRepository {
  constructor(readonly rows: SpaceEvent[]) {}

  async findById(tenantId: string, id: string): Promise<SpaceEvent | null> {
    return this.rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;
  }

  async insert(_tenantId: string, spaceEvent: SpaceEvent): Promise<SpaceEvent> {
    this.rows.push(spaceEvent);
    return spaceEvent;
  }

  async update(tenantId: string, spaceEvent: SpaceEvent): Promise<SpaceEvent | null> {
    const index = this.rows.findIndex((row) => row.tenantId === tenantId && row.id === spaceEvent.id);
    if (index < 0) return null;
    this.rows[index] = spaceEvent;
    return spaceEvent;
  }

  async softDelete(
    tenantId: string,
    input: { id: string; deletedAt: string },
  ): Promise<SpaceEvent | null> {
    const index = this.rows.findIndex((row) => row.tenantId === tenantId && row.id === input.id);
    const row = this.rows[index];
    if (!row) return null;
    const next: SpaceEvent = { ...row, deletedAt: input.deletedAt };
    this.rows[index] = next;
    return next;
  }

  async listForSpace(
    tenantId: string,
    query: { spaceId: string; scope: 'upcoming' | 'past'; now: string; cursor?: string; limit: number },
  ): Promise<{ events: SpaceEvent[]; nextCursor: string | null }> {
    const cursorOf = (row: SpaceEvent): string => `${row.startsAt}|${row.id}`;
    const upcoming = query.scope === 'upcoming';
    const matching = this.rows
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.spaceId === query.spaceId &&
          row.deletedAt === null &&
          (upcoming ? row.endsAt >= query.now : row.endsAt < query.now) &&
          (query.cursor === undefined ||
            (upcoming ? cursorOf(row) > query.cursor : cursorOf(row) < query.cursor)),
      )
      .sort((left, right) =>
        upcoming
          ? cursorOf(left).localeCompare(cursorOf(right))
          : cursorOf(right).localeCompare(cursorOf(left)),
      );
    const page = matching.slice(0, query.limit);
    const overflow = matching[query.limit];
    const last = page.at(-1);
    return { events: page, nextCursor: overflow && last ? cursorOf(last) : null };
  }

  async listUpcomingForSpaces(
    tenantId: string,
    query: { spaceIds: string[]; now: string; limit: number },
  ): Promise<SpaceEvent[]> {
    return this.rows
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          query.spaceIds.includes(row.spaceId) &&
          row.deletedAt === null &&
          row.endsAt >= query.now,
      )
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
      .slice(0, query.limit);
  }
}

class FakeEventRsvps implements SpaceEventRsvpRepository {
  readonly rows: SpaceEventRsvp[] = [];

  async upsert(
    tenantId: string,
    input: { eventId: string; userId: string; status: SpaceEventRsvpStatus; updatedAt: string },
  ): Promise<SpaceEventRsvp> {
    const index = this.rows.findIndex(
      (row) => row.tenantId === tenantId && row.eventId === input.eventId && row.userId === input.userId,
    );
    const next: SpaceEventRsvp = { tenantId, ...input };
    if (index < 0) this.rows.push(next);
    else this.rows[index] = next;
    return next;
  }

  async countsForEvents(
    tenantId: string,
    eventIds: string[],
  ): Promise<Map<string, { going: number; notGoing: number }>> {
    return new Map(
      eventIds.map((eventId) => {
        const rows = this.rows.filter((row) => row.tenantId === tenantId && row.eventId === eventId);
        return [
          eventId,
          {
            going: rows.filter((row) => row.status === 'going').length,
            notGoing: rows.filter((row) => row.status === 'not-going').length,
          },
        ];
      }),
    );
  }

  async listForViewer(
    tenantId: string,
    input: { userId: string; eventIds: string[] },
  ): Promise<SpaceEventRsvp[]> {
    return this.rows.filter(
      (row) =>
        row.tenantId === tenantId && row.userId === input.userId && input.eventIds.includes(row.eventId),
    );
  }
}

class FakeNotifications implements NotificationRepository {
  readonly rows: Notification[] = [];

  async insert(_tenantId: string, notification: Notification): Promise<Notification> {
    this.rows.push(notification);
    return notification;
  }

  async insertMany(_tenantId: string, batch: Notification[]): Promise<Notification[]> {
    this.rows.push(...batch);
    return batch;
  }

  async listForRecipient(): Promise<{ notifications: Notification[]; nextCursor: string | null }> {
    return { notifications: this.rows, nextCursor: null };
  }

  async markRead(): Promise<Notification | null> {
    return null;
  }

  async markAllRead(): Promise<number> {
    return 0;
  }

  async unreadCount(): Promise<number> {
    return 0;
  }

  async hasUnreadDmNotification(): Promise<boolean> {
    return false;
  }

  async markDmConversationRead(): Promise<number> {
    return 0;
  }
}

const MEMBERS: Member[] = [
  member({ id: 'm1', userId: 'u1' }),
  member({ id: 'm2', userId: 'u2' }),
  member({ id: 'm3', userId: 'u3' }),
];

interface Fixture {
  deps: EventsDeps;
  events: FakeEvents;
  rsvps: FakeEventRsvps;
  notifications: FakeNotifications;
  posts: Post[];
  threadSubscriptions: ThreadSubscription[];
  delivered: Array<{ userId: string; url: string }>;
}

const fixture = (input: {
  spaces?: Space[];
  events?: SpaceEvent[];
  followers?: string[];
  bannedUserIds?: string[];
  staffUserIds?: string[];
  grants?: ProductGrant[];
  products?: Product[];
  now?: string;
} = {}): Fixture => {
  const spaces = input.spaces ?? [space({ id: 's-open' })];
  const events = new FakeEvents(input.events ?? []);
  const rsvps = new FakeEventRsvps();
  const notifications = new FakeNotifications();
  const posts: Post[] = [];
  const threadSubscriptions: ThreadSubscription[] = [];
  const delivered: Array<{ userId: string; url: string }> = [];
  const followers: SpaceSubscription[] = (input.followers ?? []).map((userId) => ({
    tenantId: 't1',
    userId,
    spaceId: spaces[0]?.id ?? 's-open',
    createdAt: NOW,
  }));
  const channel: NotificationChannelPort = {
    deliver: async (notification, context) => {
      delivered.push({ userId: notification.recipientUserId, url: context.contextUrl });
      return { ok: true, value: undefined };
    },
  };
  const staffUserIds = input.staffUserIds ?? ['u-staff'];
  const grants = input.grants ?? [];
  const products = input.products ?? [];
  const deps: EventsDeps = {
    events,
    eventRsvps: rsvps,
    spaces: {
      list: async (tenantId, options) =>
        spaces.filter(
          (row) => row.tenantId === tenantId && (options?.includeArchived === true || row.archivedAt === null),
        ),
      findById: async (tenantId, id) =>
        spaces.find((row) => row.tenantId === tenantId && row.id === id) ?? null,
      findBySlug: async () => null,
      create: async () => undefined,
      update: async () => null,
      setArchived: async () => null,
      delete: async () => false,
      stats: async () => new Map(),
    },
    posts: {
      createPost: async (_tenantId, created) => {
        posts.push(created);
        return created;
      },
      findById: async (tenantId, id) =>
        posts.find((row) => row.tenantId === tenantId && row.id === id) ?? null,
      findByIds: async () => [],
      countByAuthorSince: async () => 0,
      listRecentBodiesByAuthor: async () => [],
      listByAuthor: async () => [],
      listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
      listThreadsForSpaces: async () => ({ threads: [], nextCursor: null }),
      listReplies: async () => [],
      updateBody: async () => null,
      softDelete: async () => null,
      setPinned: async () => null,
      listPinnedForContext: async () => [],
      countPinnedForContext: async () => 0,
      latestRootPostAt: async () => new Map(),
      search: async () => [],
    },
    threadSubscriptions: {
      upsert: async (tenantId, subscription) => {
        const row: ThreadSubscription = { tenantId, ...subscription, mutedAt: null };
        threadSubscriptions.push(row);
        return row;
      },
      mute: async () => null,
      listSubscribersPage: async () => [],
      listForUser: async () => [],
    },
    spaceSubscriptions: {
      follow: async () => undefined,
      unfollow: async () => false,
      listFollowersPage: async (tenantId, query) =>
        followers
          .filter((row) => row.tenantId === tenantId && row.spaceId === query.spaceId)
          .filter((row) => query.afterUserId === null || row.userId > query.afterUserId)
          .sort((left, right) => left.userId.localeCompare(right.userId))
          .slice(0, query.limit),
      listForUser: async () => [],
    },
    memberBlocks: {
      block: async () => true,
      unblock: async () => true,
      findDirections: async (_tenantId, query) =>
        new Map(query.otherUserIds.map((userId) => [userId, NO_DM_BLOCKS])),
    },
    notifications,
    notificationChannels: [channel],
    fanoutJobs: { claimDue: async () => [], save: async () => undefined },
    grants: {
      findById: async () => null,
      findGrant: async () => null,
      createGrant: async () => true,
      setGrantWindow: async () => null,
      revokeGrant: async () => null,
      listForMemberWithProductNames: async () => [],
      listActiveForMember: async (tenantId, memberId) =>
        grants.filter((row) => row.tenantId === tenantId && row.memberId === memberId),
      listGrantedProducts: async () => products,
    },
    tenantAccess: {
      listTenantsForStaff: async () => [],
      listStaffForTenant: async () => [],
      findStaffGrant: async (userId, lookup) =>
        'tenantId' in lookup && lookup.tenantId === 't1' && staffUserIds.includes(userId)
          ? {
              tenant: {
                id: 't1',
                slug: 'tenant',
                name: 'Tenant',
                status: 'active',
                plan: 'hosted',
                contentVersion: 1,
              },
              staffRole: 'admin',
            }
          : null,
      findMember: async (tenantId, userId) => {
        const found = MEMBERS.find((row) => row.tenantId === tenantId && row.userId === userId) ?? null;
        if (found === null || !(input.bannedUserIds ?? []).includes(userId)) return found;
        return { ...found, bannedAt: NOW };
      },
    },
    links: {
      lessonDiscussionUrl: () => 'http://tenant.localhost/my',
      spaceUrl: ({ spaceId }) => `http://tenant.localhost/community/${spaceId}`,
      conversationUrl: () => 'http://tenant.localhost/messages',
      eventUrl: ({ spaceId, eventId }) =>
        `http://tenant.localhost/community/${spaceId}/events/${eventId}`,
    },
    ids: new SequenceIds(),
    clock: new FixedClock(input.now ?? NOW),
    avatarSources: {
      listAvatarSources: async (tenantId, userIds) =>
        MEMBERS.filter((row) => row.tenantId === tenantId && userIds.includes(row.userId)).map(
          (row) => ({ userId: row.userId, email: row.email, image: null }),
        ),
    },
    contentHash: { sha256: (content) => `digest(${String(content)})` },
  };
  return { deps, events, rsvps, notifications, posts, threadSubscriptions, delivered };
};

const validInput = {
  spaceId: 's-open',
  title: 'Warsztat',
  startsAt: SOON,
  endsAt: SOON_END,
};

describe('createEvent', () => {
  it('refuses a member without the staff capability', async () => {
    const f = fixture();

    const created = await createEvent(ctx(), validInput, f.deps);

    expect(created).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('rejects an event that ends before it starts', async () => {
    const f = fixture();

    const created = await createEvent(
      staffCtx(),
      { ...validInput, startsAt: SOON_END, endsAt: SOON },
      f.deps,
    );

    expect(created).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(f.events.rows).toEqual([]);
  });

  it('keeps the live and replay embeds of a new event', async () => {
    const f = fixture();

    const created = await createEvent(
      staffCtx(),
      { ...validInput, liveEmbedUrl: BUNNY_EMBED, replayUrl: 'https://vimeo.com/76979871' },
      f.deps,
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      liveEmbedUrl: BUNNY_EMBED,
      replayUrl: 'https://player.vimeo.com/video/76979871',
    });
  });

  it('rejects an archived space and answers not_found for a missing one', async () => {
    const f = fixture({
      spaces: [space({ id: 's-open', archivedAt: '2026-08-01T00:00:00.000Z' })],
    });

    expect(await createEvent(staffCtx(), validInput, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(await createEvent(staffCtx(), { ...validInput, spaceId: 'nope' }, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('auto-creates the discussion thread and subscribes its author', async () => {
    const f = fixture();

    const created = await createEvent(staffCtx(), validInput, f.deps);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0]).toMatchObject({
      contextKind: 'space',
      contextId: 's-open',
      authorUserId: 'u-staff',
      authorIsStaff: true,
      body: 'Wątek wydarzenia: Warsztat',
    });
    expect(created.value.discussionRootPostId).toBe(f.posts[0]?.id);
    expect(f.threadSubscriptions).toMatchObject([{ userId: 'u-staff' }]);
  });

  it('notifies followers exactly once and never re-runs the space-post fan-out', async () => {
    const f = fixture({ followers: ['u1', 'u2', 'u-staff'] });

    const created = await createEvent(staffCtx(), validInput, f.deps);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(f.notifications.rows.map((row) => row.recipientUserId)).toEqual(['u1', 'u2']);
    expect(f.notifications.rows.every((row) => row.kind === 'space-event')).toBe(true);
    expect(f.notifications.rows[0]?.payload).toMatchObject({
      contextKind: 'space',
      contextId: 's-open',
      eventId: created.value.id,
      lessonName: 'Otwarta',
      snippet: `Warsztat · ${SOON}`,
    });
    expect(f.delivered).toEqual([
      { userId: 'u1', url: `http://tenant.localhost/community/s-open/events/${created.value.id}` },
      { userId: 'u2', url: `http://tenant.localhost/community/s-open/events/${created.value.id}` },
    ]);
  });

  it('skips a banned follower while the rest of the space still hears about the event', async () => {
    const f = fixture({ followers: ['u1', 'u2'], bannedUserIds: ['u2'] });

    await createEvent(staffCtx(), validInput, f.deps);

    expect(f.notifications.rows.map((row) => row.recipientUserId)).toEqual(['u1']);
    expect(f.delivered.map((row) => row.userId)).toEqual(['u1']);
  });

  it('skips followers who lost access to a product-gated space', async () => {
    const f = fixture({
      spaces: [space({ id: 's-open', visibility: 'product', productIds: ['p-club'] })],
      followers: ['u1', 'u2'],
      grants: [grant('m1', 'p-club')],
      products: [product('p-club')],
    });

    await createEvent(staffCtx(), validInput, f.deps);

    expect(f.notifications.rows.map((row) => row.recipientUserId)).toEqual(['u1']);
  });
});

describe('event reads', () => {
  it('lists upcoming events ascending and past events descending', async () => {
    const f = fixture({
      events: [
        event({ id: 'e-past', startsAt: LONG_AGO, endsAt: LONG_AGO_END }),
        event({ id: 'e-late', startsAt: '2026-09-05T18:00:00.000Z', endsAt: '2026-09-05T20:00:00.000Z' }),
        event({ id: 'e-soon' }),
      ],
    });

    const upcoming = await listSpaceEvents(ctx(), { spaceId: 's-open' }, f.deps);
    const past = await listSpaceEvents(ctx(), { spaceId: 's-open', scope: 'past' }, f.deps);

    expect(upcoming.ok && upcoming.value.events.map((row) => row.id)).toEqual(['e-soon', 'e-late']);
    expect(past.ok && past.value.events.map((row) => row.id)).toEqual(['e-past']);
  });

  it('hides events of a space the member cannot access', async () => {
    const f = fixture({
      spaces: [space({ id: 's-open', visibility: 'product', productIds: ['p-club'] })],
      events: [event({ id: 'e-soon' })],
    });

    expect(await listSpaceEvents(ctx(), { spaceId: 's-open' }, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await getEvent(ctx(), { eventId: 'e-soon' }, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('answers not_found for an event of another tenant or a deleted one', async () => {
    const f = fixture({
      events: [
        event({ id: 'e-other', tenantId: 't2' }),
        event({ id: 'e-gone', deletedAt: NOW }),
      ],
    });

    for (const eventId of ['e-other', 'e-gone', 'e-missing']) {
      expect(await getEvent(ctx(), { eventId }, f.deps)).toMatchObject({
        ok: false,
        error: { code: 'not_found' },
      });
    }
  });

  it('marks an ongoing event with a live embed as live', async () => {
    const f = fixture({
      events: [
        event({
          id: 'e-live',
          startsAt: '2026-09-01T09:00:00.000Z',
          endsAt: '2026-09-01T11:00:00.000Z',
          liveEmbedUrl: BUNNY_EMBED,
        }),
      ],
    });

    const found = await getEvent(ctx(), { eventId: 'e-live' }, f.deps);

    expect(found.ok && found.value.liveNow).toBe(true);
  });

  it('collects upcoming events across every accessible space', async () => {
    const f = fixture({
      spaces: [
        space({ id: 's-open' }),
        space({ id: 's-club', visibility: 'product', productIds: ['p-club'] }),
      ],
      events: [
        event({ id: 'e-open' }),
        event({ id: 'e-club', spaceId: 's-club', startsAt: LONG_AGO, endsAt: LONG_AGO_END }),
      ],
    });

    const listed = await listUpcomingEvents(ctx(), {}, f.deps);

    expect(listed.ok && listed.value.events.map((row) => row.id)).toEqual(['e-open']);
  });

  it('returns a calendar file for an accessible event', async () => {
    const f = fixture({ events: [event({ id: 'e-soon' })] });

    const ics = await getEventIcs(ctx(), { eventId: 'e-soon' }, f.deps);

    expect(ics.ok).toBe(true);
    if (!ics.ok) return;
    expect(ics.value.fileName).toBe('event-e-soon.ics');
    expect(ics.value.icsContent).toContain('SUMMARY:Warsztat');
  });
});

describe('rsvpEvent', () => {
  it('upserts the viewer answer and reports the counts', async () => {
    const f = fixture({ events: [event({ id: 'e-soon' })] });

    const going = await rsvpEvent(ctx(), { eventId: 'e-soon', status: 'going' }, f.deps);
    const changed = await rsvpEvent(ctx(), { eventId: 'e-soon', status: 'not-going' }, f.deps);
    await rsvpEvent(ctx({ userId: 'u2', memberId: 'm2' }), { eventId: 'e-soon', status: 'going' }, f.deps);
    const other = await getEvent(ctx({ userId: 'u3', memberId: 'm3' }), { eventId: 'e-soon' }, f.deps);

    expect(going.ok && going.value).toMatchObject({ viewerRsvp: 'going', goingCount: 1 });
    expect(changed.ok && changed.value).toMatchObject({ viewerRsvp: 'not-going', notGoingCount: 1 });
    expect(f.rsvps.rows).toHaveLength(2);
    expect(other.ok && other.value).toMatchObject({ viewerRsvp: null, goingCount: 1, notGoingCount: 1 });
  });

  it('refuses an answer once the event is over', async () => {
    const f = fixture({ events: [event({ id: 'e-past', startsAt: LONG_AGO, endsAt: LONG_AGO_END })] });

    expect(await rsvpEvent(ctx(), { eventId: 'e-past', status: 'going' }, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('refuses a banned member', async () => {
    const f = fixture({ events: [event({ id: 'e-soon' })] });

    const answered = await rsvpEvent(
      ctx({ memberBannedAt: '2026-08-20T00:00:00.000Z' }),
      { eventId: 'e-soon', status: 'going' },
      f.deps,
    );

    expect(answered).toMatchObject({ ok: false, error: { code: 'banned' } });
  });
});

describe('updateEvent and deleteEvent', () => {
  it('edits an event silently and stamps the update', async () => {
    const f = fixture({ events: [event({ id: 'e-soon' })], followers: ['u1'] });

    const updated = await updateEvent(
      staffCtx(),
      { eventId: 'e-soon', title: 'Warsztat II', location: 'Online' },
      f.deps,
    );

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value).toMatchObject({ title: 'Warsztat II', location: 'Online', updatedAt: NOW });
    expect(f.notifications.rows).toEqual([]);
  });

  it('stores a normalized live embed and rejects a host outside the allowlist', async () => {
    const f = fixture({ events: [event({ id: 'e-soon' })] });

    const updated = await updateEvent(
      staffCtx(),
      { eventId: 'e-soon', liveEmbedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      f.deps,
    );

    expect(updated.ok && updated.value.liveEmbedUrl).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(
      await updateEvent(
        staffCtx(),
        { eventId: 'e-soon', replayUrl: 'https://stream.example.com/room/1' },
        f.deps,
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects an edit that inverts the time order', async () => {
    const f = fixture({ events: [event({ id: 'e-soon' })] });

    const updated = await updateEvent(staffCtx(), { eventId: 'e-soon', endsAt: SOON }, f.deps);

    expect(updated).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('soft-deletes an event and hides it from every later read', async () => {
    const f = fixture({ events: [event({ id: 'e-soon' })] });

    const deleted = await deleteEvent(staffCtx(), { eventId: 'e-soon' }, f.deps);
    const listed = await listSpaceEvents(ctx(), { spaceId: 's-open' }, f.deps);

    expect(deleted).toMatchObject({ ok: true, value: { eventId: 'e-soon' } });
    expect(f.events.rows[0]?.deletedAt).toBe(NOW);
    expect(listed.ok && listed.value.events).toEqual([]);
    expect(await deleteEvent(staffCtx(), { eventId: 'e-soon' }, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('refuses a member trying to edit or delete', async () => {
    const f = fixture({ events: [event({ id: 'e-soon' })] });

    expect(await updateEvent(ctx(), { eventId: 'e-soon', title: 'Nie' }, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await deleteEvent(ctx(), { eventId: 'e-soon' }, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});
