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
import { UpcomingEventsStrip } from './UpcomingEventsStrip.js';

const event = (id: string, title: string): PublicSpaceEvent => ({
  id,
  tenantId: 't1',
  spaceId: 's1',
  title,
  description: null,
  startsAt: '2026-09-10T16:00:00.000Z',
  endsAt: '2026-09-10T17:30:00.000Z',
  location: 'Online',
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
});

const okUpcoming = (events: PublicSpaceEvent[]) =>
  http.get('*/api/member/upcoming-events', () =>
    HttpResponse.json({ ok: true, data: { events } }),
  );

const renderStrip = async () => {
  const rootRoute = createRootRoute();
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    component: UpcomingEventsStrip,
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

describe('UpcomingEventsStrip', () => {
  it('shows the events a member can still attend and links to their pages', async () => {
    server.use(okUpcoming([event('e1', 'Live Q&A'), event('e2', 'Warsztat')]));

    await renderStrip();

    expect(await screen.findByTestId('start-upcoming-events')).toHaveTextContent(
      pl.events.upcomingHeading,
    );
    expect(screen.getByTestId('event-card-e1')).toHaveAttribute('href', '/community/s1/events/e1');
    expect(screen.getByTestId('event-card-e2')).toHaveTextContent('Warsztat');
  });

  it('stays out of the way when nothing is scheduled', async () => {
    server.use(okUpcoming([]));

    await renderStrip();

    await waitFor(() =>
      expect(screen.queryByTestId('start-upcoming-events')).not.toBeInTheDocument(),
    );
  });
});
