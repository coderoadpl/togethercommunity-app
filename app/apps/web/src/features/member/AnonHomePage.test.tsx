import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { PublicNavigation, SpaceFeedItem } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { AnonHomePage } from './AnonHomePage.js';

const navigation = (overrides: Partial<PublicNavigation> = {}): PublicNavigation => ({
  defaultHomeSpaceId: 's1',
  spaces: [{ id: 's1', slug: 'ogolna', name: 'Ogólna', description: 'Rozmowy.', position: 0 }],
  courses: [{ id: 'c1', name: 'JavaScript od zera', description: 'Kurs startowy.', imageUrl: null }],
  lockedSpaces: [
    { id: 's9', slug: 'premium', name: 'Premium', description: null, productIds: ['p1'] },
  ],
  ...overrides,
});

const okNavigation = (value: PublicNavigation = navigation()) =>
  http.get('/api/public/navigation', () =>
    HttpResponse.json({ ok: true, data: { navigation: value } }));

const feedItem = (id: string, body: string): SpaceFeedItem => ({
  id,
  tenantId: 't1',
  contextKind: 'space',
  contextId: 's1',
  parentPostId: null,
  rootPostId: id,
  isOwn: false,
  authorDisplay: 'Ola Autorka',
  authorIsStaff: false,
  authorAvatarUrl: null,
  body,
  createdAt: '2026-07-20T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  replyCount: 0,
  reactions: [],
});

const okFeed = (items: SpaceFeedItem[]) =>
  http.get('/api/public/spaces/:spaceId/feed', () =>
    HttpResponse.json({
      ok: true,
      data: { feed: { spaceId: 's1', items, pinned: [], nextCursor: null, isFollowing: false } },
    }),
  );

const renderPage = async () => {
  const rootRoute = createRootRoute({ component: AnonHomePage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('AnonHomePage', () => {
  it('opens with the home space feed above the public tiles', async () => {
    server.use(okNavigation(), okFeed([feedItem('p1', 'Wpis powitalny')]));

    await renderPage();

    expect(await screen.findByTestId('public-feed-post-p1')).toHaveTextContent('Wpis powitalny');
    expect(screen.getByTestId('anon-home-feed')).toHaveTextContent('Ogólna');
    expect(screen.getByTestId('anon-read-only-banner')).toHaveTextContent(pl.anon.readOnlyBanner);
    expect(screen.getByTestId('space-card-s1')).toHaveAttribute('href', '/community/s1');
    expect(screen.getByTestId('course-card-c1')).toHaveAttribute('href', '/my/courses/c1');
    expect(screen.getByTestId('locked-space-cta-s9')).toHaveAttribute('href', '/checkout/p1');
  });

  it('labels the public tile sections for a visitor and offers a sign-in link in the banner', async () => {
    server.use(okNavigation(), okFeed([]));

    await renderPage();

    expect(await screen.findByTestId('anon-courses')).toHaveTextContent(pl.anon.coursesSection);
    expect(screen.getByTestId('anon-spaces')).toHaveTextContent(pl.anon.spacesSection);
    expect(screen.getByTestId('anon-courses')).not.toHaveTextContent(pl.start.coursesSection);
    expect(
      within(screen.getByTestId('anon-read-only-banner')).getByRole('link', {
        name: pl.auth.signInLink,
      }),
    ).toHaveAttribute('href', '/login');
  });

  it('drops the feed section when no home space is configured', async () => {
    server.use(okNavigation(navigation({ defaultHomeSpaceId: null })));

    await renderPage();

    expect(await screen.findByTestId('space-card-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('anon-home-feed')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing is public', async () => {
    server.use(
      okNavigation({ defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] }),
    );

    await renderPage();

    const empty = await screen.findByTestId('anon-empty-state');
    expect(empty).toHaveTextContent(pl.anon.emptyTitle);
    expect(empty).toHaveTextContent(pl.anon.emptyBody);
  });
});
