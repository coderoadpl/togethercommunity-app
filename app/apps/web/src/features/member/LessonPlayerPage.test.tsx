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
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  CourseLesson,
  CourseStructureWithAccess,
  LessonBlock,
  MemberCourseProgress,
  NextLesson,
} from '@core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { LessonPlayerPage } from './LessonPlayerPage.js';

const structure: CourseStructureWithAccess = {
  courseId: 'course-1',
  name: 'JavaScript Foundations',
  accessStatus: 'fully-accessible',
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
              completionStatus: 'not-completed',
            },
          ],
        },
      ],
    },
  ],
};

const allBlocks: LessonBlock[] = [
  { type: 'video', storageKey: 'k1', streamVideoId: 'vid-1', streamLibraryId: '424242' },
  { type: 'pdf', pdfUrl: 'https://cdn.example.com/slides.pdf', name: 'Slides' },
  { type: 'embed', embedUrl: 'https://example.com/embed' },
  { type: 'html', html: '<p>Safe body</p><script>window.__xss = 1;</script>' },
  { type: 'link', url: 'https://github.com/acme/repo', description: 'Course repo' },
  { type: 'link', url: 'https://docs.example.com/guide' },
];

const lesson = (contents: LessonBlock[]): CourseLesson => ({
  id: 'l1',
  tenantId: 't1',
  name: 'Intro to Variables',
  contents,
  legacyId: null,
  createdAt: '2024-01-01T00:00:00.000Z',
});

const progress = (completedLessonIds: string[]): MemberCourseProgress => ({
  id: 'p1',
  tenantId: 't1',
  memberId: 'mem-1',
  courseId: 'course-1',
  completedLessonIds,
  updatedAt: '2024-01-01T00:00:00.000Z',
});

const okLesson = (contents: LessonBlock[]) =>
  http.get('/api/student/lessons/:lessonId', () =>
    HttpResponse.json({ ok: true, data: { lesson: lesson(contents) } }),
  );

const okStructure = () =>
  http.get('/api/student/courses/:courseId/structure', () =>
    HttpResponse.json({ ok: true, data: { structure } }),
  );

const okStructureFullyCompleted = () =>
  http.get('/api/student/courses/:courseId/structure', () =>
    HttpResponse.json({
      ok: true,
      data: { structure: { ...structure, completionStatus: 'fully-completed' } },
    }),
  );

const okProgress = (completedLessonIds: string[] = []) =>
  http.get('/api/student/progress', () =>
    HttpResponse.json({ ok: true, data: { progress: progress(completedLessonIds) } }),
  );

const okNext = (next: NextLesson) =>
  http.get('/api/student/lessons/next', () => HttpResponse.json({ ok: true, data: { next } }));

const renderPage = async (node: ReactNode) => {
  const rootRoute = createRootRoute({ component: () => node });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('LessonPlayerPage', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: {
            userId: 'u1',
            email: 'user@example.com',
            name: 'Jan Uczestnik',
            tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'mem-1' },
          },
        }),
      ),
      http.get('/api/discussion', () =>
        HttpResponse.json({
          ok: true,
          data: { discussion: { threads: [], nextCursor: null, viewerSubscriptions: {} } },
        }),
      ),
    );
  });

  it('renders every typed block', async () => {
    server.use(okNext(null), okStructure(), okProgress(), okLesson(allBlocks));
    const { container } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l1" />,
    );

    const video = await screen.findByTestId('lesson-video');
    expect(video).toHaveAttribute(
      'src',
      'https://iframe.mediadelivery.net/embed/424242/vid-1',
    );
    expect(video).toHaveAttribute('allowfullscreen');

    expect(screen.getByTestId('lesson-pdf')).toHaveAttribute(
      'src',
      'https://cdn.example.com/slides.pdf',
    );
    expect(screen.getByRole('link', { name: pl.lesson.openPdf })).toHaveAttribute(
      'href',
      'https://cdn.example.com/slides.pdf',
    );

    expect(screen.getByTestId('lesson-embed')).toHaveAttribute(
      'src',
      'https://example.com/embed',
    );

    const htmlBlock = screen.getByTestId('lesson-html');
    expect(htmlBlock).toHaveTextContent('Safe body');
    expect(within(htmlBlock).queryByText('window.__xss = 1;')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="lesson-html"] script')).toBeNull();

    expect(screen.getByTestId('link-icon-code')).toBeInTheDocument();
    expect(screen.getByTestId('link-icon-generic')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Course repo/ })).toHaveAttribute(
      'href',
      'https://github.com/acme/repo',
    );
  });

  it('strips a script tag from html content', async () => {
    server.use(
      okNext(null),
      okStructure(),
      okProgress(),
      okLesson([{ type: 'html', html: '<p>Hello</p><script>alert(1)</script>' }]),
    );
    const { container } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l1" />,
    );

    await screen.findByTestId('lesson-html');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByTestId('lesson-html')).toHaveTextContent('Hello');
  });

  it('shows a placeholder when the video has no stream library id', async () => {
    server.use(
      okNext(null),
      okStructure(),
      okProgress(),
      okLesson([{ type: 'video', storageKey: 'k1', streamVideoId: 'vid-1' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-video-placeholder')).toHaveTextContent(
      pl.lesson.videoPlaceholder,
    );
    expect(screen.queryByTestId('lesson-video')).not.toBeInTheDocument();
  });

  it('renders breadcrumbs from the course structure', async () => {
    server.use(okNext(null), okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const crumbs = await screen.findByLabelText('breadcrumb');
    expect(within(crumbs).getByRole('link', { name: 'JavaScript Foundations' })).toBeInTheDocument();
    expect(within(crumbs).getByText('01 - Fundamentals')).toBeInTheDocument();
    expect(within(crumbs).getByText('Getting started')).toBeInTheDocument();
  });

  it('completes the lesson: optimistic checkmark, disabled button and invalidation', async () => {
    let completeCalls = 0;
    let progressReads = 0;
    server.use(
      okNext({ id: 'l2', name: 'Next Lesson' }),
      okStructure(),
      okLesson(allBlocks),
      http.get('/api/student/progress', () => {
        progressReads += 1;
        const done = completeCalls > 0 ? ['l1'] : [];
        return HttpResponse.json({ ok: true, data: { progress: progress(done) } });
      }),
      http.post('/api/student/lessons/complete', () => {
        completeCalls += 1;
        return HttpResponse.json({ ok: true, data: { progress: progress(['l1']) } });
      }),
    );

    const user = userEvent.setup();
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const button = await screen.findByTestId('mark-complete');
    expect(button).not.toBeDisabled();

    const readsBefore = progressReads;
    await user.click(button);

    await waitFor(() => expect(within(button).getByTestId('completion-full')).toBeInTheDocument());
    expect(button).toBeDisabled();
    expect(completeCalls).toBe(1);
    await waitFor(() => expect(progressReads).toBeGreaterThan(readsBefore));
  });

  it('links to the server-computed next lesson and shows completion at course end', async () => {
    server.use(
      okNext({ id: 'l2', name: 'Advanced Variables' }),
      okStructure(),
      okProgress(),
      okLesson(allBlocks),
    );
    const { unmount } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l1" />,
    );

    const nextLink = await screen.findByTestId('next-lesson');
    expect(nextLink).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(nextLink).toHaveTextContent('Advanced Variables');
    unmount();

    server.use(okNext(null), okStructureFullyCompleted(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    expect(await screen.findByTestId('course-completed')).toHaveTextContent(pl.lesson.courseCompleted);
    expect(screen.queryByTestId('course-end')).not.toBeInTheDocument();
  });

  it('shows a neutral end-of-course state at the last lesson when the course is not finished', async () => {
    server.use(okNext(null), okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    await screen.findByTestId('mark-complete');
    expect(screen.queryByTestId('course-completed')).not.toBeInTheDocument();
    expect(await screen.findByTestId('course-end')).toHaveTextContent(pl.lesson.lastLesson);
  });

  it('renders a full-page locked state on a 403 envelope without upsell', async () => {
    server.use(
      http.get('/api/student/lessons/:lessonId', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'forbidden', message: 'Forbidden' } },
          { status: 403 },
        ),
      ),
      okStructure(),
      okProgress(),
      okNext(null),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByRole('heading', { name: pl.lesson.contentLocked })).toBeInTheDocument();
    expect(screen.getByTestId('locked-state-icon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.lesson.backToCourse })).toHaveAttribute(
      'href',
      '/my/courses/course-1',
    );
    expect(screen.getByRole('link', { name: pl.lesson.browseCourses })).toHaveAttribute('href', '/my');
    expect(screen.queryByText(/upgrade|enroll|subscription|price/i)).not.toBeInTheDocument();
  });

  it('shows an unlock CTA on the locked page when a product covers the lesson', async () => {
    const lockedStructure: CourseStructureWithAccess = {
      ...structure,
      modules: structure.modules.map((module) => ({
        ...module,
        chapters: module.chapters.map((chapter) => ({
          ...chapter,
          lessons: chapter.lessons.map((entry) => ({
            ...entry,
            accessStatus: 'not-accessible',
            unlockProductId: 'prod-full',
          })),
        })),
      })),
    };
    server.use(
      http.get('/api/student/lessons/:lessonId', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'forbidden', message: 'Forbidden' } },
          { status: 403 },
        ),
      ),
      http.get('/api/student/courses/:courseId/structure', () =>
        HttpResponse.json({ ok: true, data: { structure: lockedStructure } }),
      ),
      okProgress(),
      okNext(null),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const unlock = await screen.findByTestId('unlock-lesson-cta');
    expect(unlock).toHaveAttribute('href', '/checkout/prod-full');
    expect(unlock).toHaveTextContent(pl.courseTree.unlockAccess);
  });

  it('renders the rail curriculum with the current lesson highlighted', async () => {
    server.use(okNext(null), okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const rail = await screen.findByTestId('curriculum-card');
    expect(rail).toHaveTextContent(pl.courseOverview.curriculum);
    const current = within(rail).getByTestId('lesson-button-l1');
    expect(current).toHaveClass('Mui-selected');
  });

  it('shows a friendly empty state for a lesson without blocks', async () => {
    server.use(okNext(null), okStructure(), okProgress(), okLesson([]));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const empty = await screen.findByTestId('lesson-empty-state');
    expect(within(empty).getByTestId('empty-lesson-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(pl.lesson.noContentTitle);
    expect(empty).toHaveTextContent(pl.lesson.noContent);
  });

  it('fires a fire-and-forget last-viewed with module and chapter ids on mount', async () => {
    let lastViewedBody: unknown = null;
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      okNext(null),
      http.post('/api/student/progress/last-viewed', async ({ request }) => {
        lastViewedBody = await request.json();
        return HttpResponse.json({ ok: true, data: { progress: progress([]) } });
      }),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('lesson-video');
    await waitFor(() =>
      expect(lastViewedBody).toEqual({
        courseId: 'course-1',
        lessonId: 'l1',
        moduleId: 'm1',
        chapterId: 'c1',
      }),
    );
  });
});
