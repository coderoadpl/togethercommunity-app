import { describe, expect, it } from 'vitest';

import { VIDEO_EMBED_URL_MESSAGE } from './course.js';
import {
  buildEventIcs,
  createEventInputSchema,
  eventDiscussionBody,
  isEventLive,
  listSpaceEventsInputSchema,
  publicSpaceEventSchema,
  spaceEventSchema,
  toPublicSpaceEvent,
  upcomingEventsInputSchema,
  updateEventInputSchema,
  type SpaceEvent,
} from './event.js';

const NOW = '2026-09-01T10:00:00.000Z';

const BUNNY_EMBED = 'https://iframe.mediadelivery.net/embed/12345/6a7b8c9d-1e2f-4a5b-8c9d-0e1f2a3b4c5d';

const event = (overrides: Partial<SpaceEvent> = {}): SpaceEvent =>
  spaceEventSchema.parse({
    id: 'e1',
    tenantId: 't1',
    spaceId: 's1',
    title: 'Warsztat',
    description: null,
    startsAt: '2026-09-01T09:00:00.000Z',
    endsAt: '2026-09-01T11:00:00.000Z',
    location: null,
    url: null,
    createdByUserId: 'u1',
    createdAt: '2026-08-01T08:00:00.000Z',
    ...overrides,
  });

describe('space event schema', () => {
  it('rejects an event that ends before it starts', () => {
    const parsed = spaceEventSchema.safeParse({
      ...event(),
      startsAt: '2026-09-01T11:00:00.000Z',
      endsAt: '2026-09-01T09:00:00.000Z',
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.flatten().fieldErrors.endsAt).toEqual(['An event has to end after it starts']);
  });

  it('rejects an event that ends exactly when it starts', () => {
    const parsed = spaceEventSchema.safeParse({ ...event(), endsAt: '2026-09-01T09:00:00.000Z' });

    expect(parsed.success).toBe(false);
  });

  it('defaults the live, replay, discussion and lifecycle columns', () => {
    expect(event()).toMatchObject({
      liveEmbedUrl: null,
      replayUrl: null,
      discussionRootPostId: null,
      updatedAt: null,
      deletedAt: null,
    });
  });

  it('clamps list paging and rejects a malformed cursor', () => {
    expect(listSpaceEventsInputSchema.parse({ spaceId: 's1' })).toEqual({
      spaceId: 's1',
      scope: 'upcoming',
      limit: 20,
    });
    expect(listSpaceEventsInputSchema.safeParse({ spaceId: 's1', limit: 500 }).success).toBe(false);
    expect(listSpaceEventsInputSchema.safeParse({ spaceId: 's1', cursor: 'nope' }).success).toBe(false);
    expect(
      listSpaceEventsInputSchema.safeParse({ spaceId: 's1', cursor: `${NOW}|e1` }).success,
    ).toBe(true);
    expect(upcomingEventsInputSchema.safeParse({ limit: 21 }).success).toBe(false);
  });
});

describe('live and replay embeds', () => {
  it('normalizes an allowlisted provider URL on the event and on its inputs', () => {
    expect(event({ liveEmbedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toMatchObject({
      liveEmbedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    });
    expect(
      createEventInputSchema.parse({
        spaceId: 's1',
        title: 'Warsztat',
        startsAt: '2026-09-01T09:00:00.000Z',
        endsAt: '2026-09-01T11:00:00.000Z',
        liveEmbedUrl: BUNNY_EMBED,
      }),
    ).toMatchObject({ liveEmbedUrl: BUNNY_EMBED });
    expect(
      updateEventInputSchema.parse({ eventId: 'e1', replayUrl: 'https://vimeo.com/76979871' }),
    ).toEqual({ eventId: 'e1', replayUrl: 'https://player.vimeo.com/video/76979871' });
  });

  it('rejects a host outside the embed allowlist instead of passing it through', () => {
    const parsed = spaceEventSchema.safeParse({
      ...event(),
      liveEmbedUrl: 'https://stream.example.com/room/1',
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.flatten().fieldErrors.liveEmbedUrl).toEqual([
      VIDEO_EMBED_URL_MESSAGE.unsupportedHost,
    ]);
    expect(
      updateEventInputSchema.safeParse({ eventId: 'e1', replayUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      createEventInputSchema.safeParse({
        spaceId: 's1',
        title: 'Warsztat',
        startsAt: '2026-09-01T09:00:00.000Z',
        endsAt: '2026-09-01T11:00:00.000Z',
        liveEmbedUrl: 'https://iframe.mediadelivery.net/embed/12345/not-a-guid',
      }).success,
    ).toBe(false);
  });

  it('keeps an unset live or replay URL erasable', () => {
    expect(updateEventInputSchema.parse({ eventId: 'e1', liveEmbedUrl: null })).toEqual({
      eventId: 'e1',
      liveEmbedUrl: null,
    });
  });
});

describe('public event projection', () => {
  it('drops the creating account and carries counts, viewer answer and live state', () => {
    const projected = toPublicSpaceEvent(event({ liveEmbedUrl: BUNNY_EMBED }), {
      goingCount: 3,
      notGoingCount: 1,
      viewerRsvp: 'going',
      now: NOW,
    });

    expect(publicSpaceEventSchema.parse(projected)).toEqual(projected);
    expect(JSON.stringify(projected)).not.toContain('u1');
    expect(projected).toMatchObject({ goingCount: 3, notGoingCount: 1, viewerRsvp: 'going', liveNow: true });
  });

  it('is live only inside the window and only with a live embed', () => {
    const live = event({ liveEmbedUrl: BUNNY_EMBED });

    expect(isEventLive(live, '2026-09-01T08:59:59.000Z')).toBe(false);
    expect(isEventLive(live, '2026-09-01T09:00:00.000Z')).toBe(true);
    expect(isEventLive(live, '2026-09-01T11:00:00.000Z')).toBe(true);
    expect(isEventLive(live, '2026-09-01T11:00:01.000Z')).toBe(false);
    expect(isEventLive(event(), NOW)).toBe(false);
  });
});

describe('event discussion body', () => {
  it('leads the auto-created thread in both languages', () => {
    expect(eventDiscussionBody('Warsztat')).toBe('Wątek wydarzenia: Warsztat');
    expect(eventDiscussionBody('Warsztat', 'en')).toBe('Event thread: Warsztat');
  });
});

describe('ics builder', () => {
  it('renders a calendar entry with CRLF lines and UTC stamps', () => {
    const built = buildEventIcs(
      event({ description: 'Opis', location: 'Online', url: 'https://example.test/meet' }),
      'Acme',
    );

    expect(built.fileName).toBe('event-e1.ics');
    expect(built.icsContent).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Together//Acme//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:e1@together',
        'DTSTAMP:20260801T080000Z',
        'DTSTART:20260901T090000Z',
        'DTEND:20260901T110000Z',
        'SUMMARY:Warsztat',
        'DESCRIPTION:Opis',
        'LOCATION:Online',
        'URL:https://example.test/meet',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('stamps the last edit when the event was updated', () => {
    const built = buildEventIcs(event({ updatedAt: '2026-08-20T12:30:45.000Z' }), 'Acme');

    expect(built.icsContent).toContain('DTSTAMP:20260820T123045Z');
  });

  it('escapes separators and newlines and omits empty properties', () => {
    const built = buildEventIcs(
      event({ title: 'A; B, C\\D', description: 'Linia 1\nLinia 2' }),
      'Acme, sp. z o.o.',
    );

    expect(built.icsContent).toContain('SUMMARY:A\\; B\\, C\\\\D');
    expect(built.icsContent).toContain('DESCRIPTION:Linia 1\\nLinia 2');
    expect(built.icsContent).toContain('PRODID:-//Together//Acme\\, sp. z o.o.//EN');
    expect(built.icsContent).not.toContain('LOCATION:');
    expect(built.icsContent).not.toContain('URL:');
  });

  it('folds long lines at the octet limit with a leading space', () => {
    const built = buildEventIcs(event({ description: 'ąęćłńóśżź'.repeat(20) }), 'Acme');
    const encoder = new TextEncoder();

    for (const line of built.icsContent.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(built.icsContent).toContain('\r\n ');
  });
});
