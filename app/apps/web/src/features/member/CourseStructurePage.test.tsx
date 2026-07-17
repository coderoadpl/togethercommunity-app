import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { Course, CourseStructureWithAccess, ProgressView } from '@core/domain/index.js';

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
    legacyId: null,
    createdAt: '2026-07-12T10:00:00.000Z',
  },
];

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
  it('renders every node as a teaser regardless of access', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByRole('heading', { name: 'JavaScript Foundations' })).toBeInTheDocument();
    expect(screen.getByText('01 - Fundamentals')).toBeInTheDocument();
    expect(screen.getByText('02 - Advanced')).toBeInTheDocument();
    expect(screen.getByText('Locked chapter')).toBeInTheDocument();
    expect(screen.getByText('Closures Deep Dive')).toBeInTheDocument();
  });

  it('does not render modules or chapters without lessons in the member tree', async () => {
    mockPage({
      body: {
        ...structure,
        modules: [
          ...structure.modules,
          {
            id: 'm-empty',
            name: 'Empty module',
            accessStatus: 'fully-accessible',
            completionStatus: 'not-completed',
            chapters: [],
          },
          {
            id: 'm-empty-chapter',
            name: 'Module with empty chapter',
            accessStatus: 'fully-accessible',
            completionStatus: 'not-completed',
            chapters: [
              {
                id: 'c-empty',
                name: 'Empty chapter',
                accessStatus: 'fully-accessible',
                completionStatus: 'not-completed',
                lessons: [],
              },
            ],
          },
        ],
      },
    });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByText('01 - Fundamentals')).toBeInTheDocument();
    expect(screen.queryByText('Empty module')).not.toBeInTheDocument();
    expect(screen.queryByText('Module with empty chapter')).not.toBeInTheDocument();
    expect(screen.queryByText('Empty chapter')).not.toBeInTheDocument();
  });

  it('decorates the three access states with the right icons and disabled behavior', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const accessible = await screen.findByTestId('lesson-button-l1');
    expect(accessible.tagName).toBe('A');
    expect(accessible).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    expect(within(accessible).queryByTestId('lock-closed')).not.toBeInTheDocument();
    expect(within(accessible).queryByTestId('lock-open')).not.toBeInTheDocument();

    const partial = screen.getByTestId('lesson-button-l3');
    expect(partial.tagName).toBe('A');
    expect(within(partial).getByTestId('lock-open')).toBeInTheDocument();

    const locked = screen.getByTestId('lesson-button-l4');
    expect(locked.tagName).not.toBe('A');
    expect(locked).toHaveClass('Mui-disabled');
    expect(within(locked).getByTestId('lock-closed')).toBeInTheDocument();
  });

  it('shows completion checkmarks per lesson, chapter and module', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const completedLesson = await screen.findByTestId('lesson-button-l1');
    expect(within(completedLesson).getByTestId('completion-full')).toBeInTheDocument();

    const module = screen.getByTestId('module-toggle-m1');
    expect(within(module).getByTestId('completion-partial')).toBeInTheDocument();

    const chapter = screen.getByTestId('chapter-toggle-c1');
    expect(within(chapter).getByTestId('completion-partial')).toBeInTheDocument();
  });

  it('collapses a module when its header is clicked', async () => {
    mockPage();
    const user = userEvent.setup();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByText('Intro to Variables')).toBeInTheDocument();
    await user.click(screen.getByTestId('module-toggle-m1'));
    await waitFor(() => expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument());
  });

  it('filters to matching lessons, auto-expands and highlights the match', async () => {
    mockPage();
    const user = userEvent.setup();
    const { container } = await renderPage(<CourseStructurePage courseId="course-1" />);

    await screen.findByText('Intro to Variables');
    await user.type(screen.getByTestId('lesson-search'), 'Scope');

    await waitFor(() => expect(screen.queryByText('Closures Deep Dive')).not.toBeInTheDocument());
    expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument();
    expect(screen.getByTestId('lesson-button-l3')).toBeInTheDocument();

    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('Scope');
  });

  it('shows per-lesson durations only when present', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const timed = await screen.findByTestId('lesson-duration-l1');
    expect(timed).toHaveTextContent('12 min');
    expect(screen.getByTestId('lesson-duration-l4')).toHaveTextContent('30 min');
    expect(screen.queryByTestId('lesson-duration-l3')).not.toBeInTheDocument();
  });

  it('summarizes lessons, total duration and completion in the stat tiles', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const lessonsTile = await screen.findByTestId('stat-tile-lessons');
    expect(lessonsTile).toHaveTextContent('5');
    expect(screen.getByTestId('stat-tile-duration')).toHaveTextContent('1 godz. 0 min');
    expect(screen.getByTestId('stat-tile-completed')).toHaveTextContent('20%');
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

  it('offers an unlock link only for locked lessons covered by a product', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const unlock = await screen.findByTestId('unlock-lesson-l4');
    expect(unlock).toHaveAttribute('href', '/checkout/prod-advanced');
    expect(unlock).toHaveTextContent(pl.courseTree.unlockAccess);
    expect(screen.queryByTestId('unlock-lesson-l5')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlock-lesson-l1')).not.toBeInTheDocument();
  });

  it('shows a friendly empty state for a course without modules', async () => {
    mockPage({ body: { ...structure, modules: [] } });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const empty = await screen.findByTestId('course-empty-state');
    expect(within(empty).getByTestId('empty-course-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(pl.courseTree.emptyCourseTitle);
    expect(empty).toHaveTextContent(pl.courseTree.noPublishedContent);
    expect(screen.queryByTestId('curriculum-card')).not.toBeInTheDocument();
  });

  it('shows a not-found state for a course outside the library', async () => {
    server.use(
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

    expect(await screen.findByRole('heading', { name: pl.courseTree.courseNotFound })).toBeInTheDocument();
  });
});
