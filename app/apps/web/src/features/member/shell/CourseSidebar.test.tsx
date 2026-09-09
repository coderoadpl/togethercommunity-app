import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { CourseStructureWithAccess, MemberNavigation } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { CourseSidebar } from './CourseSidebar.js';
import { memberHomePath } from './member-nav.js';

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
              completionStatus: 'fully-completed',
            },
            {
              contentId: 'ct2',
              lessonId: 'l2',
              name: 'Advanced Variables',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
            },
          ],
        },
      ],
    },
    {
      id: 'm2',
      name: '02 - Functions',
      accessStatus: 'fully-accessible',
      completionStatus: 'not-completed',
      chapters: [
        {
          id: 'c2',
          name: 'Declaring functions',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [
            {
              contentId: 'ct3',
              lessonId: 'l3',
              name: 'Arrow Functions',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
            },
          ],
        },
      ],
    },
  ],
};

const okStructure = (body: CourseStructureWithAccess = structure) =>
  http.get('/api/student/courses/:courseId/structure', () =>
    HttpResponse.json({ ok: true, data: { structure: body } }),
  );

const okProgress = (lastViewedLessonId?: string) =>
  http.get('/api/student/progress', () =>
    HttpResponse.json({
      ok: true,
      data: {
        progress: {
          courseId: 'course-1',
          completedLessonIds: ['l1'],
          ...(lastViewedLessonId === undefined ? {} : { lastViewedLessonId }),
        },
      },
    }),
  );

const pendingProgress = () =>
  http.get('/api/student/progress', () => new Promise<never>(() => undefined));

const spaceEntry = (
  id: string,
  name: string,
  courseIds: string[],
): MemberNavigation['spaces'][number] => ({
  id,
  slug: id,
  name,
  visibility: 'product',
  position: 0,
  isFollowing: false,
  unread: false,
  courseIds,
});

const okNavigation = (spaces: MemberNavigation['spaces'] = []) =>
  http.get('/api/member/navigation', () =>
    HttpResponse.json({
      ok: true,
      data: { navigation: { spaces, courses: [], lockedSpaces: [] } },
    }),
  );

const noNotifications = () =>
  http.get('/api/notifications/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread: 0 } }));

const renderSidebar = async (currentLessonId: string | null) => {
  const rootRoute = createRootRoute({
    component: () => (
      <CourseSidebar
        courseId="course-1"
        currentLessonId={currentLessonId}
        tenantName="Acme"
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({
      initialEntries: [
        currentLessonId === null
          ? '/my/courses/course-1'
          : `/my/courses/course-1/lessons/${currentLessonId}`,
      ],
    }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('CourseSidebar', () => {
  it('leads with a way back home and the course progress header', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());

    await renderSidebar(null);

    const header = await screen.findByTestId('course-sidebar-header');
    const back = screen.getByTestId('course-sidebar-back');
    expect(back).toHaveAttribute('href', memberHomePath());
    expect(back).toHaveTextContent(pl.shell.backTo({ name: 'Acme' }));

    expect(header).toHaveTextContent('JavaScript Foundations');
    expect(within(header).queryByTestId('completion-mark')).not.toBeInTheDocument();
    expect(screen.getByTestId('course-sidebar-totals')).toHaveTextContent(
      `33% · ${pl.shell.lessonsOf({ done: 1, total: 3 })}`,
    );
  });

  it('marks a finished course to the right of its title, without a text label', async () => {
    const finished: CourseStructureWithAccess = {
      ...structure,
      completionStatus: 'fully-completed',
      modules: structure.modules.map((module) => ({
        ...module,
        completionStatus: 'fully-completed',
        chapters: module.chapters.map((chapter) => ({
          ...chapter,
          completionStatus: 'fully-completed',
          lessons: chapter.lessons.map((lesson) => ({
            ...lesson,
            completionStatus: 'fully-completed',
          })),
        })),
      })),
    };
    server.use(okStructure(finished), okProgress(), okNavigation(), noNotifications());

    await renderSidebar(null);

    const header = await screen.findByTestId('course-sidebar-header');
    const mark = within(header).getByTestId('completion-mark');
    expect(mark).toHaveAccessibleName(pl.courseOverview.courseCompleted);
    const title = within(header).getByText('JavaScript Foundations');
    expect(title.compareDocumentPosition(mark)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('marks the course overview as the current page on the overview route', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());

    await renderSidebar(null);

    const overview = await screen.findByTestId('course-sidebar-overview');
    expect(overview).toHaveAttribute('href', '/my/courses/course-1');
    expect(overview).toHaveAttribute('aria-current', 'page');
    expect(overview).toHaveTextContent(pl.shell.courseOverviewEntry);
  });

  it('highlights the open lesson in the program instead of the overview', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());

    await renderSidebar('l2');

    const program = await screen.findByTestId('course-tree');
    expect(within(program).getByTestId('lesson-button-l2')).toHaveClass('Mui-selected');
    expect(within(program).getByTestId('lesson-button-l1')).not.toHaveClass('Mui-selected');
    expect(screen.getByTestId('course-sidebar-overview')).not.toHaveAttribute('aria-current');
  });

  it('opens only the branch of the lesson being played', async () => {
    server.use(okStructure(), okProgress('l3'), okNavigation(), noNotifications());

    await renderSidebar('l2');

    expect(await screen.findByTestId('lesson-button-l2')).toBeInTheDocument();
    expect(screen.getByTestId('module-toggle-m1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('module-toggle-m2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('lesson-button-l3')).not.toBeInTheDocument();
  });

  it('opens the branch of the last viewed lesson on the course overview', async () => {
    server.use(okStructure(), okProgress('l3'), okNavigation(), noNotifications());

    await renderSidebar(null);

    expect(await screen.findByTestId('lesson-button-l3')).toBeInTheDocument();
    expect(screen.getByTestId('module-toggle-m2')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('module-toggle-m1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('lesson-button-l1')).not.toBeInTheDocument();
  });

  it('opens the branch of the first lesson when nothing was viewed yet', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());

    await renderSidebar(null);

    expect(await screen.findByTestId('lesson-button-l1')).toBeInTheDocument();
    expect(screen.getByTestId('module-toggle-m1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('module-toggle-m2')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a deep-linked lesson branch without waiting for the progress query', async () => {
    server.use(okStructure(), pendingProgress(), okNavigation(), noNotifications());

    await renderSidebar('l3');

    expect(await screen.findByTestId('lesson-button-l3')).toBeInTheDocument();
    expect(screen.getByTestId('module-toggle-m2')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('module-toggle-m1')).toHaveAttribute('aria-expanded', 'false');
  });

  it('holds every module closed on the overview until the last viewed lesson is known', async () => {
    server.use(okStructure(), pendingProgress(), okNavigation(), noNotifications());

    await renderSidebar(null);

    expect(await screen.findByTestId('module-toggle-m1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('module-toggle-m2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('lesson-button-l1')).not.toBeInTheDocument();
  });

  it('scrolls the program to the lesson being played', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    await renderSidebar('l3');

    const current = await screen.findByTestId('lesson-button-l3');
    expect(scrollIntoView.mock.instances).toEqual([current]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    scrollIntoView.mockRestore();
  });

  it('does not scroll the active lesson when it is already visible with padding', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-course-tree-scroll') ? 400 : 44;
      },
    });
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      if (this.hasAttribute('data-course-tree-scroll')) return new DOMRect(0, 0, 320, 400);
      if (this.getAttribute('data-testid') === 'module-toggle-m2') return new DOMRect(0, 60, 320, 44);
      if (this.getAttribute('data-testid') === 'lesson-button-l3') return new DOMRect(0, 120, 320, 44);
      return new DOMRect(0, 0, 320, 44);
    });
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    try {
      await renderSidebar('l3');

      expect(await screen.findByTestId('lesson-button-l3')).toBeInTheDocument();
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      scrollIntoView.mockRestore();
      rects.mockRestore();
      if (originalClientHeight === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
      } else {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      }
    }
  });

  it('scrolls when the active lesson is half cut off inside the tree scroller', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-course-tree-scroll') ? 400 : 44;
      },
    });
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      if (this.hasAttribute('data-course-tree-scroll')) return new DOMRect(0, 0, 320, 400);
      if (this.getAttribute('data-testid') === 'module-toggle-m2') return new DOMRect(0, 120, 320, 44);
      if (this.getAttribute('data-testid') === 'lesson-button-l3') return new DOMRect(0, 396, 320, 44);
      return new DOMRect(0, 120, 320, 44);
    });
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    try {
      await renderSidebar('l3');

      const current = await screen.findByTestId('lesson-button-l3');
      expect(scrollIntoView.mock.instances).toEqual([current]);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    } finally {
      scrollIntoView.mockRestore();
      rects.mockRestore();
      if (originalClientHeight === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
      } else {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      }
    }
  });

  it('scrolls when the active lesson is covered by the sticky module header', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-course-tree-scroll') ? 400 : 44;
      },
    });
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      if (this.hasAttribute('data-course-tree-scroll')) return new DOMRect(0, 0, 320, 400);
      if (this.getAttribute('data-testid') === 'module-toggle-m2') return new DOMRect(0, 8, 320, 46);
      if (this.getAttribute('data-testid') === 'lesson-button-l3') return new DOMRect(0, 40, 320, 44);
      return new DOMRect(0, 0, 320, 44);
    });
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    try {
      await renderSidebar('l3');

      const current = await screen.findByTestId('lesson-button-l3');
      expect(scrollIntoView.mock.instances).toEqual([current]);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    } finally {
      scrollIntoView.mockRestore();
      rects.mockRestore();
      if (originalClientHeight === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
      } else {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      }
    }
  });

  it('scrolls the module list alone, with the header and filter pinned above it', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());

    await renderSidebar('l1');

    const scroller = await screen.findByTestId('course-tree-scroll');
    expect(scroller).toContainElement(screen.getByTestId('course-tree'));
    expect(scroller).not.toContainElement(screen.getByTestId('course-sidebar-pinned'));
    expect(scroller).not.toContainElement(screen.getByTestId('lesson-search'));
    expect(scroller).not.toContainElement(screen.getByTestId('course-sidebar-back'));
  });

  it('ends with the lesson tree, leaving notifications and the account to the app bar', async () => {
    server.use(okStructure(), okProgress(), okNavigation(), noNotifications());

    const { container } = await renderSidebar('l2');

    expect(await screen.findByTestId('course-tree')).toBeInTheDocument();
    expect(screen.queryByText(pl.notifications.bell)).toBeNull();
    expect(screen.queryByText(pl.account.menuAccount)).toBeNull();
    expect(screen.queryByTestId('course-sidebar-account')).toBeNull();
    expect(screen.queryByTestId('member-identity')).toBeNull();
    expect(container.querySelectorAll('a[href="/account"]')).toHaveLength(0);
    expect(container.querySelectorAll('a[href="/notifications"]')).toHaveLength(0);
  });

  it('links to the space of the course below the overview entry', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okNavigation([spaceEntry('s1', 'Kurs JS', ['course-1'])]),
      noNotifications(),
    );

    await renderSidebar('l2');

    const spaceRow = await screen.findByTestId('course-sidebar-space-s1');
    expect(spaceRow).toHaveAttribute('href', '/community/s1');
    expect(spaceRow).toHaveTextContent(pl.shell.courseSpaceEntry);
    expect(screen.getByTestId('course-sidebar-overview').nextElementSibling).toBe(spaceRow);
  });

  it('names each space when the course has more than one', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okNavigation([
        spaceEntry('s1', 'Kurs JS', ['course-1']),
        spaceEntry('s2', 'Zadania JS', ['course-1']),
      ]),
      noNotifications(),
    );

    await renderSidebar(null);

    expect(await screen.findByTestId('course-sidebar-space-s1')).toHaveTextContent('Kurs JS');
    expect(screen.getByTestId('course-sidebar-space-s2')).toHaveTextContent('Zadania JS');
  });

  it('links to a space shared with another course as well', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okNavigation([spaceEntry('s1', 'Kurs JS', ['course-1', 'course-2'])]),
      noNotifications(),
    );

    await renderSidebar(null);

    expect(await screen.findByTestId('course-sidebar-space-s1')).toHaveAttribute(
      'href',
      '/community/s1',
    );
  });

  it('hides the space entry when no space belongs to the course', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okNavigation([spaceEntry('s1', 'Inny kurs', ['course-9'])]),
      noNotifications(),
    );

    await renderSidebar(null);

    expect(await screen.findByTestId('course-sidebar-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('course-sidebar-space-s1')).not.toBeInTheDocument();
    expect(screen.queryByText(pl.shell.courseSpaceEntry)).not.toBeInTheDocument();
  });

  it('offers a retry when the course structure fails to load', async () => {
    server.use(
      http.get('/api/student/courses/:courseId/structure', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'internal', message: 'boom' } },
          { status: 500 },
        ),
      ),
      okProgress(),
      okNavigation(),
      noNotifications(),
    );

    await renderSidebar(null);

    expect(await screen.findByRole('button', { name: pl.common.retry })).toBeInTheDocument();
    expect(screen.queryByTestId('course-tree')).not.toBeInTheDocument();
  });
});
