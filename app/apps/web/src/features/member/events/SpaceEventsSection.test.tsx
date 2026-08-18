import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { PublicSpaceEvent } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SpaceEventsSection } from './SpaceEventsSection.js';

const event = (input: { id: string; title: string; goingCount?: number }): PublicSpaceEvent => ({
  id: input.id,
  tenantId: 't1',
  spaceId: 's1',
  title: input.title,
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
  goingCount: input.goingCount ?? 0,
  notGoingCount: 0,
  viewerRsvp: null,
  liveNow: false,
});

const okEvents = (byScope: Record<string, PublicSpaceEvent[]>) =>
  http.get('*/api/spaces/:spaceId/events', ({ request }) => {
    const scope = new URL(request.url).searchParams.get('scope') ?? 'upcoming';
    return HttpResponse.json({
      ok: true,
      data: { events: byScope[scope] ?? [], nextCursor: null },
    });
  });

const renderSection = async () => {
  const rootRoute = createRootRoute();
  const spaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/community/$spaceId',
    component: () => <SpaceEventsSection spaceId="s1" />,
  });
  const eventRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/community/$spaceId/events/$eventId',
    component: () => <p>strona wydarzenia</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([spaceRoute, eventRoute]),
    history: createMemoryHistory({ initialEntries: ['/community/s1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('SpaceEventsSection', () => {
  it('lists upcoming events with attendance counts and deep links', async () => {
    server.use(okEvents({ upcoming: [event({ id: 'e1', title: 'Live Q&A', goingCount: 3 })] }));

    await renderSection();

    const card = await screen.findByTestId('event-card-e1');
    expect(card).toHaveAttribute('href', '/community/s1/events/e1');
    expect(card).toHaveTextContent('Live Q&A');
    expect(screen.getByTestId('event-card-going-e1')).toHaveTextContent(
      pl.events.goingCount({ count: 3 }),
    );
  });

  it('switches to past events and shows their own empty state', async () => {
    server.use(okEvents({ upcoming: [event({ id: 'e1', title: 'Live Q&A' })], past: [] }));

    await renderSection();
    await screen.findByTestId('event-card-e1');

    await userEvent.click(screen.getByTestId('space-events-scope-past'));

    expect(await screen.findByTestId('space-events-empty')).toHaveTextContent(pl.events.emptyPast);
  });

  it('states that nothing is scheduled when the space has no upcoming events', async () => {
    server.use(okEvents({ upcoming: [] }));

    await renderSection();

    expect(await screen.findByTestId('space-events-empty')).toHaveTextContent(
      pl.events.emptyUpcoming,
    );
  });
});
