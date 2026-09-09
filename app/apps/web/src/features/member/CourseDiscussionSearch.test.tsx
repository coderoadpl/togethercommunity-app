import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { CourseStructureWithAccess, PublicPost } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CourseDiscussionSearch } from './CourseDiscussionSearch.js';

const structure: CourseStructureWithAccess = {
  courseId: 'course-1',
  name: 'Camper Basics',
  accessStatus: 'fully-accessible',
  completionStatus: 'not-completed',
  modules: [
    {
      id: 'm1',
      name: '01 - Start',
      accessStatus: 'fully-accessible',
      completionStatus: 'not-completed',
      chapters: [
        {
          id: 'ch1',
          name: 'Chapter',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [
            {
              contentId: 'ct1',
              lessonId: 'l1',
              name: 'Choosing an Engine',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
            },
            {
              contentId: 'ct2',
              lessonId: 'l2',
              name: 'Interior Build-Out',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
            },
          ],
        },
      ],
    },
  ],
};

const post = (id: string, lessonId: string, body: string): PublicPost => ({
  id,
  tenantId: 't1',
  contextKind: 'lesson',
  contextId: lessonId,
  parentPostId: null,
  rootPostId: id,
  isOwn: false,
  authorDisplay: 'Alex Author',
  authorIsStaff: false,
  authorAvatarUrl: null,
  body,
  createdAt: '2026-07-15T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
});

const renderSearch = () => {
  const root = createRootRoute({
    component: () => <CourseDiscussionSearch courseId="course-1" structure={structure} />,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1'] }),
  });
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('CourseDiscussionSearch', () => {
  it('groups hits by lesson and links each hit to the lesson discussion', async () => {
    const requestedUrls: string[] = [];
    server.use(
      http.get('/api/posts/search', ({ request }) => {
        requestedUrls.push(request.url);
        return HttpResponse.json({
          ok: true,
          data: {
            hits: [
              { post: post('h1', 'l1', 'Which engine should I choose?'), lessonId: 'l1', snippet: 'Which engine should I choose?' },
              { post: post('h2', 'l2', 'Engine and build-out'), lessonId: 'l2', snippet: 'Engine and build-out' },
              { post: post('h3', 'l1', 'Diesel or gasoline engine'), lessonId: 'l1', snippet: 'Diesel or gasoline engine' },
            ],
          },
        });
      }),
    );

    const user = userEvent.setup();
    renderSearch();

    expect(await screen.findByText(en.discussion.searchCourseHeading)).toBeInTheDocument();
    expect(screen.getByTestId('course-search-hint')).toHaveTextContent(
      en.discussion.searchHint,
    );

    await user.type(screen.getByTestId('course-discussion-search-input'), 'engine');

    const groupA = await screen.findByTestId('search-group-l1');
    expect(within(groupA).getByRole('heading', { name: 'Choosing an Engine' })).toBeInTheDocument();
    expect(within(groupA).getByTestId('course-search-hit-h1')).toHaveAttribute(
      'href',
      '/my/courses/course-1/lessons/l1',
    );
    expect(within(groupA).getByTestId('course-search-hit-h3')).toBeInTheDocument();

    const groupB = screen.getByTestId('search-group-l2');
    expect(within(groupB).getByRole('heading', { name: 'Interior Build-Out' })).toBeInTheDocument();
    expect(within(groupB).getByTestId('course-search-hit-h2')).toHaveAttribute(
      'href',
      '/my/courses/course-1/lessons/l2',
    );

    expect(within(groupA).getAllByText('engine')[0]?.tagName).toBe('MARK');

    const url = new URL(requestedUrls[requestedUrls.length - 1] ?? '');
    expect(url.searchParams.get('query')).toBe('engine');
    expect(url.searchParams.getAll('lessonId')).toEqual(['l1', 'l2']);
  });

  it('shows an empty note when nothing matches', async () => {
    server.use(
      http.get('/api/posts/search', () => HttpResponse.json({ ok: true, data: { hits: [] } })),
    );

    const user = userEvent.setup();
    renderSearch();

    await user.type(await screen.findByTestId('course-discussion-search-input'), 'missing');

    expect(await screen.findByTestId('course-search-empty')).toHaveTextContent(
      en.discussion.searchCourseEmpty,
    );
  });
});
