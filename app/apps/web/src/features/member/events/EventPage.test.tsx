import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  rsvpEventInputSchema,
  type DiscussionPost,
  type MemberSpace,
  type PublicSpaceEvent,
} from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { EventPage } from './EventPage.js';

const FUTURE_START = '2099-09-10T16:00:00.000Z';
const FUTURE_END = '2099-09-10T17:30:00.000Z';

const okMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'user@example.com',
        emailVerified: true,
        name: 'Jan Uczestnik',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'm1', banned: false },
      },
    }),
  );

const noNotifications = () =>
  http.get('/api/notifications/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread: 0 } }),
  );

const space = (): MemberSpace => ({
  id: 's1',
  tenantId: 't1',
  slug: 's1',
  name: 'Ogólna',
  description: 'Rozmowy o kamperze.',
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: '2026-07-20T08:00:00.000Z',
  isFollowing: false,
});

const okSpaces = () =>
  http.get('/api/spaces', () => HttpResponse.json({ ok: true, data: { spaces: [space()] } }));

const rootPost = (): DiscussionPost => ({
  id: 'root-1',
  tenantId: 't1',
  contextKind: 'space',
  contextId: 's1',
  parentPostId: null,
  rootPostId: 'root-1',
  isOwn: false,
  authorDisplay: 'Ola Autorka',
  authorIsStaff: true,
  authorAvatarUrl: null,
  body: 'Wątek wydarzenia: Live Q&A',
  createdAt: '2026-08-17T09:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  replies: [],
  replyCount: 0,
});

const okDiscussion = () =>
  http.get('/api/discussion', () =>
    HttpResponse.json({
      ok: true,
      data: { discussion: { threads: [rootPost()], nextCursor: null, viewerSubscriptions: {} } },
    }),
  );

const event = (overrides: Partial<PublicSpaceEvent> = {}): PublicSpaceEvent => ({
  id: 'e1',
  tenantId: 't1',
  spaceId: 's1',
  title: 'Live Q&A',
  description: 'Pytania i odpowiedzi na żywo.',
  startsAt: FUTURE_START,
  endsAt: FUTURE_END,
  location: 'Online',
  url: 'https://meet.example.com/live',
  liveEmbedUrl: null,
  replayUrl: null,
  discussionRootPostId: 'root-1',
  createdAt: '2026-08-17T09:00:00.000Z',
  updatedAt: null,
  goingCount: 2,
  notGoingCount: 1,
  viewerRsvp: null,
  liveNow: false,
  ...overrides,
});

const okEvent = (value: PublicSpaceEvent = event()) =>
  http.get('/api/events/:eventId', () => HttpResponse.json({ ok: true, data: { event: value } }));

const renderEvent = async () => {
  const rootRoute = createRootRoute();
  const eventRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/community/$spaceId/events/$eventId',
    component: () => <EventPage spaceId="s1" eventId="e1" />,
  });
  const spaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/community/$spaceId',
    component: () => <p>strona przestrzeni</p>,
  });
  const communityRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/community',
    component: () => <p>lista przestrzeni</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([eventRoute, spaceRoute, communityRoute]),
    history: createMemoryHistory({ initialEntries: ['/community/s1/events/e1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('EventPage', () => {
  it('renders the event details next to its discussion thread', async () => {
    server.use(okMe(), noNotifications(), okSpaces(), okEvent(), okDiscussion());

    await renderEvent();

    expect(await screen.findByTestId('event-page')).toHaveTextContent(
      'Pytania i odpowiedzi na żywo.',
    );
    expect(screen.getByTestId('event-location')).toHaveTextContent('Online');
    expect(screen.getByTestId('event-link')).toHaveAttribute(
      'href',
      'https://meet.example.com/live',
    );
    expect(screen.getByTestId('event-going-count')).toHaveTextContent(
      pl.events.goingCount({ count: 2 }),
    );
    expect(await screen.findByTestId('event-discussion')).toHaveTextContent(
      'Wątek wydarzenia: Live Q&A',
    );
  });

  it('answers an RSVP and moves the counts before the server replies', async () => {
    const answers: unknown[] = [];
    server.use(
      okMe(),
      noNotifications(),
      okSpaces(),
      okEvent(),
      okDiscussion(),
      http.post('/api/events/rsvp', async ({ request }) => {
        const body = rsvpEventInputSchema.parse(await request.json());
        answers.push(body);
        return HttpResponse.json({
          ok: true,
          data: { event: event({ viewerRsvp: 'going', goingCount: 3 }) },
        });
      }),
    );

    await renderEvent();

    await userEvent.click(await screen.findByTestId('event-rsvp-going'));

    expect(screen.getByTestId('event-going-count')).toHaveTextContent(
      pl.events.goingCount({ count: 3 }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('event-rsvp-going')).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(answers).toEqual([{ eventId: 'e1', status: 'going' }]);
  });

  it('downloads the calendar file behind the ICS button', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces(),
      okEvent(),
      okDiscussion(),
      http.get('/api/events/:eventId/ics', () =>
        HttpResponse.json({
          ok: true,
          data: { fileName: 'event-e1.ics', icsContent: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' },
        }),
      ),
    );
    const createObjectUrl = URL.createObjectURL;
    const revokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:event-ics';
    URL.revokeObjectURL = () => undefined;

    await renderEvent();
    await userEvent.click(await screen.findByTestId('event-ics'));

    await waitFor(() => expect(screen.queryByText(pl.events.calendarError)).not.toBeInTheDocument());

    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;
  });

  it('replaces RSVP with a closing note once the event is over', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces(),
      okEvent(
        event({
          startsAt: '2020-01-01T10:00:00.000Z',
          endsAt: '2020-01-01T11:00:00.000Z',
        }),
      ),
      okDiscussion(),
    );

    await renderEvent();

    expect(await screen.findByTestId('event-ended')).toHaveTextContent(pl.events.ended);
    expect(screen.queryByTestId('event-rsvp')).not.toBeInTheDocument();
  });

  it('explains a missing event instead of rendering an empty page', async () => {
    server.use(
      okMe(),
      noNotifications(),
      okSpaces(),
      http.get('/api/events/:eventId', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'not_found', message: 'Event not found' } },
          { status: 404 },
        ),
      ),
    );

    await renderEvent();

    expect(await screen.findByText(pl.events.notFoundBody)).toBeInTheDocument();
    expect(screen.getAllByText(pl.events.notFoundTitle).length).toBeGreaterThan(0);
  });
});
