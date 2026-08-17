import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { PostSearchHit, PublicPost } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { SearchPage } from './SearchPage.js';

const post = (input: {
  id: string;
  contextKind: 'lesson' | 'space';
  contextId: string;
  rootPostId?: string;
}): PublicPost => ({
  id: input.id,
  tenantId: 't1',
  contextKind: input.contextKind,
  contextId: input.contextId,
  parentPostId: input.rootPostId === undefined ? null : input.rootPostId,
  rootPostId: input.rootPostId ?? input.id,
  isOwn: false,
  authorDisplay: `Autor ${input.id}`,
  authorIsStaff: false,
  authorAvatarUrl: null,
  body: 'Silnik i zabudowa',
  createdAt: '2026-08-15T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
});

const hit = (input: {
  id: string;
  contextKind: 'lesson' | 'space';
  contextId: string;
  rootPostId?: string;
}): PostSearchHit => ({
  post: post(input),
  lessonId: input.contextId,
  snippet: 'Silnik i zabudowa',
});

const okNavigation = () =>
  http.get('/api/member/navigation', () =>
    HttpResponse.json({
      ok: true,
      data: {
        navigation: {
          spaces: [
            { id: 's1', slug: 'ogolna', name: 'Ogólna', visibility: 'members', position: 0, isFollowing: true },
          ],
          courses: [
            {
              courseId: 'c1',
              courseName: 'Kamper od podstaw',
              completedLessonCount: 0,
              accessibleLessonCount: 2,
              lastActivityAt: null,
            },
          ],
          lockedSpaces: [],
        },
      },
    }),
  );

const okStructure = () =>
  http.get('/api/student/courses/:courseId/structure', ({ params }) =>
    HttpResponse.json({
      ok: true,
      data: {
        structure: {
          courseId: String(params.courseId),
          name: 'Kamper od podstaw',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          modules: [
            {
              id: 'm1',
              name: 'Moduł',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
              chapters: [
                {
                  id: 'ch1',
                  name: 'Rozdział',
                  accessStatus: 'fully-accessible',
                  completionStatus: 'not-completed',
                  lessons: [
                    {
                      contentId: 'ct1',
                      lessonId: 'l1',
                      name: 'Wybór silnika',
                      accessStatus: 'fully-accessible',
                      completionStatus: 'not-completed',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    }),
  );

const okHits = (hits: PostSearchHit[], requestedUrls: string[] = []) =>
  http.get('/api/posts/search', ({ request }) => {
    requestedUrls.push(request.url);
    return HttpResponse.json({ ok: true, data: { hits } });
  });

const renderSearch = async () => {
  const rootRoute = createRootRoute({ component: SearchPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/search'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('SearchPage', () => {
  it('groups hits by space and lesson with deep links into both surfaces', async () => {
    server.use(
      okNavigation(),
      okStructure(),
      okHits([
        hit({ id: 'h1', contextKind: 'space', contextId: 's1' }),
        hit({ id: 'h2', contextKind: 'lesson', contextId: 'l1' }),
      ]),
    );
    const user = userEvent.setup();

    await renderSearch();
    await user.type(screen.getByTestId('search-input'), 'silnik');

    const spaceGroup = await screen.findByTestId('search-space-s1');
    expect(within(spaceGroup).getByRole('heading', { name: 'Ogólna' })).toBeInTheDocument();
    expect(within(spaceGroup).getByTestId('search-hit-h1')).toHaveAttribute(
      'href',
      '/community/s1/posts/h1',
    );

    const lessonGroup = await screen.findByTestId('search-lesson-l1');
    expect(within(lessonGroup).getByRole('heading', { name: 'Wybór silnika' })).toBeInTheDocument();
    expect(within(lessonGroup).getByTestId('search-hit-h2')).toHaveAttribute(
      'href',
      '/my/courses/c1/lessons/l1',
    );
    expect(within(lessonGroup).getByText('Silnik').tagName).toBe('MARK');
  });

  it('sends a reply hit to its thread root, not to the reply itself', async () => {
    server.use(
      okNavigation(),
      okStructure(),
      okHits([hit({ id: 'h3', contextKind: 'space', contextId: 's1', rootPostId: 'root-1' })]),
    );
    const user = userEvent.setup();

    await renderSearch();
    await user.type(screen.getByTestId('search-input'), 'silnik');

    expect(await screen.findByTestId('search-hit-h3')).toHaveAttribute(
      'href',
      '/community/s1/posts/root-1',
    );
  });

  it('waits for a query of at least two characters before searching', async () => {
    const requestedUrls: string[] = [];
    server.use(okNavigation(), okStructure(), okHits([], requestedUrls));
    const user = userEvent.setup();

    await renderSearch();
    await user.type(screen.getByTestId('search-input'), 'a');
    await user.type(screen.getByTestId('search-input'), 'b');

    expect(await screen.findByTestId('search-empty')).toHaveTextContent(pl.search.empty);
    expect(requestedUrls.map((url) => new URL(url).searchParams.get('query'))).toEqual(['ab']);
  });

  it('states plainly that nothing matched', async () => {
    server.use(okNavigation(), okStructure(), okHits([]));
    const user = userEvent.setup();

    await renderSearch();
    await user.type(screen.getByTestId('search-input'), 'silnik');

    expect(await screen.findByTestId('search-empty')).toHaveTextContent(pl.search.empty);
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument();
  });

  it('keeps a hit whose lesson no longer resolves, without inventing a link', async () => {
    server.use(
      okNavigation(),
      okStructure(),
      okHits([hit({ id: 'h4', contextKind: 'lesson', contextId: 'l9' })]),
    );
    const user = userEvent.setup();

    await renderSearch();
    await user.type(screen.getByTestId('search-input'), 'silnik');

    const section = await screen.findByTestId('search-unresolved');
    expect(within(section).getByRole('heading', { name: pl.search.unresolvedHeading })).toBeInTheDocument();
    expect(within(section).getByTestId('search-hit-h4')).not.toHaveAttribute('href');
  });

  it('offers a retry when the search request fails', async () => {
    server.use(
      okNavigation(),
      okStructure(),
      http.get('/api/posts/search', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'internal', message: 'Internal error' } },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();

    await renderSearch();
    await user.type(screen.getByTestId('search-input'), 'silnik');

    expect(await screen.findByRole('button', { name: pl.common.retry })).toBeInTheDocument();
  });
});
