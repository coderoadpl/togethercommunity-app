import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  createEventInputSchema,
  updateEventInputSchema,
  type PublicSpaceEvent,
  type StaffSpace,
} from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelEventCreateRoute, PanelEventEditRoute, PanelSpaceEventsRoute } from '../panel-routes.js';

const BUNNY_EMBED = 'https://iframe.mediadelivery.net/embed/12345/6a7b8c9d-1e2f-4a5b-8c9d-0e1f2a3b4c5d';

const staffSpace = (): StaffSpace => ({
  id: 's1',
  tenantId: 't1',
  slug: 's1',
  name: 'Ogólna',
  description: 'Rozmowy o wszystkim.',
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: '2026-07-20T08:00:00.000Z',
  stats: { posts: 4, followers: 7 },
});

const event = (overrides: Partial<PublicSpaceEvent> = {}): PublicSpaceEvent => ({
  id: 'e1',
  tenantId: 't1',
  spaceId: 's1',
  title: 'Live Q&A',
  description: 'Pytania i odpowiedzi.',
  startsAt: '2099-09-10T16:00:00.000Z',
  endsAt: '2099-09-10T17:30:00.000Z',
  location: 'Online',
  url: 'https://meet.example.com/live',
  liveEmbedUrl: null,
  replayUrl: null,
  discussionRootPostId: 'root-1',
  createdAt: '2026-08-17T09:00:00.000Z',
  updatedAt: null,
  goingCount: 3,
  notGoingCount: 1,
  viewerRsvp: null,
  liveNow: false,
  ...overrides,
});

const okStaffSpaces = () =>
  http.get('/api/spaces/staff', () => HttpResponse.json({ ok: true, data: { spaces: [staffSpace()] } }));

const okSpaceEvents = (events: PublicSpaceEvent[]) =>
  http.get('/api/spaces/:spaceId/events', ({ request }) =>
    HttpResponse.json({
      ok: true,
      data: {
        events: new URL(request.url).searchParams.get('scope') === 'past' ? [] : events,
        nextCursor: null,
      },
    }),
  );

const okEvent = (value: PublicSpaceEvent) =>
  http.get('/api/events/:eventId', () => HttpResponse.json({ ok: true, data: { event: value } }));

const renderPanel = async (initialEntry: string) => {
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/spaces/$spaceId/events',
    component: PanelSpaceEventsRoute,
  });
  const createPageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/spaces/$spaceId/events/new',
    component: PanelEventCreateRoute,
  });
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/spaces/$spaceId/events/$eventId',
    component: PanelEventEditRoute,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, createPageRoute, editRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('space events panel', () => {
  it('lists the events of a space with attendance counts and switches to past events', async () => {
    server.use(okStaffSpaces(), okSpaceEvents([event()]));

    const user = userEvent.setup();
    await renderPanel('/panel/spaces/s1/events');

    expect(await screen.findByTestId('panel-event-e1')).toHaveTextContent('Live Q&A');
    expect(screen.getByTestId('panel-event-e1')).toHaveTextContent('3');
    expect(screen.getByTestId('panel-event-edit-e1')).toHaveAttribute(
      'href',
      '/panel/spaces/s1/events/e1',
    );

    await user.click(screen.getByTestId('panel-events-scope-past'));

    expect(await screen.findByTestId('panel-events-empty')).toHaveTextContent(pl.events.panelEmpty);
  });

  it('creates an event from the panel form', async () => {
    const created: unknown[] = [];
    server.use(
      okStaffSpaces(),
      okSpaceEvents([]),
      http.post('/api/events', async ({ request }) => {
        const body = createEventInputSchema.parse(await request.json());
        created.push(body);
        return HttpResponse.json({ ok: true, data: { event: event() } });
      }),
    );

    const user = userEvent.setup();
    await renderPanel('/panel/spaces/s1/events/new');

    await user.type(await screen.findByLabelText(pl.events.titleLabel), 'Warsztat');
    fireEvent.change(screen.getByLabelText(pl.events.startsAtLabel), {
      target: { value: '2099-09-10T18:00' },
    });
    fireEvent.change(screen.getByLabelText(pl.events.endsAtLabel), {
      target: { value: '2099-09-10T19:30' },
    });
    await user.type(screen.getByLabelText(pl.events.locationLabel), 'Kraków');
    await user.click(screen.getByTestId('event-form-submit'));

    await waitFor(() =>
      expect(created).toEqual([
        {
          spaceId: 's1',
          title: 'Warsztat',
          startsAt: new Date('2099-09-10T18:00').toISOString(),
          endsAt: new Date('2099-09-10T19:30').toISOString(),
          location: 'Kraków',
        },
      ]),
    );
  });

  it('blocks a submission that ends before it starts', async () => {
    server.use(okStaffSpaces(), okSpaceEvents([]));

    const user = userEvent.setup();
    await renderPanel('/panel/spaces/s1/events/new');

    await user.type(await screen.findByLabelText(pl.events.titleLabel), 'Warsztat');
    fireEvent.change(screen.getByLabelText(pl.events.startsAtLabel), {
      target: { value: '2099-09-10T19:00' },
    });
    fireEvent.change(screen.getByLabelText(pl.events.endsAtLabel), {
      target: { value: '2099-09-10T18:00' },
    });

    expect(await screen.findByTestId('event-time-order-error')).toHaveTextContent(
      pl.events.timeOrderError,
    );
    expect(screen.getByTestId('event-form-submit')).toBeDisabled();
  });

  it('edits an existing event without losing its unchanged times', async () => {
    const updates: unknown[] = [];
    server.use(
      okStaffSpaces(),
      okSpaceEvents([event()]),
      okEvent(event()),
      http.post('/api/events/update', async ({ request }) => {
        const body = updateEventInputSchema.parse(await request.json());
        updates.push(body);
        return HttpResponse.json({ ok: true, data: { event: event() } });
      }),
    );

    const user = userEvent.setup();
    await renderPanel('/panel/spaces/s1/events/e1');

    const title = await screen.findByLabelText(pl.events.titleLabel);
    await user.clear(title);
    await user.type(title, 'Live Q&A vol. 2');
    await user.click(screen.getByTestId('event-form-submit'));

    await waitFor(() =>
      expect(updates).toEqual([
        {
          eventId: 'e1',
          title: 'Live Q&A vol. 2',
          description: 'Pytania i odpowiedzi.',
          startsAt: '2099-09-10T16:00:00.000Z',
          endsAt: '2099-09-10T17:30:00.000Z',
          location: 'Online',
          url: 'https://meet.example.com/live',
          liveEmbedUrl: null,
          replayUrl: null,
        },
      ]),
    );
  });

  it('carries the live stream link and refuses a host outside the allowlist', async () => {
    const updates: unknown[] = [];
    server.use(
      okStaffSpaces(),
      okSpaceEvents([event()]),
      okEvent(event()),
      http.post('/api/events/update', async ({ request }) => {
        const body = updateEventInputSchema.parse(await request.json());
        updates.push(body);
        return HttpResponse.json({ ok: true, data: { event: event({ liveEmbedUrl: BUNNY_EMBED }) } });
      }),
    );

    const user = userEvent.setup();
    await renderPanel('/panel/spaces/s1/events/e1');

    const liveField = await screen.findByLabelText(pl.events.liveEmbedUrlLabel);
    await user.type(liveField, 'https://stream.example.com/room/1');

    expect(screen.getByTestId('event-live-embed-help')).toHaveTextContent(pl.events.embedUrlError);
    expect(screen.getByTestId('event-form-submit')).toBeDisabled();

    await user.clear(liveField);
    await user.type(liveField, BUNNY_EMBED);
    await user.click(screen.getByTestId('event-form-submit'));

    await waitFor(() => expect(updates).toMatchObject([{ liveEmbedUrl: BUNNY_EMBED }]));
  });

  it('deletes an event through the confirmation dialog', async () => {
    const deleted: string[] = [];
    server.use(
      okStaffSpaces(),
      okSpaceEvents([event()]),
      http.delete('/api/events/:eventId', ({ params }) => {
        deleted.push(String(params.eventId));
        return HttpResponse.json({ ok: true, data: { eventId: String(params.eventId) } });
      }),
    );

    const user = userEvent.setup();
    await renderPanel('/panel/spaces/s1/events');

    await user.click(await screen.findByTestId('panel-event-delete-e1'));
    await user.click(await screen.findByTestId('panel-event-delete-confirm-e1'));

    await waitFor(() => expect(deleted).toEqual(['e1']));
  });
});
