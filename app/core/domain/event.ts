import { z } from 'zod';

import { DEFAULT_LANGUAGE, type Language } from './language.js';

const EVENT_TITLE_MAX_LENGTH = 200;

const EVENT_DESCRIPTION_MAX_LENGTH = 5000;

const EVENT_LOCATION_MAX_LENGTH = 200;

const EVENT_TIME_ORDER_MESSAGE = 'An event has to end after it starts';

const spaceEventRsvpStatusSchema = z.enum(['going', 'not-going']);

export type SpaceEventRsvpStatus = z.output<typeof spaceEventRsvpStatusSchema>;

const spaceEventFieldsSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  spaceId: z.string().min(1),
  title: z.string().trim().min(1).max(EVENT_TITLE_MAX_LENGTH),
  description: z.string().max(EVENT_DESCRIPTION_MAX_LENGTH).nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  location: z.string().trim().max(EVENT_LOCATION_MAX_LENGTH).nullable(),
  url: z.string().url().nullable(),
  liveEmbedUrl: z.string().nullable().default(null),
  replayUrl: z.string().nullable().default(null),
  discussionRootPostId: z.string().min(1).nullable().default(null),
  createdByUserId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().default(null),
  deletedAt: z.string().datetime().nullable().default(null),
});

export const spaceEventSchema = spaceEventFieldsSchema.refine(
  (event) => event.endsAt > event.startsAt,
  { message: EVENT_TIME_ORDER_MESSAGE, path: ['endsAt'] },
);

export type SpaceEvent = z.output<typeof spaceEventSchema>;

export const spaceEventRsvpSchema = z.object({
  tenantId: z.string().min(1),
  eventId: z.string().min(1),
  userId: z.string().min(1),
  status: spaceEventRsvpStatusSchema,
  updatedAt: z.string().datetime(),
});

export type SpaceEventRsvp = z.output<typeof spaceEventRsvpSchema>;

/**
 * Client projection: the creating staff account stays server-side and the
 * attendance summary, the viewer's own answer and the live window are
 * pre-computed, mirroring the `isOwn` projection of posts.
 */
export const publicSpaceEventSchema = spaceEventFieldsSchema
  .omit({ createdByUserId: true, deletedAt: true })
  .extend({
    goingCount: z.number().int().nonnegative(),
    notGoingCount: z.number().int().nonnegative(),
    viewerRsvp: spaceEventRsvpStatusSchema.nullable(),
    liveNow: z.boolean(),
  });

export type PublicSpaceEvent = z.output<typeof publicSpaceEventSchema>;

export const createEventInputSchema = z.object({
  spaceId: z.string().min(1),
  title: spaceEventFieldsSchema.shape.title,
  description: z.string().max(EVENT_DESCRIPTION_MAX_LENGTH).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  location: z.string().trim().max(EVENT_LOCATION_MAX_LENGTH).optional(),
  url: z.string().url().optional(),
});

export const updateEventInputSchema = z.object({
  eventId: z.string().min(1),
  title: spaceEventFieldsSchema.shape.title.optional(),
  description: z.string().max(EVENT_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  location: z.string().trim().max(EVENT_LOCATION_MAX_LENGTH).nullable().optional(),
  url: z.string().url().nullable().optional(),
});

export const eventRefSchema = z.object({
  eventId: z.string().min(1),
});

export const publicSpaceEventRefSchema = z.object({
  spaceId: z.string().min(1),
  eventId: z.string().min(1),
});

export type PublicSpaceEventRef = z.output<typeof publicSpaceEventRefSchema>;

export const rsvpEventInputSchema = z.object({
  eventId: z.string().min(1),
  status: spaceEventRsvpStatusSchema,
});

const eventCursorSchema = z.string().min(1).superRefine((value, ctx) => {
  const separator = value.indexOf('|');
  if (
    separator === -1
    || !z.string().datetime().safeParse(value.slice(0, separator)).success
    || value.slice(separator + 1).length === 0
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid event cursor' });
  }
});

export const listSpaceEventsInputSchema = z.object({
  spaceId: z.string().min(1),
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  cursor: eventCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const upcomingEventsInputSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
});

export const eventIcsSchema = z.object({
  fileName: z.string().min(1),
  icsContent: z.string().min(1),
});

export type EventIcs = z.output<typeof eventIcsSchema>;

const EVENT_DISCUSSION_LEAD_IN: Record<Language, (title: string) => string> = {
  pl: (title) => `Wątek wydarzenia: ${title}`,
  en: (title) => `Event thread: ${title}`,
};

export const eventDiscussionBody = (
  title: string,
  language: Language = DEFAULT_LANGUAGE,
): string => EVENT_DISCUSSION_LEAD_IN[language](title);

export const isEventLive = (event: Pick<SpaceEvent, 'startsAt' | 'endsAt' | 'liveEmbedUrl'>, now: string): boolean =>
  event.liveEmbedUrl !== null && event.startsAt <= now && now <= event.endsAt;

export const toPublicSpaceEvent = (
  event: SpaceEvent,
  viewer: {
    goingCount: number;
    notGoingCount: number;
    viewerRsvp: SpaceEventRsvpStatus | null;
    now: string;
  },
): PublicSpaceEvent => ({
  id: event.id,
  tenantId: event.tenantId,
  spaceId: event.spaceId,
  title: event.title,
  description: event.description,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  location: event.location,
  url: event.url,
  liveEmbedUrl: event.liveEmbedUrl,
  replayUrl: event.replayUrl,
  discussionRootPostId: event.discussionRootPostId,
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
  goingCount: viewer.goingCount,
  notGoingCount: viewer.notGoingCount,
  viewerRsvp: viewer.viewerRsvp,
  liveNow: isEventLive(event, viewer.now),
});

const escapeIcsText = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n|\r|\n/g, '\\n');

const icsTimestamp = (iso: string): string =>
  `${iso.replaceAll(/[-:]/g, '').slice(0, 15)}Z`;

const ICS_FIRST_LINE_OCTETS = 75;
const ICS_CONTINUATION_OCTETS = 74;

const foldIcsLine = (line: string): string => {
  const encoder = new TextEncoder();
  const segments: string[] = [];
  let segment = '';
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    const limit = segments.length === 0 ? ICS_FIRST_LINE_OCTETS : ICS_CONTINUATION_OCTETS;
    if (octets + size > limit) {
      segments.push(segment);
      segment = '';
      octets = 0;
    }
    segment += character;
    octets += size;
  }
  segments.push(segment);
  return segments.join('\r\n ');
};

/** Hand-rolled VCALENDAR so the calendar export needs no new dependency. */
export const buildEventIcs = (event: SpaceEvent, tenantName: string): EventIcs => {
  const optional = (property: string, value: string | null): string[] =>
    value === null || value.length === 0 ? [] : [`${property}:${escapeIcsText(value)}`];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Together//${escapeIcsText(tenantName)}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@together`,
    `DTSTAMP:${icsTimestamp(event.updatedAt ?? event.createdAt)}`,
    `DTSTART:${icsTimestamp(event.startsAt)}`,
    `DTEND:${icsTimestamp(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...optional('DESCRIPTION', event.description),
    ...optional('LOCATION', event.location),
    ...optional('URL', event.url),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return {
    fileName: `event-${event.id}.ics`,
    icsContent: `${lines.map(foldIcsLine).join('\r\n')}\r\n`,
  };
};
