import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { DiscussionPost, PublicNavigation, PublicSpaceEvent } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SpaceFeedPage } from '../SpaceFeedPage.js';
import { EventPage } from './EventPage.js';

const BUNNY_EMBED = 'https://iframe.mediadelivery.net/embed/12345/6a7b8c9d-1e2f-4a5b-8c9d-0e1f2a3b4c5d';

const anonMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    ),
  );

const navigation = (): PublicNavigation => ({
  defaultHomeSpaceId: 's1',
  spaces: [{ id: 's1', slug: 's1', name: 'Ogólna', description: 'Rozmowy o kamperze.', position: 0 }],
  courses: [],
  lockedSpaces: [],
});

const okPublicNavigation = () =>
  http.get('/api/public/navigation', () =>
    HttpResponse.json({ ok: true, data: { navigation: navigation() } }),
  );

const okPublicFeed = () =>
  http.get('/api/public/spaces/:spaceId/feed', () =>
    HttpResponse.json({
      ok: true,
      data: { feed: { spaceId: 's1', items: [], pinned: [], nextCursor: null, isFollowing: false } },
    }),
  );

const event = (overrides: Partial<PublicSpaceEvent> = {}): PublicSpaceEvent => ({
  id: 'e1',
  tenantId: 't1',
  spaceId: 's1',
  title: 'Live Q&A',
  description: 'Pytania i odpowiedzi na żywo.',
  startsAt: '2099-09-10T16:00:00.000Z',
  endsAt: '2099-09-10T17:30:00.000Z',
  location: 'Online',
  url: null,
  liveEmbedUrl: null,
  replayUrl: null,
  discussionRootPostId: 'root-1',
  createdAt: '2026-08-17T09:00:00.000Z',
  updatedAt: null,
  goingCount: 4,
  notGoingCount: 1,
  viewerRsvp: null,
  liveNow: false,
  ...overrides,
});

const okPublicEvents = (events: PublicSpaceEvent[]) =>
  http.get('/api/public/spaces/:spaceId/events', () =>
    HttpResponse.json({ ok: true, data: { events, nextCursor: null } }),
  );

const okPublicEvent = (value: PublicSpaceEvent = event()) =>
  http.get('/api/public/spaces/:spaceId/events/:eventId', () =>
    HttpResponse.json({ ok: true, data: { event: value } }),
  );

const missingPublicEvent = () =>
  http.get('/api/public/spaces/:spaceId/events/:eventId', () =>
    HttpResponse.json(
      { ok: false, error: { code: 'not_found', message: 'Event not found' } },
      { status: 404 },
    ),
  );

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

const okPublicThread = () =>
  http.get('/api/public/spaces/:spaceId/posts/:postId', () =>
    HttpResponse.json({
      ok: true,
      data: { discussion: { threads: [rootPost()], nextCursor: null, viewerSubscriptions: {} } },
    }),
  );

const renderPage = async (component: () => ReactNode, path: string) => {
  const rootRoute = createRootRoute({ component });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('public event surface', () => {
  it('lists upcoming events of a publicly readable space for an anonymous visitor', async () => {
    server.use(anonMe(), okPublicNavigation(), okPublicFeed(), okPublicEvents([event()]));

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('event-card-e1')).toHaveTextContent('Live Q&A');
    expect(screen.getByTestId('event-card-e1')).toHaveAttribute('href', '/community/s1/events/e1');
    expect(screen.getByTestId('public-space-events')).toBeInTheDocument();
  });

  it('shows an empty events block when the public space has nothing scheduled', async () => {
    server.use(anonMe(), okPublicNavigation(), okPublicFeed(), okPublicEvents([]));

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('public-space-events-empty')).toHaveTextContent(
      pl.events.emptyUpcoming,
    );
  });

  it('renders the event read-only with counts, a sign-in CTA and the thread', async () => {
    server.use(anonMe(), okPublicNavigation(), okPublicEvent(), okPublicThread());

    await renderPage(() => <EventPage spaceId="s1" eventId="e1" />, '/community/s1/events/e1');

    expect(await screen.findByTestId('public-event-page')).toHaveTextContent(
      'Pytania i odpowiedzi na żywo.',
    );
    expect(screen.getByTestId('public-event-going-count')).toHaveTextContent(
      pl.events.goingCount({ count: 4 }),
    );
    expect(screen.getByTestId('public-event-sign-in')).toHaveAttribute('href', '/login');
    expect(await screen.findByTestId('public-post-root-1')).toHaveTextContent(
      'Wątek wydarzenia: Live Q&A',
    );
    expect(screen.queryByTestId('event-rsvp')).not.toBeInTheDocument();
    expect(screen.queryByTestId('event-ics')).not.toBeInTheDocument();
  });

  it('plays the live stream of a public event without offering an RSVP', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicEvent(event({ liveEmbedUrl: BUNNY_EMBED, liveNow: true })),
      okPublicThread(),
    );

    await renderPage(() => <EventPage spaceId="s1" eventId="e1" />, '/community/s1/events/e1');

    expect(await screen.findByTestId('event-live-embed')).toHaveAttribute('src', BUNNY_EMBED);
    expect(screen.getByTestId('event-live')).toHaveTextContent(pl.events.liveHeading);
    expect(screen.getByTestId('public-event-sign-in')).toBeInTheDocument();
  });

  it('shows a not-found state when the public event is unavailable', async () => {
    server.use(anonMe(), okPublicNavigation(), missingPublicEvent());

    await renderPage(() => <EventPage spaceId="s1" eventId="gone" />, '/community/s1/events/gone');

    expect((await screen.findAllByText(pl.events.notFoundTitle)).length).toBeGreaterThan(0);
    expect(screen.getByText(pl.events.notFoundBody)).toBeInTheDocument();
  });
});
