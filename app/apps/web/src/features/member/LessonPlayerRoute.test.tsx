import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberCourseProgress, PlayableCourseLesson, PlayableLessonBlock } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { LessonPlayerRoute, validateLessonSearch } from './LessonPlayerRoute.js';

const lesson = (contents: PlayableLessonBlock[]): PlayableCourseLesson => ({
  id: 'l1',
  tenantId: 't1',
  name: 'Intro to Variables',
  isPreview: false,
  contents,
  legacyId: null,
  createdAt: '2024-01-01T00:00:00.000Z',
});

const progress = (completedLessonIds: string[]): MemberCourseProgress => ({
  id: 'p1',
  tenantId: 't1',
  memberId: 'mem-1',
  courseId: 'course-1',
  completedLessonIds,
  updatedAt: '2024-01-01T00:00:00.000Z',
});

const okLesson = (contents: PlayableLessonBlock[]) =>
  http.get('/api/student/lessons/:lessonId', () =>
    HttpResponse.json({ ok: true, data: { lesson: lesson(contents), authenticated: true } }),
  );

const okStructure = () => http.get('/api/student/courses/:courseId/structure', () => HttpResponse.json({
  ok: true,
  data: { structure: {
    courseId: 'course-1', name: 'Demo course', accessStatus: 'fully-accessible', completionStatus: 'partially-completed',
    modules: [{
      id: 'm1', name: 'Demo module', accessStatus: 'fully-accessible', completionStatus: 'partially-completed',
      chapters: [{
        id: 'c1', name: 'Demo chapter', accessStatus: 'fully-accessible', completionStatus: 'partially-completed',
        lessons: [{ contentId: 'ct-l1', lessonId: 'l1', name: 'Demo lesson', accessStatus: 'fully-accessible', completionStatus: 'not-completed' }],
      }],
    }],
  } },
}));

const okProgress = () => http.get('/api/student/progress', () => HttpResponse.json({
  ok: true, data: { progress: progress([]) },
}));

const renderLessonUrl = async (url: string) => {
  const root = createRootRoute();
  const current = createRoute({
    getParentRoute: () => root,
    path: '/my/courses/$courseId/lessons/$lessonId',
    validateSearch: validateLessonSearch,
    component: LessonPlayerRoute,
  });
  const edition = createRoute({
    getParentRoute: () => root,
    path: '/my/courses/$courseId/lessons/$lessonId/editions/$number',
    validateSearch: validateLessonSearch,
    component: LessonPlayerRoute,
  });
  const login = createRoute({ getParentRoute: () => root, path: '/login', component: () => <div>Sign in required</div> });
  const router = createRouter({
    routeTree: root.addChildren([current, edition, login]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  return { ...renderWithProviders(<RouterProvider router={router} />), router };
};

describe('lesson edition routes', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: {
            userId: 'u1',
            email: 'user@example.com',
            emailVerified: true,
            name: 'John Participant',
            tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'mem-1', banned: false },
          },
        }),
      ),
      http.get('/api/tenant/settings', () =>
        HttpResponse.json({
          ok: true,
          data: {
            settings: {
              name: 'Acme',
              socialLinks: [],
              billingPortalUrl: null,
              bunnyStreamLibraryId: null,
              videoAutoplayDefault: false,
              memberVideoAutoplayOverride: false,
            },
          },
        }),
      ),
      http.get('/api/discussion', () =>
        HttpResponse.json({
          ok: true,
          data: { discussion: { threads: [], nextCursor: null, viewerSubscriptions: {} } },
        }),
      ),
      http.get('/api/student/lessons/:lessonId/playback', () =>
        HttpResponse.json({ ok: true, data: { lessonId: 'l1', expiresAt: '2026-09-08T12:00:00.000Z', videos: [] } }),
      ),
      http.get('/api/student/lessons/:lessonId/attachments', () =>
        HttpResponse.json({ ok: true, data: { attachments: [] } }),
      ),
      http.post('/api/student/progress/last-viewed', () =>
        HttpResponse.json({ ok: true, data: { progress: progress([]) } }),
      ),
    );
  });

  it.each(['2', '2.0', '2.10', '3.0.1'])('preserves the exact edition %s in a shareable path', async (number) => {
    const reads: string[] = [];
    server.use(
      okStructure(), okProgress(),
      http.get('/api/student/lessons/:lessonId/editions/:number', ({ params }) => {
        reads.push(String(params['number']));
        return HttpResponse.json({
          ok: true,
          data: { lesson: lesson([{ type: 'html', html: '<p>Selected snapshot</p>' }]), authenticated: true },
        });
      }),
    );
    const path = `/my/courses/course-1/lessons/l1/editions/${number}`;
    const { router, queryClient } = await renderLessonUrl(path);
    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Selected snapshot');
    expect(reads).toEqual([number]);
    expect(router.state.location.pathname).toBe(path);
    expect(queryClient.getQueryState(actions.studentLesson('l1').queryKey)?.fetchStatus).toBe('idle');
    expect(queryClient.getQueryData(actions.studentLesson('l1').queryKey)).toBeUndefined();
  });

  it.each(['01', '1.02', '1.2.3.4', '-1', '1234567890123', 'unknown'])('shows not found for malformed edition %s without loading current content', async (number) => {
    const { queryClient } = await renderLessonUrl(`/my/courses/course-1/lessons/l1/editions/${number}`);
    expect(await screen.findByText(en.errors.messageNotFound)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.lesson.unavailable })).toBeInTheDocument();
    expect(queryClient.isFetching()).toBe(0);
    expect(queryClient.getQueryData(actions.studentLesson('l1').queryKey)).toBeUndefined();
    expect(queryClient.getQueryData(actions.studentLessonEdition('l1', number).queryKey)).toBeUndefined();
  });

  it('shows not found for an unknown valid edition without falling back to the current content', async () => {
    server.use(http.get('/api/student/lessons/l1/editions/42', () => HttpResponse.json({
      ok: false, error: { code: 'not_found', message: 'Edition not found' },
    }, { status: 404 })));
    const { queryClient } = await renderLessonUrl('/my/courses/course-1/lessons/l1/editions/42');
    expect(await screen.findByText(en.errors.messageNotFound)).toBeInTheDocument();
    expect(queryClient.getQueryData(actions.studentLesson('l1').queryKey)).toBeUndefined();
    expect(queryClient.getQueryState(actions.studentLessonEditions('l1').queryKey)).toBeUndefined();
  });

  it('links the editions list to a numbered path and returns to the current lesson', async () => {
    server.use(
      okLesson([{ type: 'html', html: '<p>Current content</p>' }]), okStructure(), okProgress(),
      http.get('/api/student/lessons/l1/editions', () => HttpResponse.json({
        ok: true,
        data: { editions: ['3', '2.10'].map((number) => ({ number, note: null, markedAt: '2026-10-01T12:00:00.000Z' })) },
      })),
      http.get('/api/student/lessons/l1/editions/2.10', () => HttpResponse.json({
        ok: true,
        data: { lesson: lesson([{ type: 'html', html: '<p>Earlier snapshot</p>' }]), authenticated: true },
      })),
    );
    const { router } = await renderLessonUrl('/my/courses/course-1/lessons/l1');
    await userEvent.click(await screen.findByRole('button', { name: en.lesson.editionMenu }));
    await userEvent.click(screen.getByRole('menuitem', { name: en.lesson.previousEditions }));
    await userEvent.click(screen.getByRole('button', { name: /Edition 2.10/ }));
    expect(await screen.findByTestId('lesson-edition-banner')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/l1/editions/2.10');
    expect(screen.getByTestId('lesson-html')).toHaveTextContent('Earlier snapshot');
    await userEvent.click(screen.getByRole('button', { name: en.lesson.editionBackToCurrent }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/l1'));
    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Current content');
    expect(screen.queryByTestId('lesson-edition-banner')).not.toBeInTheDocument();
  });

  it.each(['', '/editions/2.10'])('does not request editions for anonymous non-preview content at %s', async (suffix) => {
    const editionReads = vi.fn(() => HttpResponse.json({ ok: true, data: { editions: [] } }));
    server.use(
      http.get(`/api/student/lessons/l1${suffix}`, () => HttpResponse.json({
        ok: false, error: { code: 'unauthorized', message: 'Sign in' },
      }, { status: 401 })),
      http.get('/api/student/lessons/l1/editions', editionReads),
    );
    const { router } = await renderLessonUrl(`/my/courses/course-1/lessons/l1${suffix}`);
    expect(await screen.findByText('Sign in required')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(editionReads).not.toHaveBeenCalled();
  });

  it.each(['', '/editions/2.10'])('does not request editions for locked content at %s', async (suffix) => {
    const editionReads = vi.fn(() => HttpResponse.json({ ok: true, data: { editions: [] } }));
    server.use(
      okStructure(), okProgress(),
      http.get(`/api/student/lessons/l1${suffix}`, () => HttpResponse.json({
        ok: false, error: { code: 'forbidden', message: 'Access denied' },
      }, { status: 403 })),
      http.get('/api/student/lessons/l1/editions', editionReads),
    );
    await renderLessonUrl(`/my/courses/course-1/lessons/l1${suffix}`);
    expect(await screen.findByRole('heading', { name: en.lesson.contentLocked })).toBeInTheDocument();
    expect(editionReads).not.toHaveBeenCalled();
  });
});
