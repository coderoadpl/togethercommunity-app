import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { CourseBreadcrumbs } from './CourseBreadcrumbs.js';

const lesson = (lessonId: string, name: string) => ({
  contentId: `ct-${lessonId}`,
  lessonId,
  name,
  accessStatus: 'fully-accessible' as const,
  completionStatus: 'not-completed' as const,
});

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
      completionStatus: 'not-completed',
      chapters: [
        {
          id: 'c1',
          name: 'Getting started',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [lesson('l1', 'Intro to Variables')],
        },
      ],
    },
    {
      id: 'm2',
      name: '02 - The DOM',
      accessStatus: 'fully-accessible',
      completionStatus: 'not-completed',
      chapters: [
        {
          id: 'c2',
          name: 'Events',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [lesson('l4', 'Listening for clicks')],
        },
      ],
    },
  ],
};

const okStructure = () =>
  http.get('/api/student/courses/:courseId/structure', () =>
    HttpResponse.json({ ok: true, data: { structure } }),
  );

const stubViewport = (dimension: 'min-width' | 'max-width') => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes(dimension),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const renderCrumbs = async (lessonId: string) => {
  const rootRoute = createRootRoute({
    component: () => <CourseBreadcrumbs courseId="course-1" lessonId={lessonId} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('CourseBreadcrumbs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the course, the module, the chapter and the lesson', async () => {
    stubViewport('min-width');
    server.use(okStructure());

    await renderCrumbs('l4');

    const crumbs = await screen.findByTestId('member-breadcrumbs');
    expect(crumbs).toHaveAccessibleName(pl.common.breadcrumbs);
    expect(within(crumbs).getByRole('link', { name: 'JavaScript Foundations' })).toHaveAttribute(
      'href',
      '/my/courses/course-1',
    );
    expect(within(crumbs).getByText('02 - The DOM')).toBeInTheDocument();
    expect(within(crumbs).getByText('Events')).toBeInTheDocument();
    expect(within(crumbs).getByText('Listening for clicks')).toBeInTheDocument();
    expect(within(crumbs).queryByText('01 - Fundamentals')).not.toBeInTheDocument();
    expect(within(crumbs).queryByText('Getting started')).not.toBeInTheDocument();
  });

  it('drops the middle of the trail below sm', async () => {
    stubViewport('max-width');
    server.use(okStructure());

    await renderCrumbs('l4');

    const crumbs = await screen.findByTestId('member-breadcrumbs');
    expect(within(crumbs).getByRole('link', { name: 'JavaScript Foundations' })).toBeInTheDocument();
    expect(within(crumbs).getByText('Listening for clicks')).toBeInTheDocument();
    expect(within(crumbs).queryByText('02 - The DOM')).not.toBeInTheDocument();
    expect(within(crumbs).queryByText('Events')).not.toBeInTheDocument();
  });
});
