import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { CourseStructureWithAccess, Post } from '@core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CourseDiscussionSearch } from './CourseDiscussionSearch.js';

const structure: CourseStructureWithAccess = {
  courseId: 'course-1',
  name: 'Kamper od podstaw',
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
          name: 'Rozdział',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [
            {
              contentId: 'ct1',
              lessonId: 'l1',
              name: 'Wybór silnika',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
            },
            {
              contentId: 'ct2',
              lessonId: 'l2',
              name: 'Zabudowa wnętrza',
              accessStatus: 'fully-accessible',
              completionStatus: 'not-completed',
            },
          ],
        },
      ],
    },
  ],
};

const post = (id: string, lessonId: string, body: string): Post => ({
  id,
  tenantId: 't1',
  contextKind: 'lesson',
  contextId: lessonId,
  parentPostId: null,
  rootPostId: id,
  authorUserId: 'u2',
  authorDisplay: 'Ola Autorka',
  authorIsStaff: false,
  body,
  createdAt: '2026-07-15T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
});

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
              { post: post('h1', 'l1', 'Jaki silnik wybrać?'), lessonId: 'l1', snippet: 'Jaki silnik wybrać?' },
              { post: post('h2', 'l2', 'Silnik a zabudowa'), lessonId: 'l2', snippet: 'Silnik a zabudowa' },
              { post: post('h3', 'l1', 'Silnik diesla czy benzyna'), lessonId: 'l1', snippet: 'Silnik diesla czy benzyna' },
            ],
          },
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<CourseDiscussionSearch courseId="course-1" structure={structure} />);

    expect(screen.getByText(pl.discussion.searchCourseHeading)).toBeInTheDocument();

    await user.type(screen.getByTestId('course-discussion-search-input'), 'silnik');

    const groupA = await screen.findByTestId('search-group-l1');
    expect(within(groupA).getByRole('heading', { name: 'Wybór silnika' })).toBeInTheDocument();
    expect(within(groupA).getByTestId('course-search-hit-h1')).toHaveAttribute(
      'href',
      '/my/courses/course-1/lessons/l1',
    );
    expect(within(groupA).getByTestId('course-search-hit-h3')).toBeInTheDocument();

    const groupB = screen.getByTestId('search-group-l2');
    expect(within(groupB).getByRole('heading', { name: 'Zabudowa wnętrza' })).toBeInTheDocument();
    expect(within(groupB).getByTestId('course-search-hit-h2')).toHaveAttribute(
      'href',
      '/my/courses/course-1/lessons/l2',
    );

    expect(within(groupA).getAllByText('silnik')[0]?.tagName).toBe('MARK');

    const url = new URL(requestedUrls[requestedUrls.length - 1] ?? '');
    expect(url.searchParams.get('query')).toBe('silnik');
    expect(url.searchParams.getAll('lessonId')).toEqual(['l1', 'l2']);
  });

  it('shows an empty note when nothing matches', async () => {
    server.use(
      http.get('/api/posts/search', () => HttpResponse.json({ ok: true, data: { hits: [] } })),
    );

    const user = userEvent.setup();
    renderWithProviders(<CourseDiscussionSearch courseId="course-1" structure={structure} />);

    await user.type(screen.getByTestId('course-discussion-search-input'), 'niema');

    expect(await screen.findByTestId('course-search-empty')).toHaveTextContent(
      pl.discussion.searchCourseEmpty,
    );
  });
});
