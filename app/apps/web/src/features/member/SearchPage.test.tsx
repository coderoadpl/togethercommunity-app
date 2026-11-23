import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { PostSearchHit, PublicPost } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
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
  bodyFormat: 'plain',
  bodyHtml: 'Silnik i zabudowa',
  bodyPlainText: 'Silnik i zabudowa',
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

const navigationCourse = (courseId: string) => ({
  courseId,
  courseName: 'Camper basics',
  completedLessonCount: 0,
  accessibleLessonCount: 2,
  lastActivityAt: null,
});

const okNavigation = (courseIds: readonly string[] = ['c1']) =>
  http.get('/api/member/navigation', () =>
    HttpResponse.json({
      ok: true,
      data: {
        navigation: {
          spaces: [
            { id: 's1', slug: 'general', name: 'General', visibility: 'members', position: 0, isFollowing: true },
          ],
          courses: courseIds.map(navigationCourse),
          lockedSpaces: [],
        },
      },
    }),
  );

const okStructure = (lockedIn: readonly string[] = []) =>
  http.get('/api/student/courses/:courseId/structure', ({ params }) =>
    HttpResponse.json({
      ok: true,
      data: {
        structure: {
          courseId: String(params.courseId),
          name: 'Camper basics',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          modules: [
            {
              id: 'm1',
              name: en.courses.moduleLabel,
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
              chapters: [
                {
                  id: 'ch1',
                  name: en.courses.chapterLabel,
                  accessStatus: 'fully-accessible',
                  completionStatus: 'not-completed',
                  lessons: [
                    {
                      contentId: 'ct1',
                      lessonId: 'l1',
                      name: 'Engine selection',
                      accessStatus: lockedIn.includes(String(params.courseId)) ? 'not-accessible' : 'fully-accessible',
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

const structureLesson = (lessonId: string, opens: boolean) => ({
  contentId: `ct-${lessonId}`,
  lessonId,
  name: `Lesson ${lessonId}`,
  accessStatus: opens ? 'fully-accessible' : 'not-accessible',
  completionStatus: 'not-completed',
});

const gatedStructure = (courses: Record<string, { locksL1: boolean; fails?: boolean; gate?: Promise<void> }>) =>
  http.get('/api/student/courses/:courseId/structure', async ({ params }) => {
    const course = courses[String(params.courseId)];
    await course?.gate;
    if (course === undefined || course.fails === true) {
      return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Internal error' } }, { status: 500 });
    }
    return HttpResponse.json({
      ok: true,
      data: {
        structure: {
          courseId: String(params.courseId),
          name: 'Camper basics',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          modules: [{
            id: 'm1',
            name: en.courses.moduleLabel,
            accessStatus: 'fully-accessible',
            completionStatus: 'not-completed',
            chapters: [{
              id: 'ch1',
              name: en.courses.chapterLabel,
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
              lessons: [structureLesson('l1', !course.locksL1), structureLesson(`l-${String(params.courseId)}`, true)],
            }],
          }],
        },
      },
    });
  });

const gate = () => {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
};

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
    expect(within(spaceGroup).getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(within(spaceGroup).getByTestId('search-hit-h1')).toHaveAttribute(
      'href',
      '/community/s1/posts/h1',
    );

    const lessonGroup = await screen.findByTestId('search-lesson-l1');
    expect(within(lessonGroup).getByRole('heading', { name: 'Engine selection' })).toBeInTheDocument();
    expect(within(lessonGroup).getByTestId('search-hit-h2')).toHaveAttribute(
      'href',
      '/my/courses/c1/lessons/l1',
    );
    expect(within(lessonGroup).getByText('Silnik').tagName).toBe('MARK');
  });

  it.each([
    { courses: ['c1', 'c2'], lockedIn: ['c1'], href: '/my/courses/c2/lessons/l1' },
    { courses: ['c1', 'c2'], lockedIn: ['c2'], href: '/my/courses/c1/lessons/l1' },
    { courses: ['c1', 'c2'], lockedIn: [], href: '/my/courses/c2/lessons/l1' },
  ])('links a lesson hit into a course of $courses that opens it, locked in $lockedIn', async ({ courses, lockedIn, href }) => {
    server.use(
      okNavigation(courses),
      okStructure(lockedIn),
      okHits([hit({ id: 'h2', contextKind: 'lesson', contextId: 'l1' })]),
    );
    const user = userEvent.setup();

    await renderSearch();
    await user.type(screen.getByTestId('search-input'), 'silnik');

    expect(await screen.findByTestId('search-hit-h2')).toHaveAttribute('href', href);
  });

  describe('while course trees load in any order', () => {
    const lessonHits = [
      hit({ id: 'h2', contextKind: 'lesson', contextId: 'l1' }),
      hit({ id: 'h5', contextKind: 'lesson', contextId: 'l-c1' }),
    ];

    it('holds a hit back while only a locked course has placed it, then links the course that opens it', async () => {
      const opening = gate();
      server.use(
        okNavigation(['c1', 'c2']),
        gatedStructure({ c1: { locksL1: true }, c2: { locksL1: false, gate: opening.opened } }),
        okHits(lessonHits),
      );
      const user = userEvent.setup();

      await renderSearch();
      await user.type(screen.getByTestId('search-input'), 'silnik');

      expect(await screen.findByTestId('search-hit-h5')).toHaveAttribute('href', '/my/courses/c1/lessons/l-c1');
      expect(screen.queryByTestId('search-hit-h2')).not.toBeInTheDocument();

      opening.open();
      await waitFor(() => expect(screen.getByTestId('search-hit-h2')).toHaveAttribute('href', '/my/courses/c2/lessons/l1'));
      expect(screen.queryByTestId('search-unresolved')).not.toBeInTheDocument();
    });

    it('keeps the link into the course that opens the hit when a locked course answers later', async () => {
      const locked = gate();
      server.use(
        okNavigation(['c1', 'c2']),
        gatedStructure({ c1: { locksL1: true, gate: locked.opened }, c2: { locksL1: false } }),
        okHits(lessonHits),
      );
      const user = userEvent.setup();

      await renderSearch();
      await user.type(screen.getByTestId('search-input'), 'silnik');

      expect(await screen.findByTestId('search-hit-h2')).toHaveAttribute('href', '/my/courses/c2/lessons/l1');

      locked.open();
      await waitFor(() => expect(screen.getByTestId('search-hit-h5')).toHaveAttribute('href', '/my/courses/c1/lessons/l-c1'));
      expect(screen.getByTestId('search-hit-h2')).toHaveAttribute('href', '/my/courses/c2/lessons/l1');
    });

    it.each([
      { name: 'the tree of the opening course failed to load', courses: { c1: { locksL1: true }, c2: { locksL1: false, fails: true } } },
      { name: 'no course opens the lesson', courses: { c1: { locksL1: true }, c2: { locksL1: true } } },
    ])('shows the hit without a link into a locked place when $name', async ({ courses }) => {
      server.use(okNavigation(['c1', 'c2']), gatedStructure(courses), okHits(lessonHits));
      const user = userEvent.setup();

      await renderSearch();
      await user.type(screen.getByTestId('search-input'), 'silnik');

      const section = await screen.findByTestId('search-unresolved');
      expect(within(section).getByTestId('search-hit-h2')).not.toHaveAttribute('href');
      expect(screen.getByTestId('search-hit-h5')).toHaveAttribute('href', '/my/courses/c1/lessons/l-c1');
    });
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

    expect(await screen.findByTestId('search-empty')).toHaveTextContent(en.search.empty);
    expect(requestedUrls.map((url) => new URL(url).searchParams.get('query'))).toEqual(['ab']);
  });

  it('states plainly that nothing matched and only then explains word stems', async () => {
    server.use(okNavigation(), okStructure(), okHits([]));
    const user = userEvent.setup();

    await renderSearch();
    expect(screen.getByTestId('search-hint')).toHaveTextContent(en.search.hint);
    expect(screen.queryByText(en.search.stemHint)).not.toBeInTheDocument();

    await user.type(screen.getByTestId('search-input'), 'silnik');

    const empty = await screen.findByTestId('search-empty');
    expect(empty).toHaveTextContent(en.search.empty);
    expect(within(empty).getByTestId('search-stem-hint')).toHaveTextContent(en.search.stemHint);
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
    expect(within(section).getByRole('heading', { name: en.search.unresolvedHeading })).toBeInTheDocument();
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

    expect(await screen.findByRole('button', { name: en.common.retry })).toBeInTheDocument();
  });
});
