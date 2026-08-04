import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  detachModuleFromCourseInputSchema,
  newCourseModuleSchema,
  updateCourseInputSchema,
  updateCourseModuleInputSchema,
  type Course,
  type CourseLesson,
  type CourseModule,
} from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { PanelCourseDetailRoute, PanelModuleCreateRoute } from '../panel-routes.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { CourseCreatePage, CoursesListPanel } from './CoursesPanel.js';

const renderCoursesPanel = async (initialEntry = '/panel/courses') => {
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/courses',
    component: CoursesListPanel,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/courses/$courseId',
    component: PanelCourseDetailRoute,
  });
  const createRoutePage = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/courses/new',
    component: CourseCreatePage,
  });
  const moduleCreateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/courses/$courseId/modules/new',
    component: PanelModuleCreateRoute,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, createRoutePage, moduleCreateRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const course = (over: Partial<Course> = {}): Course => ({
  id: 'course-1',
  tenantId: 't1',
  name: 'Launch Kit',
  description: 'A course',
  imageUrl: null,
  moduleOrder: [],
  legacyId: null,
  createdAt: '2026-07-12T10:00:00.000Z',
  ...over,
});

const moduleName = (prefix: string | null, title: string) => (prefix ? `${prefix} - ${title}` : title);

const courseModule = (over: Partial<CourseModule> = {}): CourseModule => {
  const base: CourseModule = {
    id: 'module-1',
    tenantId: 't1',
    courseIds: ['course-1'],
    title: 'Module One',
    prefix: null,
    name: 'Module One',
    chapters: [],
    legacyId: null,
    createdAt: '2026-07-12T10:00:00.000Z',
    ...over,
  };
  return { ...base, name: moduleName(base.prefix, base.title) };
};

const lesson = (over: Partial<CourseLesson> = {}): CourseLesson => ({
  id: 'lesson-1',
  tenantId: 't1',
  name: 'Intro lesson',
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: '2026-07-12T10:00:00.000Z',
  ...over,
});

/** jsdom implements neither DataTransfer nor drag sequencing, so the payload is a stub the handlers can write to. */
const drag = (handle: HTMLElement, target: HTMLElement) => {
  const dataTransfer = { dropEffect: 'none', effectAllowed: 'uninitialized', setData: () => undefined };
  fireEvent.dragStart(handle, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
};

describe('CoursesPanel courses tab', () => {
  it('lists courses and creates a new one', async () => {
    let courses = [course()];
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules: [] } })),
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.post('/api/courses', () => {
        const created = course({ id: 'course-2', name: 'Growth Course', description: 'Grow fast' });
        courses = [...courses, created];
        return HttpResponse.json({ ok: true, data: { course: created } });
      }),
    );

    await renderCoursesPanel();

    expect(await screen.findByText('Launch Kit')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: `+ ${pl.common.add}` }));
    await userEvent.type(await screen.findByLabelText(pl.common.name), 'Growth Course');
    await userEvent.type(screen.getByLabelText(pl.common.description), 'Grow fast');
    await userEvent.click(screen.getByRole('button', { name: pl.courses.create }));

    expect(await screen.findByText('Growth Course')).toBeInTheDocument();
  });

  it('surfaces validation details from an AppError', async () => {
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [] } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules: [] } })),
      http.post('/api/courses', () =>
        HttpResponse.json({
          ok: false,
          error: {
            code: 'validation',
            message: 'Invalid course',
            details: { formErrors: [], fieldErrors: { name: ['Name is required'] } },
          },
        }),
      ),
    );

    await renderCoursesPanel('/panel/courses/new');

    await userEvent.type(screen.getByLabelText(pl.common.name), 'X');
    await userEvent.click(screen.getByRole('button', { name: pl.courses.create }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
  });

  it('adds a chapter and a content entry through the module editor', async () => {
    let modules: CourseModule[] = [courseModule({ chapters: [] })];
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [course()] } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () =>
        HttpResponse.json({ ok: true, data: { lessons: [lesson({ name: 'Intro lesson' })] } }),
      ),
      http.post('/api/modules/update', async ({ request }) => {
        const body = updateCourseModuleInputSchema.parse(await request.json());
        const current = modules[0];
        if (!current) return HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'missing' } });
        const updated: CourseModule = { ...current, chapters: body.chapters ?? current.chapters };
        modules = [updated];
        return HttpResponse.json({ ok: true, data: { module: updated } });
      }),
    );

    await renderCoursesPanel();

    await userEvent.click(await screen.findByRole('button', { name: pl.courses.manage }));

    await userEvent.type(await screen.findByLabelText(pl.courses.newChapterName), 'Chapter One');
    await userEvent.click(screen.getByRole('button', { name: pl.courses.addChapter }));

    expect(await screen.findByDisplayValue('Chapter One')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Intro lesson' }));
    await userEvent.clear(screen.getByLabelText(pl.courses.displayName));
    await userEvent.type(screen.getByLabelText(pl.courses.displayName), 'Watch this');
    await userEvent.click(screen.getByRole('button', { name: pl.courses.addLesson }));

    expect(await screen.findByText('Watch this')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(screen.getByTestId('module-card')).getByText('Intro lesson')).toBeInTheDocument();
    });
  });

  it('creates a module on the dedicated subpage and returns to the course', async () => {
    let modules: CourseModule[] = [];
    const created: Array<{ title: string }> = [];
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [course()] } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/modules', async ({ request }) => {
        const body = newCourseModuleSchema.parse(await request.json());
        created.push({ title: body.title });
        const module = courseModule({ id: 'module-9', title: body.title, chapters: [] });
        modules = [module];
        return HttpResponse.json({ ok: true, data: { module } });
      }),
    );

    await renderCoursesPanel('/panel/courses/course-1');

    await userEvent.click(await screen.findByTestId('add-module'));

    const titleField = await screen.findByLabelText(pl.products.titleLabel);
    await userEvent.type(titleField, 'Module Nine');
    await userEvent.click(screen.getByRole('button', { name: pl.courses.createModule }));

    expect(await screen.findByTestId('module-card')).toBeInTheDocument();
    expect(created).toEqual([expect.objectContaining({ title: 'Module Nine' })]);
  });

  it('auto-fills the display name, enables add on pick, and warns on a duplicate lesson', async () => {
    const chapters = [
      { id: 'ch1', name: 'Chapter', contents: [{ id: 'ct1', name: 'Existing', lessonId: 'lesson-1' }] },
    ];
    const modules = [courseModule({ chapters })];
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [course()] } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () =>
        HttpResponse.json({ ok: true, data: { lessons: [lesson({ id: 'lesson-1', name: 'Intro lesson' })] } }),
      ),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
    );

    await renderCoursesPanel();

    await userEvent.click(await screen.findByRole('button', { name: pl.courses.manage }));

    await userEvent.click(await screen.findByRole('combobox', { name: pl.courses.lessonLabel }));
    await userEvent.click(await screen.findByRole('option', { name: 'Intro lesson' }));

    expect(screen.getByLabelText(pl.courses.displayName)).toHaveValue('Intro lesson');
    expect(screen.getByRole('button', { name: pl.courses.addLesson })).toBeEnabled();
    expect(screen.getByText(pl.courses.duplicateLessonWarning)).toBeInTheDocument();
  });

  it('reorders modules with the keyboard-accessible controls', async () => {
    let courses = [course({ moduleOrder: ['module-1', 'module-2'] })];
    const modules = [
      courseModule({ id: 'module-1', title: 'Module One' }),
      courseModule({ id: 'module-2', title: 'Module Two' }),
    ];
    let sentOrder: string[] | undefined;
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/courses/update', async ({ request }) => {
        const body = updateCourseInputSchema.parse(await request.json());
        sentOrder = body.moduleOrder;
        const current = courses[0];
        if (!current) return HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'missing' } });
        const updated: Course = { ...current, moduleOrder: body.moduleOrder ?? current.moduleOrder };
        courses = [updated];
        return HttpResponse.json({ ok: true, data: { course: updated } });
      }),
    );

    await renderCoursesPanel();

    await userEvent.click(await screen.findByRole('button', { name: pl.courses.manage }));

    const moveDown = await screen.findByRole('button', {
      name: pl.courses.moveModuleDown({ name: 'Module One' }),
    });
    moveDown.focus();
    expect(moveDown).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(sentOrder).toEqual(['module-2', 'module-1']));
    await waitFor(() => {
      const firstCard = screen.getAllByTestId('module-card')[0];
      if (!firstCard) throw new Error('no module card rendered');
      expect(within(firstCard).getByText('Module Two')).toBeInTheDocument();
    });
  });

  it('persists module ordering changed by drag', async () => {
    let courses = [course({ moduleOrder: ['module-1', 'module-2'] })];
    const modules = [
      courseModule({ id: 'module-1', title: 'Module One' }),
      courseModule({ id: 'module-2', title: 'Module Two' }),
    ];
    let sentOrder: string[] | undefined;
    let updateCalls = 0;
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/courses/update', async ({ request }) => {
        updateCalls += 1;
        const body = updateCourseInputSchema.parse(await request.json());
        sentOrder = body.moduleOrder;
        const current = courses[0];
        if (!current) return HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'missing' } });
        const updated = { ...current, moduleOrder: body.moduleOrder ?? current.moduleOrder };
        courses = [updated];
        return HttpResponse.json({ ok: true, data: { course: updated } });
      }),
    );

    await renderCoursesPanel('/panel/courses/course-1');

    const cards = await screen.findAllByTestId('module-card');
    const handle = screen.getByTestId('module-drag-handle-module-1');
    const target = cards[1];
    if (!target) throw new Error('module drag target missing');

    const restingBackground = getComputedStyle(target).backgroundColor;
    const dataTransfer = { dropEffect: 'none', effectAllowed: 'uninitialized', setData: () => undefined };
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(getComputedStyle(target).backgroundColor).not.toBe(restingBackground);

    const targetChild = within(target).getByText('Module Two');
    const internalDragLeave = createEvent.dragLeave(target, { dataTransfer });
    Object.defineProperty(internalDragLeave, 'relatedTarget', { value: targetChild });
    fireEvent(target, internalDragLeave);
    expect(getComputedStyle(target).backgroundColor).not.toBe(restingBackground);
    fireEvent.dragLeave(target, { dataTransfer, relatedTarget: document.body });
    expect(getComputedStyle(target).backgroundColor).toBe(restingBackground);

    drag(handle, target);

    await waitFor(() => expect(sentOrder).toEqual(['module-2', 'module-1']));
    await waitFor(() => {
      const firstCard = screen.getAllByTestId('module-card')[0];
      if (!firstCard) throw new Error('no module card rendered');
      expect(within(firstCard).getByText('Module Two')).toBeInTheDocument();
    });
    expect(updateCalls).toBe(1);
  });

  it('rolls an optimistic module drag back when persistence fails', async () => {
    const courses = [course({ moduleOrder: ['module-1', 'module-2'] })];
    const modules = [
      courseModule({ id: 'module-1', title: 'Module One' }),
      courseModule({ id: 'module-2', title: 'Module Two' }),
    ];
    let coursesRequests = 0;
    let releaseRequest: () => void = () => undefined;
    const requestHeld = new Promise<void>((resolve) => {
      releaseRequest = () => resolve();
    });
    let releaseRefetch: () => void = () => undefined;
    const refetchHeld = new Promise<void>((resolve) => {
      releaseRefetch = () => resolve();
    });
    server.use(
      http.get('/api/courses', async () => {
        coursesRequests += 1;
        if (coursesRequests > 1) await refetchHeld;
        return HttpResponse.json({ ok: true, data: { courses } });
      }),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/courses/update', async () => {
        await requestHeld;
        return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'save failed' } });
      }),
    );

    await renderCoursesPanel('/panel/courses/course-1');

    const cards = await screen.findAllByTestId('module-card');
    const target = cards[1];
    if (!target) throw new Error('module drop target missing');
    drag(screen.getByTestId('module-drag-handle-module-1'), target);

    await waitFor(() => {
      const firstCard = screen.getAllByTestId('module-card')[0];
      if (!firstCard) throw new Error('no module card rendered');
      expect(within(firstCard).getByText('Module Two')).toBeInTheDocument();
    });

    releaseRequest();

    try {
      await waitFor(() => {
        const firstCard = screen.getAllByTestId('module-card')[0];
        if (!firstCard) throw new Error('no module card rendered');
        expect(within(firstCard).getByText('Module One')).toBeInTheDocument();
      });
    } finally {
      releaseRefetch();
    }
  });

  it('persists lesson ordering changed by drag', async () => {
    const chapters = [
      {
        id: 'ch1',
        name: 'Chapter',
        contents: [
          { id: 'ct1', name: 'First lesson', lessonId: 'lesson-1' },
          { id: 'ct2', name: 'Second lesson', lessonId: 'lesson-2' },
        ],
      },
    ];
    let modules = [courseModule({ chapters })];
    let sentContentOrder: string[] | undefined;
    let updateCalls = 0;
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [course()] } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () =>
        HttpResponse.json({
          ok: true,
          data: { lessons: [lesson(), lesson({ id: 'lesson-2', name: 'Second lesson' })] },
        }),
      ),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/modules/update', async ({ request }) => {
        updateCalls += 1;
        const body = updateCourseModuleInputSchema.parse(await request.json());
        const current = modules[0];
        if (!current) return HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'missing' } });
        sentContentOrder = body.chapters?.[0]?.contents.map((content) => content.id);
        const updated = { ...current, chapters: body.chapters ?? current.chapters };
        modules = [updated];
        return HttpResponse.json({ ok: true, data: { module: updated } });
      }),
    );

    await renderCoursesPanel('/panel/courses/course-1');

    const handle = await screen.findByTestId('lesson-drag-handle-ct1');
    const target = screen.getByTestId('lesson-content-ct2');
    const restingBackground = getComputedStyle(target).backgroundColor;
    const dataTransfer = { dropEffect: 'none', effectAllowed: 'uninitialized', setData: () => undefined };
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(getComputedStyle(target).backgroundColor).not.toBe(restingBackground);

    const targetChild = within(target).getAllByText('Second lesson')[0];
    if (!targetChild) throw new Error('lesson drop target child missing');
    const internalDragLeave = createEvent.dragLeave(target, { dataTransfer });
    Object.defineProperty(internalDragLeave, 'relatedTarget', { value: targetChild });
    fireEvent(target, internalDragLeave);
    expect(getComputedStyle(target).backgroundColor).not.toBe(restingBackground);
    fireEvent.dragLeave(target, { dataTransfer, relatedTarget: document.body });
    expect(getComputedStyle(target).backgroundColor).toBe(restingBackground);

    drag(handle, target);

    await waitFor(() => expect(sentContentOrder).toEqual(['ct2', 'ct1']));
    await waitFor(() => {
      const firstContent = screen.getAllByTestId(/^lesson-content-/)[0];
      if (!firstContent) throw new Error('lesson content missing');
      expect(firstContent).toHaveTextContent('Second lesson');
    });
    expect(updateCalls).toBe(1);

    const moveDown = screen.getByRole('button', {
      name: pl.courses.moveContentDown({ name: 'Second lesson' }),
    });
    moveDown.focus();
    expect(moveDown).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(sentContentOrder).toEqual(['ct1', 'ct2']));
  });

  it('rolls an optimistic lesson drag back when persistence fails', async () => {
    const chapters = [
      {
        id: 'ch1',
        name: 'Chapter',
        contents: [
          { id: 'ct1', name: 'First lesson', lessonId: 'lesson-1' },
          { id: 'ct2', name: 'Second lesson', lessonId: 'lesson-2' },
        ],
      },
    ];
    const modules = [courseModule({ chapters })];
    let modulesRequests = 0;
    let releaseRequest: () => void = () => undefined;
    const requestHeld = new Promise<void>((resolve) => {
      releaseRequest = () => resolve();
    });
    let releaseRefetch: () => void = () => undefined;
    const refetchHeld = new Promise<void>((resolve) => {
      releaseRefetch = () => resolve();
    });
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [course()] } })),
      http.get('/api/modules', async () => {
        modulesRequests += 1;
        if (modulesRequests > 1) await refetchHeld;
        return HttpResponse.json({ ok: true, data: { modules } });
      }),
      http.get('/api/lessons', () =>
        HttpResponse.json({
          ok: true,
          data: { lessons: [lesson(), lesson({ id: 'lesson-2', name: 'Second lesson' })] },
        }),
      ),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/modules/update', async () => {
        await requestHeld;
        return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'save failed' } });
      }),
    );

    await renderCoursesPanel('/panel/courses/course-1');

    drag(await screen.findByTestId('lesson-drag-handle-ct1'), screen.getByTestId('lesson-content-ct2'));

    await waitFor(() => {
      const firstContent = screen.getAllByTestId(/^lesson-content-/)[0];
      if (!firstContent) throw new Error('lesson content missing');
      expect(firstContent).toHaveTextContent('Second lesson');
    });

    releaseRequest();

    try {
      await waitFor(() => {
        const firstContent = screen.getAllByTestId(/^lesson-content-/)[0];
        if (!firstContent) throw new Error('lesson content missing');
        expect(firstContent).toHaveTextContent('First lesson');
      });
    } finally {
      releaseRefetch();
    }
  });

  it('rejects a lesson drop into another chapter', async () => {
    const chapters = [
      {
        id: 'ch1',
        name: 'First chapter',
        contents: [{ id: 'ct1', name: 'First lesson', lessonId: 'lesson-1' }],
      },
      {
        id: 'ch2',
        name: 'Second chapter',
        contents: [{ id: 'ct2', name: 'Second lesson', lessonId: 'lesson-2' }],
      },
    ];
    const modules = [courseModule({ chapters })];
    let updateCalls = 0;
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [course()] } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () =>
        HttpResponse.json({
          ok: true,
          data: { lessons: [lesson(), lesson({ id: 'lesson-2', name: 'Second lesson' })] },
        }),
      ),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/modules/update', () => {
        updateCalls += 1;
        return HttpResponse.json({ ok: true, data: { module: modules[0] } });
      }),
    );

    await renderCoursesPanel('/panel/courses/course-1');

    const handle = await screen.findByTestId('lesson-drag-handle-ct1');
    const target = screen.getByTestId('lesson-content-ct2');
    const dataTransfer = { dropEffect: 'none', effectAllowed: 'uninitialized', setData: () => undefined };
    fireEvent.dragStart(handle, { dataTransfer });
    const dragOverEvent = createEvent.dragOver(target, { dataTransfer });
    fireEvent(target, dragOverEvent);
    fireEvent.drop(target, { dataTransfer });

    expect(dragOverEvent.defaultPrevented).toBe(false);
    expect(updateCalls).toBe(0);
    expect(screen.getByTestId('lesson-content-ct1')).toHaveTextContent('First lesson');
    expect(target).toHaveTextContent('Second lesson');
  });

  it('detaches a module from the course', async () => {
    let modules = [courseModule({ id: 'module-1', title: 'Module One' })];
    let detached: { courseId: string; moduleId: string } | undefined;
    server.use(
      http.get('/api/courses', () =>
        HttpResponse.json({ ok: true, data: { courses: [course({ moduleOrder: ['module-1'] })] } }),
      ),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/modules/detach', async ({ request }) => {
        detached = detachModuleFromCourseInputSchema.parse(await request.json());
        const updated = courseModule({ id: 'module-1', title: 'Module One', courseIds: [] });
        modules = [updated];
        return HttpResponse.json({ ok: true, data: { module: updated } });
      }),
    );

    await renderCoursesPanel();

    await userEvent.click(await screen.findByRole('button', { name: pl.courses.manage }));
    await userEvent.click(await screen.findByRole('button', { name: pl.courses.detachModule }));
    await userEvent.click(await screen.findByTestId('module-detach-confirm'));

    await waitFor(() => expect(detached).toEqual({ courseId: 'course-1', moduleId: 'module-1' }));
    expect(await screen.findByText(pl.courses.noModulesInCourse)).toBeInTheDocument();
  });

  it('confirms a populated chapter delete before mutating', async () => {
    const chapters = [
      { id: 'ch1', name: 'Getting started', contents: [{ id: 'ct1', name: 'Watch this', lessonId: 'lesson-1' }] },
    ];
    let modules = [courseModule({ chapters })];
    let savedChapters: { id: string }[] | undefined;
    server.use(
      http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [course()] } })),
      http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules } })),
      http.get('/api/lessons', () =>
        HttpResponse.json({ ok: true, data: { lessons: [lesson({ id: 'lesson-1', name: 'Intro lesson' })] } }),
      ),
      http.get('/api/courses/history', () => HttpResponse.json({ ok: true, data: { versions: [] } })),
      http.post('/api/modules/update', async ({ request }) => {
        const body = updateCourseModuleInputSchema.parse(await request.json());
        const current = modules[0];
        if (!current) return HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'missing' } });
        savedChapters = body.chapters ?? current.chapters;
        const updated: CourseModule = { ...current, chapters: body.chapters ?? current.chapters };
        modules = [updated];
        return HttpResponse.json({ ok: true, data: { module: updated } });
      }),
    );

    await renderCoursesPanel();

    await userEvent.click(await screen.findByRole('button', { name: pl.courses.manage }));
    await userEvent.click(await screen.findByRole('button', { name: pl.courses.removeChapter }));

    expect(await screen.findByText(pl.courses.removeChapterConfirmTitle)).toBeInTheDocument();
    expect(savedChapters).toBeUndefined();

    await userEvent.click(screen.getByTestId('chapter-delete-confirm'));

    await waitFor(() => expect(savedChapters).toEqual([]));
  });
});
