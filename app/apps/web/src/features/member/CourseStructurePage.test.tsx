import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Course, CourseStructureWithAccess, ProgressView } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { stylesAt } from '../../lib/stylesheet.js';
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
        email: 'john@example.com',
        emailVerified: true,
        name: 'John Participant',
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
  progressPending = false,
  resume = { target: { id: 'l2', name: 'Advanced Variables' }, firstIncomplete: { id: 'l2', name: 'Advanced Variables' }, isReview: false },
}: {
  body?: CourseStructureWithAccess;
  lastViewedLessonId?: string;
  progressPending?: boolean;
  resume?: ProgressView['resume'];
} = {}) => {
  server.use(
    okMe(),
    http.get('/api/student/courses/:courseId/structure', () =>
      HttpResponse.json({ ok: true, data: { structure: body } }),
    ),
    http.get('/api/student/progress', () =>
      progressPending
        ? new Promise<never>(() => undefined)
        : HttpResponse.json({ ok: true, data: { progress: { ...progressView(lastViewedLessonId), resume } } }),
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

const anonOffer = {
  description: 'Start from zero.', imageUrl: null, salesUrl: null, supportUrl: null,
  product: { id: 'prod-advanced', priceCents: 19900, currency: 'PLN', interval: null },
} satisfies NonNullable<CourseStructureWithAccess['offer']>;

const anonCoursePage = (imageUrl: string | null, offer: NonNullable<CourseStructureWithAccess['offer']> = anonOffer) => {
  server.use(
    anonMe(),
    http.get('/api/public/courses/:courseId/structure', () =>
      HttpResponse.json({ ok: true, data: { structure: {
        ...structure, offer: { ...offer, imageUrl },
        modules: structure.modules.map((module) => ({ ...module, chapters: module.chapters.map((chapter) => ({
          ...chapter, lessons: chapter.lessons.map((lesson) => ({ ...lesson, isPreview: lesson.lessonId === 'l1' })),
        })) })),
      } } }),
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
                imageUrl,
              },
            ],
            lockedSpaces: [],
          },
        },
      }),
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

const lengthPx = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const match = /^([\d.]+)(px|rem)$/u.exec(value.trim());
  const amount = match?.[1];
  const unit = match?.[2];
  if (amount === undefined || unit === undefined) return null;
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  return unit === 'rem' ? numeric * 16 : numeric;
};

const constrainedWidth = (
  element: Element,
  viewportWidth: number,
  columnWidth: number,
): number => {
  let width = columnWidth;
  let current: Element | null = element;
  while (current !== null && current !== document.documentElement) {
    const maxWidth = lengthPx(stylesAt(current, viewportWidth)['max-width']);
    if (maxWidth !== null) width = Math.min(width, maxWidth);
    current = current.parentElement;
  }
  return width;
};

describe('CourseStructurePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('orders compact course sections before the curriculum', async () => {
    stubViewport(true);
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const progressCard = await screen.findByTestId('course-progress-card');
    const aboutCard = screen.getByTestId('course-about-card');
    const discussionSearch = screen.getByTestId('course-discussion-search');
    const inlineProgram = screen.getByTestId('course-tree-inline');
    const compactOrder = [progressCard, aboutCard, discussionSearch, inlineProgram]
      .map((element) => [...document.body.querySelectorAll('*')].indexOf(element));

    expect(compactOrder).toEqual([...compactOrder].sort((left, right) => left - right));
    expect(inlineProgram).toHaveStyle({ marginTop: '1.5rem' });
    expect(screen.getAllByTestId('course-progress-card')).toHaveLength(1);
    expect(within(inlineProgram).getByTestId('course-tree')).toBeInTheDocument();
    expect(within(inlineProgram).getByRole('heading', { level: 2, name: en.courseOverview.curriculum })).toBeInTheDocument();
    expect(screen.getAllByTestId('course-tree')).toHaveLength(1);
    expect(within(inlineProgram).getByTestId('lesson-search')).toBeInTheDocument();
    expect(within(inlineProgram).getByTestId('module-toggle-m2')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Closures Deep Dive')).not.toBeInTheDocument();
  });

  it('opens the small-screen program on the branch of the last viewed lesson', async () => {
    stubViewport(true);
    mockPage({ lastViewedLessonId: 'l4' });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const inlineProgram = await screen.findByTestId('course-tree-inline');

    expect(within(inlineProgram).getByTestId('module-toggle-m2')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(inlineProgram).getByTestId('module-toggle-m1')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(inlineProgram).getByText('Closures Deep Dive')).toBeInTheDocument();
    expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument();
  });

  it('holds the small-screen program closed until the last viewed lesson is known', async () => {
    stubViewport(true);
    mockPage({ progressPending: true });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const inlineProgram = await screen.findByTestId('course-tree-inline');

    expect(within(inlineProgram).getByTestId('module-toggle-m1')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(inlineProgram).getByTestId('module-toggle-m2')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument();
  });

  it('keeps the page at the top instead of scrolling to the small-screen program', async () => {
    stubViewport(true);
    mockPage({ lastViewedLessonId: 'l4' });
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByText('Closures Deep Dive')).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
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

  it('keeps desktop progress and discussion search in the rail', async () => {
    stubViewport(false);
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const leading = await screen.findByTestId('member-rail-leading');
    const trailing = screen.getByTestId('member-rail-trailing');

    expect(within(leading).getByTestId('course-progress-card')).toBeInTheDocument();
    expect(within(trailing).getByTestId('course-discussion-search')).toBeInTheDocument();
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
    expect(screen.getByTestId('stat-tile-duration')).toHaveTextContent(
      en.courseOverview.durationHoursMinutes({ hours: 1, minutes: 0 }),
    );
    expect(screen.queryByTestId('stat-tile-completed')).not.toBeInTheDocument();
    expect(screen.getByTestId('progress-summary')).toHaveTextContent(
      en.courseOverview.completedOf({ done: 1, total: 5 }),
    );
  });

  it('points the continue CTA at the last viewed lesson when it is unfinished', async () => {
    mockPage({ lastViewedLessonId: 'l2' });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const cta = await screen.findByTestId('continue-cta');
    expect(cta).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(cta).toHaveTextContent(en.courseOverview.continueLearning);
    expect(cta).toHaveTextContent('Advanced Variables');
    expect(cta).toHaveAttribute('title', `${en.courseOverview.continueLearning}: Advanced Variables`);
    expect(screen.queryByTestId('first-lesson-link')).not.toBeInTheDocument();
  });

  it('offers the server-provided first incomplete lesson beneath a different resume target', async () => {
    mockPage({ lastViewedLessonId: 'l2', resume: {
      target: { id: 'l2', name: 'Advanced Variables' },
      firstIncomplete: { id: 'l1', name: 'Intro to Variables' }, isReview: false,
    } });
    await renderPage(<CourseStructurePage courseId="course-1" />);
    const link = await screen.findByTestId('first-lesson-link');
    expect(link).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    expect(link).toHaveTextContent(en.courseOverview.firstIncomplete({ name: 'Intro to Variables' }));
  });

  it('skips a completed last-viewed lesson and targets the first unfinished one', async () => {
    mockPage({ lastViewedLessonId: 'l1' });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const cta = await screen.findByTestId('continue-cta');
    expect(cta).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(cta).toHaveTextContent(en.courseOverview.continueLearning);
    expect(screen.queryByTestId('first-lesson-link')).not.toBeInTheDocument();
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
    mockPage({ body: completed, lastViewedLessonId: 'l2', resume: {
      target: { id: 'l2', name: 'Advanced Variables' }, firstIncomplete: null, isReview: true,
    } });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const cta = await screen.findByTestId('continue-cta');
    expect(cta).toHaveTextContent(en.courseOverview.reviewAgain);
    expect(cta).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    const card = screen.getByTestId('course-progress-card');
    expect(within(card).getByTestId('completion-mark')).toHaveAccessibleName(
      en.courseOverview.courseCompleted,
    );
    expect(within(card).getByTestId('progress-percent')).toHaveTextContent('100%');
    expect(screen.queryByTestId('course-completed-note')).not.toBeInTheDocument();
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
    mockPage({ body: locked, resume: { target: null, firstIncomplete: null, isReview: false } });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    await screen.findByTestId('course-progress-card');
    expect(screen.queryByTestId('continue-cta')).not.toBeInTheDocument();
  });

  it('shows a friendly empty state for a course without modules', async () => {
    mockPage({ body: { ...structure, modules: [] } });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const empty = await screen.findByTestId('course-empty-state');
    expect(within(empty).getByTestId('empty-course-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(en.courseTree.emptyCourseTitle);
    expect(empty).toHaveTextContent(en.courseTree.noPublishedContent);
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

    expect(await screen.findByRole('heading', { level: 1, name: en.courseTree.courseNotFound })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: en.courseTree.courseNotFound })).toHaveLength(1);
    expect(screen.getByText(en.courseTree.courseNotInLibrary)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.courseTree.backToMyCourses })).toHaveAttribute('href', '/my');
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument();
  });

  it('serves an anonymous visitor the public program without progress or discussion', async () => {
    anonCoursePage(null);

    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByTestId('anon-course-program')).toHaveTextContent(
      en.anon.lockedCourseHint,
    );
    expect(screen.getByTestId('course-tree')).toBeInTheDocument();
    expect(screen.getByTestId('module-toggle-m2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Closures Deep Dive')).not.toBeInTheDocument();
    expect(screen.getByTestId('stat-tile-lessons')).toHaveTextContent('5');
    expect(screen.queryByTestId('stat-tile-completed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-progress-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-discussion-search')).not.toBeInTheDocument();
    for (const testId of ['public-course-unlock-cta', 'public-course-unlock-cta-mobile']) {
      expect(screen.getByTestId(testId)).toHaveAttribute('href', '/checkout/prod-advanced');
    }
    expect(screen.getByTestId('member-breadcrumbs')).toHaveTextContent(en.shell.start);
  });

  it('crops the anonymous cover exactly like the member cover', async () => {
    mockPage();
    const member = await renderPage(<CourseStructurePage courseId="course-1" />);
    const memberStyles = stylesAt(await screen.findByTestId('course-cover'), 1440);
    member.unmount();

    anonCoursePage('https://picsum.photos/seed/js/960/540');
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const anonStyles = stylesAt(await screen.findByTestId('course-cover'), 1440);
    expect(anonStyles).toEqual(memberStyles);
    expect(anonStyles).toMatchObject({
      'aspect-ratio': '16/9',
      'object-fit': 'cover',
      width: '100%',
    });
    expect(anonStyles['max-height']).toBeUndefined();
  });

  it('keeps the full guest description readable below the offer', async () => {
    const description = 'Learn the fundamentals through practical exercises. Build a complete project, explore advanced techniques, and apply everything in a final workshop.';
    anonCoursePage(null, { ...anonOffer, description });
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const about = await screen.findByTestId('course-about-card');
    expect(about).toHaveTextContent(en.courseOverview.aboutCourse);
    const text = within(about).getByText(description);
    for (const width of [390, 1440]) {
      expect(stylesAt(text, width)['white-space']).not.toBe('nowrap');
      expect(stylesAt(text, width)['overflow']).not.toBe('hidden');
      expect(stylesAt(text, width)['-webkit-line-clamp']).toBeUndefined();
    }
    expect(screen.getByTestId('guest-course-offer').compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the member course cover and about card on the same column width', async () => {
    mockPage();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const cover = await screen.findByTestId('course-cover');
    const about = screen.getByTestId('course-about-card');
    for (const columnWidth of [820, 375]) {
      expect(constrainedWidth(cover, columnWidth, columnWidth)).toBe(
        constrainedWidth(about, columnWidth, columnWidth),
      );
    }
  });

  it('shows a cover fallback when the anonymous course has no cover', async () => {
    anonCoursePage(null);

    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(await screen.findByTestId('course-cover-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('course-cover')).not.toBeInTheDocument();
  });
  it.each([
    { name: 'product before sales URL', product: anonOffer.product, salesUrl: 'https://courses.example.org/offer', supportUrl: 'https://courses.example.org/contact', href: '/checkout/prod-advanced', label: en.anon.unlockCta, contact: false },
    { name: 'sales URL without product', product: null, salesUrl: 'https://courses.example.org/offer', supportUrl: 'https://courses.example.org/contact', href: 'https://courses.example.org/offer', label: en.anon.salesCta, contact: false },
    { name: 'login and contact', product: null, salesUrl: null, supportUrl: 'https://courses.example.org/contact', href: '/login', label: en.auth.signInLink, contact: true },
    { name: 'login without contact', product: null, salesUrl: null, supportUrl: null, href: '/login', label: en.auth.signInLink, contact: false },
  ])('resolves $name', async ({ product, salesUrl, supportUrl, href, label, contact }) => {
    anonCoursePage(null, { ...anonOffer, product, salesUrl, supportUrl });
    await renderPage(<CourseStructurePage courseId="course-1" />);
    for (const id of ['public-course-unlock-cta', 'public-course-unlock-cta-mobile']) {
      expect(await screen.findByTestId(id)).toHaveAttribute('href', href);
      expect(screen.getByTestId(id)).toHaveTextContent(label);
    }
    const contactLink = screen.queryByRole('link', { name: en.anon.contactCreator });
    if (contact) {
      expect(contactLink).toHaveAttribute('href', supportUrl);
      if (contactLink === null) throw new Error('Expected public contact link');
      for (const width of [390, 1440]) {
        expect(stylesAt(contactLink, width)['min-height']).toBe('44px');
      }
    } else expect(contactLink).not.toBeInTheDocument();
  });

  it('opens only preview rows after expanding a guest module', async () => {
    anonCoursePage(null);
    await renderPage(<CourseStructurePage courseId="course-1" />);
    const user = userEvent.setup();
    const module = await screen.findByTestId('module-toggle-m1');
    expect(module).toHaveAttribute('aria-expanded', 'false');
    expect(module).toHaveTextContent(`3 ${en.courseOverview.statLessons({ count: 3 })}`);
    await user.click(module);
    expect(await screen.findByTestId('chapter-toggle-c1')).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('lesson-button-l1')).toHaveTextContent(en.anon.previewChip);
    expect(screen.getByTestId('lesson-button-l1')).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    expect(screen.getByTestId('lesson-button-l2')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('lesson-button-l2')).not.toHaveAttribute('href');
    expect(screen.queryByTestId('unlock-lesson-l2')).not.toBeInTheDocument();
  });

  it.each(['month', 'year'] as const)('shows the %s cadence on the offer and mobile bar', async (interval) => {
    anonCoursePage(null, { ...anonOffer, product: { ...anonOffer.product, interval } });
    await renderPage(<CourseStructurePage courseId="course-1" />);
    const price = await screen.findByTestId('guest-course-price');
    expect(price).toHaveTextContent(interval === 'month' ? en.anon.monthlyPrice({ price: '' }).trim() : en.anon.yearlyPrice({ price: '' }).trim());
    expect(screen.getByTestId('guest-course-sticky-offer')).toHaveTextContent((price.textContent ?? '').replaceAll('\u00a0', ' '));
  });

});
