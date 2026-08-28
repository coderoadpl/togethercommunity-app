import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { CourseTree } from './CourseTree.js';

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

const renderTree = async (body: CourseStructureWithAccess = structure) => {
  const rootRoute = createRootRoute({
    component: () => <CourseTree courseId="course-1" structure={body} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('CourseTree', () => {
  it('renders every node as a teaser regardless of access', async () => {
    await renderTree();

    expect(await screen.findByText('01 - Fundamentals')).toBeInTheDocument();
    expect(screen.getByText('02 - Advanced')).toBeInTheDocument();
    expect(screen.getByText('Locked chapter')).toBeInTheDocument();
    expect(screen.getByText('Closures Deep Dive')).toBeInTheDocument();
  });

  it('does not render modules or chapters without lessons', async () => {
    await renderTree({
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
    });

    expect(await screen.findByText('01 - Fundamentals')).toBeInTheDocument();
    expect(screen.queryByText('Empty module')).not.toBeInTheDocument();
    expect(screen.queryByText('Module with empty chapter')).not.toBeInTheDocument();
    expect(screen.queryByText('Empty chapter')).not.toBeInTheDocument();
  });

  it('decorates the three access states with the right icons and disabled behavior', async () => {
    await renderTree();

    const accessible = await screen.findByTestId('lesson-button-l1');
    expect(accessible.tagName).toBe('A');
    expect(accessible).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    expect(within(accessible).queryByTestId('lock-closed')).not.toBeInTheDocument();
    expect(within(accessible).queryByTestId('lock-open')).not.toBeInTheDocument();

    const partial = screen.getByTestId('lesson-button-l3');
    expect(partial.tagName).toBe('A');
    expect(within(partial).getByTestId('lock-open')).toBeInTheDocument();
    expect(within(partial).getByText(pl.courseTree.accessPartiallyUnlocked)).toBeInTheDocument();

    const locked = screen.getByTestId('lesson-button-l4');
    expect(locked.tagName).not.toBe('A');
    expect(locked).toHaveClass('Mui-disabled');
    expect(within(locked).getByTestId('lock-closed')).toBeInTheDocument();
    expect(within(locked).getByText(pl.courseTree.accessLocked)).toBeInTheDocument();
  });

  it('shows completion checkmarks per lesson, chapter and module', async () => {
    await renderTree();

    const completedLesson = await screen.findByTestId('lesson-button-l1');
    expect(within(completedLesson).getByTestId('completion-full')).toBeInTheDocument();
    expect(within(completedLesson).getByText(pl.courseTree.completionComplete)).toBeInTheDocument();

    const module = screen.getByTestId('module-toggle-m1');
    expect(within(module).getByTestId('completion-partial')).toBeInTheDocument();
    expect(within(module).getByText(pl.courseTree.completionPartial)).toBeInTheDocument();

    const chapter = screen.getByTestId('chapter-toggle-c1');
    expect(within(chapter).getByTestId('completion-partial')).toBeInTheDocument();
  });

  it('exposes module disclosure state and toggles it from the keyboard', async () => {
    const user = userEvent.setup();
    await renderTree();

    expect(await screen.findByText('Intro to Variables')).toBeInTheDocument();
    const toggle = screen.getByTestId('module-toggle-m1');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const disclosure = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(disclosure).toContainElement(screen.getByText('Intro to Variables'));
    toggle.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument());
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(await screen.findByText('Intro to Variables')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('filters to matching lessons, auto-expands and highlights the match', async () => {
    const user = userEvent.setup();
    const { container } = await renderTree();

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
    await renderTree();

    const timed = await screen.findByTestId('lesson-duration-l1');
    expect(timed).toHaveTextContent('12 min');
    expect(screen.getByTestId('lesson-duration-l4')).toHaveTextContent('30 min');
    expect(screen.queryByTestId('lesson-duration-l3')).not.toBeInTheDocument();
  });

  it('offers an unlock link only for locked lessons covered by a product', async () => {
    await renderTree();

    const unlock = await screen.findByTestId('unlock-lesson-l4');
    expect(unlock).toHaveAttribute('href', '/checkout/prod-advanced');
    expect(unlock).toHaveTextContent(pl.courseTree.unlockAccess);
    expect(screen.queryByTestId('unlock-lesson-l5')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlock-lesson-l1')).not.toBeInTheDocument();
  });
});
