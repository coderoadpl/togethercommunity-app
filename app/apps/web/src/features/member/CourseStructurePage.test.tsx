import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Course, CourseStructureWithAccess, ProgressView } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CourseStructurePage } from './CourseStructurePage.js';

const structure: CourseStructureWithAccess = {
  courseId: 'course-1',
  name: 'JavaScript Foundations',
  accessStatus: 'partially-accessible',
  completionStatus: 'partially-completed',
  modules: [
    {
      id: 'm1',
      name: '01 - Fundamentals',
      accessStatus: 'fully-accessible',
      completionStatus: 'partially-completed',
      chapters: [
        {
          id: 'c1',
          name: 'Getting started',
          accessStatus: 'fully-accessible',
          completionStatus: 'partially-completed',
          lessons: [
            {
              contentId: 'ct1',
              lessonId: 'l1',
              name: 'Intro to Variables',
              accessStatus: 'fully-accessible',
              completionStatus: 'fully-completed',
              durationMinutes: 12,
            },
            {
              contentId: 'ct2',
              lessonId: 'l2',
              name: 'Advanced Variables',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
              durationMinutes: 18,
            },
          ],
        },
        {
          id: 'c2',
          name: 'Preview chapter',
          accessStatus: 'partially-accessible',
          completionStatus: 'not-completed',
          lessons: [
            {
              contentId: 'ct3',
              lessonId: 'l3',
              name: 'Scope Basics',
              accessStatus: 'partially-accessible',
              completionStatus: 'not-completed',
            },
          ],
        },
      ],
    },
    {
      id: 'm2',
      name: '02 - Advanced',
      accessStatus: 'not-accessible',
      completionStatus: 'not-completed',
      chapters: [
        {
          id: 'c3',
          name: 'Locked chapter',
          accessStatus: 'not-accessible',
          completionStatus: 'not-completed',
          lessons: [
            {
              contentId: 'ct4',
              lessonId: 'l4',
              name: 'Closures Deep Dive',
              accessStatus: 'not-accessible',
              completionStatus: 'not-completed',
              durationMinutes: 30,
              unlockProductId: 'prod-advanced',
            },
            {
              contentId: 'ct5',
              lessonId: 'l5',
              name: 'Uncovered Lesson',
              accessStatus: 'not-accessible',
              completionStatus: 'not-completed',
            },
          ],
        },
      ],
    },
  ],
};

const catalog: Course[] = [
  {
    id: 'course-1',
    tenantId: 't1',
    name: 'JavaScript Foundations',
    description: 'Start from zero.',
    imageUrl: 'https://picsum.photos/seed/js/960/540',
    moduleOrder: [],
    publiclyVisible: false,
    legacyId: null,
    createdAt: '2026-07-12T10:00:00.000Z',
  },
];

const okMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'jan@example.com',
        emailVerified: true,
        name: 'Jan Uczestnik',
        tenant: {
          id: 't1',
          slug: 'acme',
          name: 'Acme',
          staffRole: null,
          memberId: 'm1',
          banned: false,
        },
      },
    }),
  );

const anonMe = () =>
  http.get('/api/me', () =>
    HttpResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    ),
  );

const progressView = (lastViewedLessonId?: string): ProgressView => ({
  courseId: 'course-1',
  completedLessonIds: ['l1'],
  ...(lastViewedLessonId === undefined ? {} : { lastViewedLessonId }),
});

const mockPage = ({
  body = structure,
  lastViewedLessonId,
}: {
  body?: CourseStructureWithAccess;
  lastViewedLessonId?: string;
} = {}) => {
  server.use(
    okMe(),
    http.get('/api/student/courses/:courseId/structure', () =>
      HttpResponse.json({ ok: true, data: { structure: body } }),
    ),
    http.get('/api/student/progress', () =>
      HttpResponse.json({ ok: true, data: { progress: progressView(lastViewedLessonId) } }),
    ),
    http.get('/api/student/courses', () =>
      HttpResponse.json({ ok: true, data: { courses: catalog } }),
    ),
  );
};

const stubViewport = (isCompact: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: isCompact && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const renderPage = async (node: ReactNode) => {
  const rootRoute = createRootRoute({ component: () => node });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('CourseStructurePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps progress plus the small-screen program leading and discussion trailing', async () => {
    stubViewport(true);
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const leading = await screen.findByTestId('member-rail-leading');
    const trailing = screen.getByTestId('member-rail-trailing');
    const inlineProgram = within(leading).getByTestId('course-tree-inline');

    expect(within(leading).getByTestId('course-progress-card')).toBeInTheDocument();
    expect(screen.getAllByTestId('course-progress-card')).toHaveLength(1);
    expect(within(trailing).getByTestId('course-discussion-search')).toBeInTheDocument();
    expect(within(inlineProgram).getByTestId('course-tree')).toBeInTheDocument();
    expect(screen.getAllByTestId('course-tree')).toHaveLength(1);
    expect(within(inlineProgram).getByTestId('lesson-search')).toBeInTheDocument();
    expect(within(inlineProgram).getByTestId('module-toggle-m1')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument();
  });

  it('drops the small-screen program for a course without modules', async () => {
    stubViewport(true);
    mockPage({ body: { ...structure, modules: [] } });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    await screen.findByTestId('course-progress-card');
    expect(screen.queryByTestId('course-tree-inline')).not.toBeInTheDocument();
  });

  it('leaves the program to the shell sidebar on desktop', async () => {
    stubViewport(false);
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    await screen.findByTestId('course-progress-card');
    expect(screen.queryByTestId('course-tree-inline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-tree')).not.toBeInTheDocument();
  });

  it('renders the course title as the single page heading', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'JavaScript Foundations' })).toBeInTheDocument();
  });

  it('summarizes lessons and total duration in the stat tiles, leaving progress to the rail', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const lessonsTile = await screen.findByTestId('stat-tile-lessons');
    expect(lessonsTile).toHaveTextContent('5');
    expect(screen.getByTestId('stat-tile-duration')).toHaveTextContent('1 godz. 0 min');
    expect(screen.queryByTestId('stat-tile-completed')).not.toBeInTheDocument();
    expect(screen.getByTestId('progress-summary')).toHaveTextContent('1 z 5 ukończone');
  });

  it('points the continue CTA at the last viewed lesson when it is unfinished', async () => {
    mockPage({ lastViewedLessonId: 'l2' });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const cta = await screen.findByTestId('continue-cta');
    expect(cta).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(cta).toHaveTextContent(pl.courseOverview.continueLearning);
    expect(screen.getByTestId('first-lesson-link')).toHaveAttribute(
      'href',
      '/my/courses/course-1/lessons/l1',
    );
  });

  it('skips a completed last-viewed lesson and targets the first unfinished one', async () => {
    mockPage({ lastViewedLessonId: 'l1' });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const cta = await screen.findByTestId('continue-cta');
    expect(cta).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(cta).toHaveTextContent(pl.courseOverview.continueLearning);
  });

  it('falls back to the first unfinished accessible lesson without a last viewed one', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const cta = await screen.findByTestId('continue-cta');
    expect(cta).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
  });

  it('switches the CTA to a review state once every accessible lesson is complete', async () => {
    const completed: CourseStructureWithAccess = {
      ...structure,
      accessStatus: 'fully-accessible',
      completionStatus: 'fully-completed',
      modules: [
        {
          id: 'm1',
          name: '01 - Fundamentals',
          accessStatus: 'fully-accessible',
          completionStatus: 'fully-completed',
          chapters: [
            {
              id: 'c1',
              name: 'Getting started',
              accessStatus: 'fully-accessible',
              completionStatus: 'fully-completed',
              lessons: [
                {
                  contentId: 'ct1',
                  lessonId: 'l1',
                  name: 'Intro to Variables',
                  accessStatus: 'fully-accessible',
                  completionStatus: 'fully-completed',
                  durationMinutes: 12,
                },
                {
                  contentId: 'ct2',
                  lessonId: 'l2',
                  name: 'Advanced Variables',
                  accessStatus: 'fully-accessible',
                  completionStatus: 'fully-completed',
                  durationMinutes: 18,
                },
              ],
            },
          ],
        },
      ],
    };
    mockPage({ body: completed, lastViewedLessonId: 'l2' });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const cta = await screen.findByTestId('continue-cta');
    expect(cta).toHaveTextContent(pl.courseOverview.reviewAgain);
    expect(cta).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    expect(screen.getByTestId('course-completed-note')).toHaveTextContent(
      pl.courseOverview.courseCompleted,
    );
  });

  it('hides the continue CTA when no lesson is accessible', async () => {
    const locked: CourseStructureWithAccess = {
      ...structure,
      accessStatus: 'not-accessible',
      modules: structure.modules.map((module) => ({
        ...module,
        accessStatus: 'not-accessible',
        chapters: module.chapters.map((chapter) => ({
          ...chapter,
          accessStatus: 'not-accessible',
          lessons: chapter.lessons.map((lesson) => ({
            ...lesson,
            accessStatus: 'not-accessible',
          })),
        })),
      })),
    };
    mockPage({ body: locked });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    await screen.findByTestId('course-progress-card');
    expect(screen.queryByTestId('continue-cta')).not.toBeInTheDocument();
  });

  it('shows a friendly empty state for a course without modules', async () => {
    mockPage({ body: { ...structure, modules: [] } });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const empty = await screen.findByTestId('course-empty-state');
    expect(within(empty).getByTestId('empty-course-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(pl.courseTree.emptyCourseTitle);
    expect(empty).toHaveTextContent(pl.courseTree.noPublishedContent);
    expect(screen.queryByTestId('course-discussion-search')).not.toBeInTheDocument();
  });

  it('shows a not-found state for a course outside the library', async () => {
    server.use(
      okMe(),
      http.get('/api/student/courses/:courseId/structure', () =>
        HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Not found' } }, { status: 404 }),
      ),
      http.get('/api/student/progress', () =>
        HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Not found' } }, { status: 404 }),
      ),
      http.get('/api/student/courses', () =>
        HttpResponse.json({ ok: true, data: { courses: [] } }),
      ),
    );
    await renderPage(<CourseStructurePage courseId="course-9" />);

    expect(await screen.findByRole('heading', { level: 1, name: pl.courseTree.courseNotFound })).toBeInTheDocument();
  });

  it('serves an anonymous visitor the public program without progress or discussion', async () => {
    server.use(
      anonMe(),
      http.get('/api/public/courses/:courseId/structure', () =>
        HttpResponse.json({ ok: true, data: { structure } }),
      ),
      http.get('/api/public/navigation', () =>
        HttpResponse.json({
          ok: true,
          data: {
            navigation: {
              defaultHomeSpaceId: null,
              spaces: [],
              courses: [
                {
                  id: 'course-1',
                  name: 'JavaScript Foundations',
                  description: 'Start from zero.',
                  imageUrl: null,
                },
              ],
              lockedSpaces: [],
            },
          },
        }),
      ),
    );

    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByTestId('anon-course-program')).toHaveTextContent(
      pl.anon.lockedCourseHint,
    );
    expect(screen.getByTestId('course-tree')).toBeInTheDocument();
    expect(screen.getByTestId('stat-tile-lessons')).toHaveTextContent('5');
    expect(screen.queryByTestId('stat-tile-completed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-progress-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-discussion-search')).not.toBeInTheDocument();
    for (const testId of ['public-course-unlock-cta', 'public-course-unlock-cta-program']) {
      expect(screen.getByTestId(testId)).toHaveAttribute('href', '/checkout/prod-advanced');
    }
    expect(screen.getByTestId('member-breadcrumbs')).toHaveTextContent(pl.shell.start);
  });
});
