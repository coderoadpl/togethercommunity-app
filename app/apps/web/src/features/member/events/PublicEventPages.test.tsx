import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { DiscussionPost, PublicNavigation, PublicSpaceEvent } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
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
  spaces: [{ id: 's1', slug: 's1', name: 'General', description: 'Camper discussions.', position: 0 }],
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
  description: 'Live questions and answers.',
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
  body: 'Event thread: Live Q&A',
  bodyFormat: 'plain',
  bodyHtml: 'Event thread: Live Q&amp;A',
  bodyPlainText: 'Event thread: Live Q&A',
  createdAt: '2026-08-17T09:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  replies: [],
  replyCount: 0,
});

const emptyOffer = (supportUrl: string | null) => ({
  ok: true,
  data: {
    tenant: { slug: 'acme', name: 'Acme', support: { url: supportUrl } },
    contentVersion: 1,
    products: [],
    salesLinks: [],
    previewLessons: [],
  },
});

const okOffer = (supportUrl: string | null) =>
  http.get('/api/public/offer', () => HttpResponse.json(emptyOffer(supportUrl)));

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

  it('renders no events card when the public space has nothing scheduled', async () => {
    const served = { events: false };
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicFeed(),
      http.get('/api/public/spaces/:spaceId/events', () => {
        served.events = true;
        return HttpResponse.json({ ok: true, data: { events: [], nextCursor: null } });
      }),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('public-feed-empty-state')).toBeInTheDocument();
    await waitFor(() => expect(served.events).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('public-space-events')).not.toBeInTheDocument());
    expect(screen.queryByText(en.events.emptyUpcoming)).not.toBeInTheDocument();
  });

  it('keeps the events card while the list loads', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicFeed(),
      http.get('/api/public/spaces/:spaceId/events', () => new Promise<never>(() => undefined)),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    expect(await screen.findByTestId('public-space-events')).toHaveTextContent(en.events.loading);
  });

  it('keeps the events card with a retry when the list fails', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicFeed(),
      http.get('/api/public/spaces/:spaceId/events', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Boom' } }, { status: 500 }),
      ),
    );

    await renderPage(() => <SpaceFeedPage spaceId="s1" />, '/community/s1');

    const card = await screen.findByTestId('public-space-events');
    expect(await within(card).findByRole('button', { name: en.common.retry })).toBeInTheDocument();
  });

  it('renders the event read-only with counts, a sign-in CTA and the thread', async () => {
    server.use(anonMe(), okPublicNavigation(), okPublicEvent(), okPublicThread());

    await renderPage(() => <EventPage spaceId="s1" eventId="e1" />, '/community/s1/events/e1');

    expect(await screen.findByTestId('public-event-page')).toHaveTextContent(
      'Live questions and answers.',
    );
    expect(screen.getByTestId('public-event-going-count')).toHaveTextContent(
      en.events.goingCount({ count: 4 }),
    );
    expect(await screen.findByTestId('public-event-sign-in')).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fcommunity%2Fs1%2Fevents%2Fe1',
    );
    expect(await screen.findByTestId('public-post-root-1')).toHaveTextContent(
      'Event thread: Live Q&A',
    );
    const details = screen.getByTestId('public-event-details');
    expect(within(details).getByText(en.events.detailsHeading)).toBeInTheDocument();
    expect(within(details).getByTestId('public-event-join')).toHaveAttribute('href', '/#offer');
    expect(within(details).getByTestId('public-event-join')).toHaveTextContent(en.anon.salesCta);
    expect(within(details).getByTestId('public-event-sign-in')).toHaveClass('MuiButton-outlined');
    const crumbs = within(screen.getByTestId('member-breadcrumbs'));
    expect(crumbs.getByRole('link', { name: en.shell.start })).toHaveAttribute('href', '/');
    expect(crumbs.getByRole('link', { name: 'General' })).toHaveAttribute('href', '/community/s1');
    expect(screen.queryByTestId('event-rsvp')).not.toBeInTheDocument();
    expect(screen.queryByTestId('event-ics')).not.toBeInTheDocument();
  });

  it('leads with sign-in on the event details when the workspace sells nothing', async () => {
    server.use(anonMe(), okPublicNavigation(), okPublicEvent(), okPublicThread(), okOffer(null));

    await renderPage(() => <EventPage spaceId="s1" eventId="e1" />, '/community/s1/events/e1');

    const signIn = await screen.findByTestId('public-event-sign-in');
    expect(signIn).toHaveClass('MuiButton-contained');
    expect(screen.queryByTestId('public-event-join')).not.toBeInTheDocument();
    expect(screen.queryByTestId('anon-visitor-contact')).not.toBeInTheDocument();
  });

  it('offers the creator contact beside sign-in when the workspace sells nothing and has a support link', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicEvent(),
      okPublicThread(),
      okOffer('https://studio.example.org/contact'),
    );

    await renderPage(() => <EventPage spaceId="s1" eventId="e1" />, '/community/s1/events/e1');

    const details = await screen.findByTestId('public-event-details');
    const contact = await within(details).findByTestId('anon-visitor-contact');
    expect(contact).toHaveAttribute('href', 'https://studio.example.org/contact');
    expect(contact).toHaveAttribute('target', '_blank');
    expect(contact).toHaveTextContent(en.anon.contactCreator);
    expect(within(details).getByTestId('public-event-sign-in')).toHaveClass('MuiButton-contained');
  });

  it('holds the event actions until the offer settles so the sign-in button never changes style', async () => {
    let releaseOffer: () => void = () => undefined;
    const offerGate = new Promise<void>((resolve) => {
      releaseOffer = resolve;
    });
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicEvent(),
      okPublicThread(),
      http.get('/api/public/offer', async () => {
        await offerGate;
        return HttpResponse.json(emptyOffer(null));
      }),
    );

    await renderPage(() => <EventPage spaceId="s1" eventId="e1" />, '/community/s1/events/e1');

    const placeholder = await screen.findByTestId('public-event-actions-pending');
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholder).toHaveStyle({ visibility: 'hidden' });
    expect(screen.queryByTestId('public-event-sign-in')).not.toBeInTheDocument();
    expect(screen.queryByTestId('public-event-join')).not.toBeInTheDocument();

    releaseOffer();
    expect(await screen.findByTestId('public-event-sign-in')).toHaveClass('MuiButton-contained');
    expect(screen.queryByTestId('public-event-actions-pending')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('event-live')).toHaveTextContent(en.events.liveHeading);
    expect(screen.getByTestId('public-event-sign-in')).toBeInTheDocument();
  });

  it('shows a not-found state when the public event is unavailable', async () => {
    server.use(anonMe(), okPublicNavigation(), missingPublicEvent());

    await renderPage(() => <EventPage spaceId="s1" eventId="gone" />, '/community/s1/events/gone');

    expect((await screen.findAllByText(en.events.notFoundTitle)).length).toBeGreaterThan(0);
    expect(screen.getByText(en.events.notFoundBody)).toBeInTheDocument();
  });

  it('offers a retry instead of a not-found state when the public event fails to load', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      http.get('/api/public/spaces/:spaceId/events/:eventId', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Boom' } }, { status: 500 }),
      ),
    );

    await renderPage(() => <EventPage spaceId="s1" eventId="e1" />, '/community/s1/events/e1');

    expect(await screen.findByRole('button', { name: en.common.retry })).toBeInTheDocument();
    expect(screen.queryByText(en.events.notFoundTitle)).not.toBeInTheDocument();
  });

  it('shows a retry when the event discussion fails instead of claiming nobody discussed it', async () => {
    server.use(
      anonMe(),
      okPublicNavigation(),
      okPublicEvent(),
      http.get('/api/public/spaces/:spaceId/posts/:postId', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Boom' } }, { status: 500 }),
      ),
    );

    await renderPage(() => <EventPage spaceId="s1" eventId="e1" />, '/community/s1/events/e1');

    const failure = await screen.findByTestId('public-event-discussion-error');
    expect(within(failure).getByRole('button', { name: en.common.retry })).toBeInTheDocument();
    expect(screen.queryByTestId('public-event-discussion-empty')).not.toBeInTheDocument();
  });
});
