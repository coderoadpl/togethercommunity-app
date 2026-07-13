import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { updateCourseModuleInputSchema, type Course, type CourseLesson, type CourseModule } from '@core/domain/index.js';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { CoursesPanel } from './CoursesPanel.js';

const course = (over: Partial<Course> = {}): Course => ({
  id: 'course-1',
  tenantId: 't1',
  name: 'Launch Kit',
  description: 'A course',
  imageUrl: null,
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
  contents: [],
  legacyId: null,
  createdAt: '2026-07-12T10:00:00.000Z',
  ...over,
});

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

    renderWithProviders(<CoursesPanel />);

    expect(await screen.findByText('Launch Kit')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('name'), 'Growth Course');
    await userEvent.type(screen.getByLabelText('description'), 'Grow fast');
    await userEvent.click(screen.getByRole('button', { name: 'create course' }));

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

    renderWithProviders(<CoursesPanel />);

    await userEvent.type(screen.getByLabelText('name'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'create course' }));

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

    renderWithProviders(<CoursesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'manage' }));

    await userEvent.type(await screen.findByLabelText('new chapter name'), 'Chapter One');
    await userEvent.click(screen.getByRole('button', { name: 'add chapter' }));

    expect(await screen.findByDisplayValue('Chapter One')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Intro lesson' }));
    await userEvent.type(screen.getByLabelText('display name'), 'Watch this');
    await userEvent.click(screen.getByRole('button', { name: 'add lesson' }));

    expect(await screen.findByText('Watch this')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(screen.getByTestId('module-card')).getByText('Intro lesson')).toBeInTheDocument();
    });
  });
});
