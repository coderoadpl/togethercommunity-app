import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { PublicSpaceEvent } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { LiveNowBanner } from './LiveNowBanner.js';

const BUNNY_EMBED = 'https://iframe.mediadelivery.net/embed/12345/6a7b8c9d-1e2f-4a5b-8c9d-0e1f2a3b4c5d';

const event = (overrides: Partial<PublicSpaceEvent> & { id: string }): PublicSpaceEvent => ({
  tenantId: 't1',
  spaceId: 's1',
  title: 'Live Q&A',
  description: null,
  startsAt: '2026-09-10T16:00:00.000Z',
  endsAt: '2026-09-10T17:30:00.000Z',
  location: null,
  url: null,
  liveEmbedUrl: null,
  replayUrl: null,
  discussionRootPostId: 'root-1',
  createdAt: '2026-08-17T09:00:00.000Z',
  updatedAt: null,
  goingCount: 2,
  notGoingCount: 0,
  viewerRsvp: null,
  liveNow: false,
  ...overrides,
});

const okUpcoming = (events: PublicSpaceEvent[]) =>
  http.get('*/api/member/upcoming-events', () =>
    HttpResponse.json({ ok: true, data: { events } }),
  );

const renderBanner = async (spaceId: string | null) => {
  const rootRoute = createRootRoute();
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    component: () => <LiveNowBanner spaceId={spaceId} />,
  });
  const eventRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/community/$spaceId/events/$eventId',
    component: () => <p>strona wydarzenia</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([startRoute, eventRoute]),
    history: createMemoryHistory({ initialEntries: ['/start'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('LiveNowBanner', () => {
  it('announces every ongoing stream with a link into the event page', async () => {
    server.use(
      okUpcoming([
        event({ id: 'e-live', liveEmbedUrl: BUNNY_EMBED, liveNow: true }),
        event({ id: 'e-later' }),
      ]),
    );

    await renderBanner(null);

    expect(await screen.findByTestId('live-now-e-live')).toHaveTextContent('Live Q&A');
    expect(screen.getByTestId('live-now-badge-e-live')).toHaveTextContent(pl.events.liveNow);
    expect(screen.getByTestId('live-now-join-e-live')).toHaveAttribute(
      'href',
      '/community/s1/events/e-live',
    );
    expect(screen.queryByTestId('live-now-e-later')).not.toBeInTheDocument();
  });

  it('stays silent when nothing is on air', async () => {
    server.use(okUpcoming([event({ id: 'e-later' })]));

    await renderBanner(null);

    await waitFor(() =>
      expect(screen.queryByTestId('live-now-banner')).not.toBeInTheDocument(),
    );
  });

  it('keeps a space page to the streams of that space', async () => {
    server.use(
      okUpcoming([
        event({ id: 'e-here', liveEmbedUrl: BUNNY_EMBED, liveNow: true }),
        event({ id: 'e-elsewhere', spaceId: 's2', liveEmbedUrl: BUNNY_EMBED, liveNow: true }),
      ]),
    );

    await renderBanner('s1');

    expect(await screen.findByTestId('live-now-e-here')).toBeInTheDocument();
    expect(screen.queryByTestId('live-now-e-elsewhere')).not.toBeInTheDocument();
  });
});
