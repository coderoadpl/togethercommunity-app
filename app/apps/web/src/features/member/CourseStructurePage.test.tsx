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

import type { CourseStructureWithAccess } from '@core/domain/index.js';

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
            },
          ],
        },
      ],
    },
  ],
};

const mockStructure = (body: CourseStructureWithAccess = structure) => {
  server.use(
    http.get('/api/student/courses/:courseId/structure', () =>
      HttpResponse.json({ ok: true, data: { structure: body } }),
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
    mockStructure();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByRole('heading', { name: 'JavaScript Foundations' })).toBeInTheDocument();
    expect(screen.getByText('01 - Fundamentals')).toBeInTheDocument();
    expect(screen.getByText('02 - Advanced')).toBeInTheDocument();
    expect(screen.getByText('Locked chapter')).toBeInTheDocument();
    expect(screen.getByText('Closures Deep Dive')).toBeInTheDocument();
  });

  it('decorates the three access states with the right icons and disabled behavior', async () => {
    mockStructure();
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
    mockStructure();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    const completedLesson = await screen.findByTestId('lesson-button-l1');
    expect(within(completedLesson).getByTestId('completion-full')).toBeInTheDocument();

    const module = screen.getByTestId('module-toggle-m1');
    expect(within(module).getByTestId('completion-partial')).toBeInTheDocument();

    const chapter = screen.getByTestId('chapter-toggle-c1');
    expect(within(chapter).getByTestId('completion-partial')).toBeInTheDocument();
  });

  it('collapses a module when its header is clicked', async () => {
    mockStructure();
    const user = userEvent.setup();
    await renderPage(<CourseStructurePage courseId="course-1" />);

    expect(await screen.findByText('Intro to Variables')).toBeInTheDocument();
    await user.click(screen.getByTestId('module-toggle-m1'));
    await waitFor(() => expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument());
  });

  it('filters to matching lessons, auto-expands and highlights the match', async () => {
    mockStructure();
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

  it('shows a not-found state for a course outside the library', async () => {
    server.use(
      http.get('/api/student/courses/:courseId/structure', () =>
        HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Not found' } }, { status: 404 }),
      ),
    );
    await renderPage(<CourseStructurePage courseId="course-9" />);

    expect(await screen.findByRole('heading', { name: 'Course not found' })).toBeInTheDocument();
  });
});
