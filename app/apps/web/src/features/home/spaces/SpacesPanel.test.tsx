import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  createSpaceInputSchema,
  setSpaceArchivedInputSchema,
  updateSpaceInputSchema,
  type StaffSpace,
} from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { PanelSpaceDetailRoute } from '../panel-routes.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SpaceCreatePage } from './SpaceCreatePage.js';
import { SpacesPanel } from './SpacesPanel.js';

const staffSpace = (over: Partial<StaffSpace> & { id: string }): StaffSpace => ({
  tenantId: 't1',
  slug: over.id,
  name: 'Ogólna',
  description: 'Rozmowy o wszystkim.',
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: '2026-07-20T08:00:00.000Z',
  stats: { posts: 4, followers: 7 },
  ...over,
});

const noProducts = () =>
  http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } }));

const tenantSettings = (defaultHomeSpaceId: string | null = null) =>
  http.get('/api/tenant/settings', () =>
    HttpResponse.json({
      ok: true,
      data: {
        settings: {
          name: 'Akademia',
          socialLinks: [],
          billingPortalUrl: null,
          bunnyStreamLibraryId: null,
          defaultHomeSpaceId,
        },
      },
    }),
  );

const renderPanel = async (initialEntry = '/panel/spaces') => {
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/spaces',
    component: SpacesPanel,
  });
  const createRoutePage = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/spaces/new',
    component: SpaceCreatePage,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/spaces/$spaceId',
    component: PanelSpaceDetailRoute,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, createRoutePage, detailRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('spaces panel', () => {
  it('lists staff spaces with stats and creates a new one', async () => {
    let spaces = [staffSpace({ id: 's1', name: 'Ogólna' })];
    const created: unknown[] = [];
    server.use(
      noProducts(),
      http.get('/api/spaces/staff', () => HttpResponse.json({ ok: true, data: { spaces } })),
      http.post('/api/spaces', async ({ request }) => {
        const body = createSpaceInputSchema.parse(await request.json());
        created.push(body);
        const next = staffSpace({ id: 's2', slug: body.slug, name: body.name });
        spaces = [...spaces, next];
        return HttpResponse.json({ ok: true, data: { space: next } });
      }),
    );

    await renderPanel();

    const row = await screen.findByTestId('space-row');
    expect(row).toHaveTextContent('Ogólna');
    expect(row).toHaveTextContent(pl.spacesPanel.postsNoun({ count: 4 }));
    expect(row).toHaveTextContent(pl.spacesPanel.followersNoun({ count: 7 }));

    await userEvent.click(screen.getByRole('link', { name: `+ ${pl.common.add}` }));
    await userEvent.type(await screen.findByLabelText(pl.spacesPanel.nameLabel), 'Klub');
    await userEvent.click(screen.getByTestId('space-form-submit'));

    await waitFor(() =>
      expect(created).toEqual([
        { slug: 'klub', name: 'Klub', visibility: 'members', productIds: [], publicReadOnly: false },
      ]),
    );
    expect(await screen.findByText('Klub')).toBeInTheDocument();
  });

  it('badges publicly readable spaces so the public layer is visible at a glance', async () => {
    server.use(
      noProducts(),
      http.get('/api/spaces/staff', () =>
        HttpResponse.json({
          ok: true,
          data: {
            spaces: [
              staffSpace({ id: 's1', name: 'Ogólna', publicReadOnly: true }),
              staffSpace({ id: 's2', name: 'Zamknięta' }),
            ],
          },
        }),
      ),
    );

    await renderPanel();

    expect(await screen.findByTestId('space-public-s1')).toHaveTextContent(pl.spacesPanel.publicChip);
    expect(screen.queryByTestId('space-public-s2')).not.toBeInTheDocument();
  });

  it('archives a space through the confirm dialog', async () => {
    let spaces = [staffSpace({ id: 's1', name: 'Ogólna' })];
    const archived: unknown[] = [];
    server.use(
      noProducts(),
      http.get('/api/spaces/staff', () => HttpResponse.json({ ok: true, data: { spaces } })),
      http.post('/api/spaces/archive', async ({ request }) => {
        const body = setSpaceArchivedInputSchema.parse(await request.json());
        archived.push(body);
        spaces = spaces.map((space) =>
          space.id === body.id ? { ...space, archivedAt: body.archived ? '2026-07-20T09:00:00.000Z' : null } : space,
        );
        const updated = spaces.find((space) => space.id === body.id) ?? spaces[0];
        return HttpResponse.json({ ok: true, data: { space: updated } });
      }),
    );

    await renderPanel();

    await userEvent.click(await screen.findByTestId('space-archive-s1'));
    await userEvent.click(await screen.findByTestId('space-archive-confirm-s1'));

    await waitFor(() => expect(archived).toEqual([{ id: 's1', archived: true }]));
    await waitFor(() => expect(screen.queryByTestId('space-row')).not.toBeInTheDocument());
  });

  it('edits a space on the detail subpage', async () => {
    const original = staffSpace({ id: 's1', name: 'Ogólna', description: 'Stary opis' });
    const updates: unknown[] = [];
    server.use(
      noProducts(),
      tenantSettings(),
      http.get('/api/spaces/staff', () => HttpResponse.json({ ok: true, data: { spaces: [original] } })),
      http.post('/api/spaces/update', async ({ request }) => {
        const body = updateSpaceInputSchema.parse(await request.json());
        updates.push(body);
        return HttpResponse.json({ ok: true, data: { space: { ...original, name: body.name ?? original.name } } });
      }),
    );

    await renderPanel('/panel/spaces/s1');

    const nameField = await screen.findByLabelText(pl.spacesPanel.nameLabel);
    expect(nameField).toHaveValue('Ogólna');
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Ogólna 2.0');
    await userEvent.click(screen.getByTestId('space-form-submit'));

    await waitFor(() =>
      expect(updates).toEqual([
        {
          id: 's1',
          name: 'Ogólna 2.0',
          description: 'Stary opis',
          visibility: 'members',
          productIds: [],
          publicReadOnly: false,
          position: 0,
        },
      ]),
    );
  });

  it('opens a space to anonymous readers from the detail subpage', async () => {
    const original = staffSpace({ id: 's1' });
    const updates: unknown[] = [];
    server.use(
      noProducts(),
      tenantSettings(),
      http.get('/api/spaces/staff', () => HttpResponse.json({ ok: true, data: { spaces: [original] } })),
      http.post('/api/spaces/update', async ({ request }) => {
        const body = updateSpaceInputSchema.parse(await request.json());
        updates.push(body);
        return HttpResponse.json({ ok: true, data: { space: { ...original, publicReadOnly: true } } });
      }),
    );

    await renderPanel('/panel/spaces/s1');

    const toggle = await screen.findByRole('checkbox', { name: pl.spacesPanel.publicReadOnlyLabel });
    expect(screen.getByText(pl.spacesPanel.publicReadOnlyHelper)).toBeInTheDocument();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId('space-form-submit'));

    await waitFor(() => expect(updates).toMatchObject([{ id: 's1', publicReadOnly: true }]));
  });

  it('locks the public toggle of the tenant home space', async () => {
    const original = staffSpace({ id: 's1', publicReadOnly: true });
    server.use(
      noProducts(),
      tenantSettings('s1'),
      http.get('/api/spaces/staff', () => HttpResponse.json({ ok: true, data: { spaces: [original] } })),
    );

    await renderPanel('/panel/spaces/s1');

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: pl.spacesPanel.publicReadOnlyLabel })).toBeDisabled(),
    );
    expect(screen.getByText(pl.spacesPanel.publicReadOnlyHomeSpaceBlocked)).toBeInTheDocument();
  });
});
