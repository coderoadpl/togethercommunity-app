import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

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
  ],
};

const okStructure = () =>
  http.get('/api/student/courses/:courseId/structure', () =>
    HttpResponse.json({ ok: true, data: { structure } }),
  );

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
        variant="drawer"
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
    server.use(okStructure(), okNavigation(), noNotifications());

    await renderSidebar(null);

    const header = await screen.findByTestId('course-sidebar-header');
    const back = screen.getByTestId('course-sidebar-back');
    expect(back).toHaveAttribute('href', memberHomePath());
    expect(back).toHaveTextContent(pl.shell.backTo({ name: 'Acme' }));

    expect(header).toHaveTextContent('JavaScript Foundations');
    expect(within(header).getByTestId('progress-ring')).toHaveAttribute('data-done', 'false');
    expect(screen.getByTestId('course-sidebar-totals')).toHaveTextContent(
      `50% · ${pl.shell.lessonsOf({ done: 1, total: 2 })}`,
    );
  });

  it('marks the course overview as the current page on the overview route', async () => {
    server.use(okStructure(), okNavigation(), noNotifications());

    await renderSidebar(null);

    const overview = await screen.findByTestId('course-sidebar-overview');
    expect(overview).toHaveAttribute('href', '/my/courses/course-1');
    expect(overview).toHaveAttribute('aria-current', 'page');
    expect(overview).toHaveTextContent(pl.shell.courseOverviewEntry);
  });

  it('highlights the open lesson in the program instead of the overview', async () => {
    server.use(okStructure(), okNavigation(), noNotifications());

    await renderSidebar('l2');

    const program = await screen.findByTestId('course-tree');
    expect(within(program).getByTestId('lesson-button-l2')).toHaveClass('Mui-selected');
    expect(within(program).getByTestId('lesson-button-l1')).not.toHaveClass('Mui-selected');
    expect(screen.getByTestId('course-sidebar-overview')).not.toHaveAttribute('aria-current');
  });

  it('keeps notifications and the account within reach while the course owns the bar', async () => {
    server.use(okStructure(), okNavigation(), noNotifications());

    await renderSidebar('l2');

    expect(await screen.findByText(pl.notifications.bell)).toBeInTheDocument();
    expect(screen.getByTestId('course-sidebar-account')).toHaveAttribute('href', '/account');
  });

  it('links to the space of the course below the overview entry', async () => {
    server.use(
      okStructure(),
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
      okNavigation(),
      noNotifications(),
    );

    await renderSidebar(null);

    expect(await screen.findByRole('button', { name: pl.common.retry })).toBeInTheDocument();
    expect(screen.queryByTestId('course-tree')).not.toBeInTheDocument();
  });
});
