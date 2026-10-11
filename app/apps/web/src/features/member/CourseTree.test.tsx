import type { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createThemeForMode } from '../../theme.js';
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

const renderNode = async (node: ReactNode) => {
  const rootRoute = createRootRoute({ component: () => node });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1'] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

const renderTree = async (body: CourseStructureWithAccess = structure) =>
  renderNode(<CourseTree courseId="course-1" structure={body} expandAll />);

const renderFocusedTree = async (focusLessonId: string | null) =>
  renderNode(
    <CourseTree
      courseId="course-1"
      structure={structure}
      focusLessonId={focusLessonId}
      scrollFocusIntoView
    />,
  );

const renderCollapsedTree = async () =>
  renderNode(<CourseTree courseId="course-1" structure={structure} focusLessonId="l1" />);

const treeItem = (testId: string) => {
  const item = screen.getByTestId(testId).closest('[role="treeitem"]');
  if (!(item instanceof HTMLElement)) throw new Error(`Missing tree item for ${testId}`);
  return item;
};

describe('CourseTree', () => {
  it('renders every node as a teaser regardless of access', async () => {
    await renderTree();

    expect(await screen.findByText('01 - Fundamentals')).toBeInTheDocument();
    expect(screen.getByText('02 - Advanced')).toBeInTheDocument();
    expect(screen.getByText('Preview chapter')).toBeInTheDocument();
    expect(screen.getByText('Closures Deep Dive')).toBeInTheDocument();
  });

  it('flattens a single chapter while preserving lesson order and module counts', async () => {
    await renderTree({
      ...structure,
      modules: structure.modules.slice(0, 1).map((module) => ({
        ...module,
        chapters: module.chapters.slice(0, 1),
      })),
    });

    expect(screen.queryByText('Getting started')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chapter-toggle-c1')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('module-toggle-m1')).getByText('1/2')).toBeInTheDocument();
    const lessons = within(treeItem('module-toggle-m1')).getAllByRole('treeitem');
    expect(lessons).toHaveLength(2);
    expect(lessons[0]).toContainElement(screen.getByTestId('lesson-button-l1'));
    expect(lessons[1]).toContainElement(screen.getByTestId('lesson-button-l2'));
  });

  it('keeps both chapter rows for a module with two chapters', async () => {
    await renderTree();

    expect(treeItem('chapter-toggle-c1')).toContainElement(screen.getByTestId('lesson-button-l1'));
    expect(treeItem('chapter-toggle-c2')).toContainElement(screen.getByTestId('lesson-button-l3'));
    expect(treeItem('module-toggle-m1')).toContainElement(screen.getByTestId('chapter-toggle-c1'));
    expect(treeItem('module-toggle-m1')).toContainElement(screen.getByTestId('chapter-toggle-c2'));
  });

  it('supports repeated lesson placements with unique items and route-driven selection', async () => {
    const user = userEvent.setup();
    await renderNode(
      <CourseTree
        courseId="course-1"
        structure={{
          ...structure,
          modules: structure.modules.map((module) => ({
            ...module,
            chapters: module.chapters.map((chapter) => ({
              ...chapter,
              lessons: chapter.lessons.map((lesson) => lesson.lessonId === 'l3'
                ? { ...lesson, lessonId: 'l1', name: 'Intro revisited' }
                : lesson),
            })),
          })),
        }}
        currentLessonId="l1"
        expandAll
      />,
    );

    const placements = screen.getAllByTestId('lesson-button-l1');
    expect(placements).toHaveLength(2);
    const items = placements.map((placement) => placement.closest('[role="treeitem"]'));
    expect(new Set(items.map((item) => item?.id)).size).toBe(2);
    for (const placement of placements) {
      expect(placement).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
      expect(placement.closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true');
    }
    treeItem('lesson-button-l2').focus();
    await user.keyboard(' ');
    expect(treeItem('lesson-button-l2')).toHaveAttribute('aria-selected', 'false');
    for (const item of items) expect(item).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(items[1]).toHaveFocus();
  });

  it('names each tree item from its own title, progress, duration and status marks', async () => {
    await renderTree({
      ...structure,
      modules: structure.modules.map((module) => ({
        ...module,
        chapters: module.chapters.map((chapter) => ({
          ...chapter,
          lessons: chapter.lessons.map((lesson) => lesson.lessonId === 'l3'
            ? { ...lesson, completionStatus: 'partially-completed' }
            : lesson),
        })),
      })),
    });

    expect(treeItem('module-toggle-m1')).toHaveAccessibleName('01 - Fundamentals 1/3');
    expect(treeItem('chapter-toggle-c1')).toHaveAccessibleName('Getting started 1/2');
    expect(treeItem('chapter-toggle-c2')).toHaveAccessibleName(
      `Preview chapter 0/1 ${en.courseTree.accessPartiallyUnlocked}`,
    );
    expect(treeItem('lesson-button-l1')).toHaveAccessibleName(
      `Intro to Variables 12 min ${en.courseTree.completionComplete}`,
    );
    expect(treeItem('lesson-button-l3')).toHaveAccessibleName(
      `Scope Basics ${en.courseTree.completionPartial} ${en.courseTree.accessPartiallyUnlocked}`,
    );
    expect(treeItem('lesson-button-l4')).toHaveAccessibleName(
      `Closures Deep Dive 30 min ${en.courseTree.accessLocked}`,
    );
  });

  it('keeps the chapter level when a filter leaves one of several chapters visible', async () => {
    const user = userEvent.setup();
    await renderTree();

    await user.type(screen.getByTestId('lesson-search'), 'Scope');

    expect(screen.getByTestId('chapter-toggle-c2')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('chapter-toggle-c1')).not.toBeInTheDocument());
    expect(treeItem('chapter-toggle-c2')).toContainElement(screen.getByTestId('lesson-button-l3'));
    expect(within(screen.getByTestId('module-toggle-m1')).getByText('1/3')).toBeInTheDocument();
  });

  it('opens the focused lesson directly beneath a single-chapter module', async () => {
    await renderFocusedTree('l4');

    expect(await screen.findByTestId('lesson-button-l4')).toBeInTheDocument();
    expect(treeItem('module-toggle-m2')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId('chapter-toggle-c3')).not.toBeInTheDocument();
    expect(treeItem('module-toggle-m1')).toHaveAttribute('aria-expanded', 'false');
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
    expect(within(partial).getByText(en.courseTree.accessPartiallyUnlocked)).toBeInTheDocument();

    const locked = screen.getByTestId('lesson-button-l4');
    expect(locked.tagName).not.toBe('A');
    expect(treeItem('lesson-button-l4')).toHaveAttribute('aria-disabled', 'true');
    expect(within(locked).getByTestId('lock-closed')).toBeInTheDocument();
    expect(within(locked).getByText(en.courseTree.accessLocked)).toBeInTheDocument();
  });

  it('shows a completion checkmark per lesson and a done/total count per chapter and module', async () => {
    await renderTree();

    const completedLesson = await screen.findByTestId('lesson-button-l1');
    expect(within(completedLesson).getByTestId('completion-mark')).toHaveAccessibleName(
      en.courseTree.completionComplete,
    );

    const module = screen.getByTestId('module-toggle-m1');
    expect(within(module).getByText('1/3')).toBeInTheDocument();
    expect(within(module).queryByTestId('completion-partial')).not.toBeInTheDocument();

    const chapter = screen.getByTestId('chapter-toggle-c1');
    expect(within(chapter).getByText('1/2')).toBeInTheDocument();

    const untouchedModule = screen.getByTestId('module-toggle-m2');
    expect(within(untouchedModule).getByText('0/2')).toBeInTheDocument();
  });

  it('stretches the module, chapter and lesson rows across the full sidebar width', async () => {
    await renderTree();

    await screen.findByTestId('lesson-button-l1');
    for (const testId of ['module-toggle-m1', 'chapter-toggle-c1', 'lesson-button-l1']) {
      expect(screen.getByTestId(testId)).toHaveStyle({ width: '100%' });
    }
  });

  it('offsets lesson scroll targets below the sticky module header', async () => {
    await renderTree();

    expect(await screen.findByTestId('lesson-button-l1')).toHaveStyle({
      scrollMarginTop: 'calc(46px + 0.5rem)',
    });
  });

  it('exposes module disclosure state and toggles it from the keyboard', async () => {
    const user = userEvent.setup();
    await renderTree();

    expect(await screen.findByText('Intro to Variables')).toBeInTheDocument();
    const toggle = treeItem('module-toggle-m1');
    expect(toggle).toHaveAttribute('role', 'treeitem');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const disclosure = within(toggle).getAllByRole('group')[0];
    expect(disclosure).toContainElement(screen.getByText('Intro to Variables'));
    toggle.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument());
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(await screen.findByText('Intro to Variables')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves through tree items with arrow keys and follows the lesson link with Enter', async () => {
    const user = userEvent.setup();
    const { router } = await renderTree();

    expect(screen.getByRole('tree')).toBeInTheDocument();
    treeItem('module-toggle-m1').focus();
    await user.keyboard('{ArrowDown}');
    expect(treeItem('chapter-toggle-c1')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(treeItem('lesson-button-l1')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(treeItem('lesson-button-l2')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(treeItem('lesson-button-l1')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(treeItem('chapter-toggle-c1')).toHaveFocus();
    await user.keyboard('{ArrowRight}{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/l1'));
  });

  it.each(['light', 'dark'] as const)('keeps selected row styling inside its box in %s mode', async (scheme) => {
    await renderNode(
      <ThemeProvider theme={createThemeForMode('shadcn', undefined, scheme, 'member')}>
        <CourseTree courseId="course-1" structure={structure} currentLessonId="l1" expandAll />
      </ThemeProvider>,
    );

    expect(treeItem('lesson-button-l1')).toHaveAttribute('aria-selected', 'true');
    for (const testId of ['module-toggle-m1', 'chapter-toggle-c1', 'lesson-button-l1']) {
      const row = screen.getByTestId(testId);
      treeItem(testId).focus();
      await waitFor(() => expect(row).toHaveAttribute('data-focused'));
      const style = getComputedStyle(row);
      expect(style.boxShadow).toContain('inset 0 0 0 2px');
      expect(Number.parseFloat(style.marginTop || '0')).toBeGreaterThanOrEqual(0);
      expect(Number.parseFloat(style.marginBottom || '0')).toBeGreaterThanOrEqual(0);
      expect(style.transform === '' || style.transform === 'none').toBe(true);
      expect(style.boxSizing).toBe('border-box');
    }
  });

  it.each([
    { key: 'Control', modifier: 'ctrlKey' },
    { key: 'Meta', modifier: 'metaKey' },
    { key: 'Shift', modifier: 'shiftKey' },
    { key: 'Alt', modifier: 'altKey' },
  ] as const)('preserves $key when Enter activates a lesson link', async ({ key, modifier }) => {
    const user = userEvent.setup();
    const { router } = await renderTree();
    const activated = vi.fn((event: MouseEvent) => event.preventDefault());
    screen.getByTestId('lesson-button-l1').addEventListener('click', activated);
    treeItem('lesson-button-l1').focus();

    await user.keyboard(`{${key}>}{Enter}{/${key}}`);

    expect(activated).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ [modifier]: true }));
    expect(router.state.location.pathname).toBe('/my/courses/course-1');
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

  it('explains the filter plainly and saves the word-stem tip for an empty result', async () => {
    const user = userEvent.setup();
    await renderTree();

    await screen.findByText('Intro to Variables');
    expect(screen.getByTestId('lesson-search-hint')).toHaveTextContent(en.courseTree.filterHint);
    expect(screen.queryByText(en.search.stemHint)).not.toBeInTheDocument();

    await user.type(screen.getByTestId('lesson-search'), 'nonexistent');

    const empty = await screen.findByTestId('tree-no-results');
    expect(empty).toHaveTextContent(en.courseTree.noMatches);
    expect(empty).toHaveTextContent(en.search.stemHint);
  });

  it('keeps module and chapter counts on the full structure while filtering', async () => {
    const user = userEvent.setup();
    await renderTree();

    await screen.findByText('Intro to Variables');
    await user.type(screen.getByTestId('lesson-search'), 'Intro');

    await waitFor(() =>
      expect(screen.queryByText('Advanced Variables')).not.toBeInTheDocument());

    const module = screen.getByTestId('module-toggle-m1');
    expect(within(module).getByText('1/3')).toBeInTheDocument();
    expect(within(module).queryByTestId('completion-mark')).not.toBeInTheDocument();

    const chapter = screen.getByTestId('chapter-toggle-c1');
    expect(within(chapter).getByText('1/2')).toBeInTheDocument();
    expect(within(chapter).queryByTestId('completion-mark')).not.toBeInTheDocument();
  });

  it('shows per-lesson durations only when present', async () => {
    await renderTree();

    const timed = await screen.findByTestId('lesson-duration-l1');
    expect(timed).toHaveTextContent('12 min');
    expect(screen.getByTestId('lesson-duration-l4')).toHaveTextContent('30 min');
    expect(screen.queryByTestId('lesson-duration-l3')).not.toBeInTheDocument();
  });

  it('opens only the module and chapter of the focused lesson', async () => {
    await renderFocusedTree('l3');

    expect(await screen.findByTestId('lesson-button-l3')).toBeInTheDocument();
    expect(treeItem('module-toggle-m1')).toHaveAttribute('aria-expanded', 'true');
    expect(treeItem('chapter-toggle-c2')).toHaveAttribute('aria-expanded', 'true');
    expect(treeItem('chapter-toggle-c1')).toHaveAttribute('aria-expanded', 'false');
    expect(treeItem('module-toggle-m2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument();
    expect(screen.queryByText('Closures Deep Dive')).not.toBeInTheDocument();
  });

  it('keeps every module closed when there is no lesson to focus', async () => {
    await renderFocusedTree(null);

    await screen.findByTestId('module-toggle-m1');
    expect(treeItem('module-toggle-m1')).toHaveAttribute('aria-expanded', 'false');
    expect(treeItem('module-toggle-m2')).toHaveAttribute('aria-expanded', 'false');
  });

  it('scrolls the focused lesson into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    await renderFocusedTree('l3');

    const focused = await screen.findByTestId('lesson-button-l3');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(scrollIntoView.mock.instances).toEqual([focused]);
    scrollIntoView.mockRestore();
  });

  it('scrolls the focused lesson when the sticky module header covers it', async () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-course-tree-scroll') ? 400 : 44;
      },
    });
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      if (this.hasAttribute('data-course-tree-scroll')) return new DOMRect(0, 0, 320, 400);
      if (this.getAttribute('data-testid') === 'module-toggle-m1') return new DOMRect(0, 8, 320, 46);
      if (this.getAttribute('data-testid') === 'lesson-button-l3') return new DOMRect(0, 40, 320, 44);
      return new DOMRect(0, 0, 320, 44);
    });
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    try {
      await renderFocusedTree('l3');

      const focused = await screen.findByTestId('lesson-button-l3');
      expect(scrollIntoView.mock.instances).toEqual([focused]);
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

  it('leaves scrolling to callers that own a scroll container', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    await renderCollapsedTree();

    expect(await screen.findByTestId('lesson-button-l1')).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });

  it('reveals a collapsed module with its marks on demand', async () => {
    const user = userEvent.setup();
    await renderCollapsedTree();

    await screen.findByTestId('module-toggle-m2');
    expect(treeItem('module-toggle-m2')).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByTestId('module-toggle-m2'));

    expect(within(screen.getByTestId('module-toggle-m2')).getByText('0/2')).toBeInTheDocument();
    expect(screen.queryByTestId('chapter-toggle-c3')).not.toBeInTheDocument();

    const locked = await screen.findByTestId('lesson-button-l4');
    expect(within(locked).getByTestId('lock-closed')).toBeInTheDocument();
    expect(screen.queryByTestId('unlock-lesson-l4')).not.toBeInTheDocument();
  });

  it('lets the reader collapse the focused module and expand another one', async () => {
    const user = userEvent.setup();
    await renderFocusedTree('l1');

    await screen.findByText('Intro to Variables');
    await user.click(screen.getByTestId('module-toggle-m1'));
    await waitFor(() => expect(screen.queryByText('Intro to Variables')).not.toBeInTheDocument());

    await user.click(screen.getByTestId('module-toggle-m2'));
    expect(await screen.findByTestId('lesson-button-l4')).toBeInTheDocument();
    expect(treeItem('module-toggle-m2')).toHaveAttribute('aria-expanded', 'true');
  });

  it('expands every match while filtering and restores the focused branch afterwards', async () => {
    const user = userEvent.setup();
    await renderFocusedTree('l1');

    await user.type(screen.getByTestId('lesson-search'), 'Closures');
    expect(await screen.findByTestId('lesson-button-l4')).toBeInTheDocument();

    await user.clear(screen.getByTestId('lesson-search'));
    expect(await screen.findByText('Intro to Variables')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId('lesson-button-l4')).not.toBeInTheDocument());
  });

  it('describes each row with its full title and the lock reason', async () => {
    await renderTree();

    expect(await screen.findByTestId('lesson-button-l1')).toHaveAttribute(
      'title',
      'Intro to Variables',
    );
    expect(screen.getByTestId('module-toggle-m1')).toHaveAttribute('title', '01 - Fundamentals');
    expect(screen.getByTestId('chapter-toggle-c1')).toHaveAttribute('title', 'Getting started');
    expect(screen.getByTestId('lesson-button-l4')).toHaveAttribute(
      'title',
      en.courseTree.lockedLessonTooltip({ name: 'Closures Deep Dive' }),
    );
  });

  it('shows the full title in a tooltip on hover', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/student/lessons/:lessonId', () =>
        HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'x' } }, { status: 404 }),
      ),
    );
    await renderTree();

    await user.hover(await screen.findByTestId('lesson-button-l1'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Intro to Variables');
  });

  it('shows only the focused row tooltip and dismisses it with Escape or blur', async () => {
    const user = userEvent.setup();
    await renderTree();
    treeItem('module-toggle-m1').focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('01 - Fundamentals');

    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(screen.getAllByRole('tooltip')).toHaveLength(1);
      expect(screen.getByRole('tooltip')).toHaveTextContent('Getting started');
    });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(treeItem('chapter-toggle-c1')).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Intro to Variables');
    await user.click(screen.getByTestId('lesson-search'));
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('lets the keyboard reach a locked lesson tooltip without activating the lesson', async () => {
    const user = userEvent.setup();
    const { router } = await renderTree();
    treeItem('module-toggle-m2').focus();

    await user.keyboard('{ArrowDown}');

    expect(treeItem('lesson-button-l4')).toHaveFocus();
    expect(treeItem('lesson-button-l4')).toHaveAccessibleDescription(
      en.courseTree.lockedLessonTooltip({ name: 'Closures Deep Dive' }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole('tooltip')).toHaveLength(1);
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        en.courseTree.lockedLessonTooltip({ name: 'Closures Deep Dive' }),
      );
    });
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/my/courses/course-1');
  });

  it('does not add a separate unlock row for locked lessons', async () => {
    await renderTree();

    expect(treeItem('lesson-button-l4')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('unlock-lesson-l4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlock-lesson-l5')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlock-lesson-l1')).not.toBeInTheDocument();
  });
});
