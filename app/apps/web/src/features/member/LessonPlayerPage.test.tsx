import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useParams,
  useSearch,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CourseStructureLesson,
  CourseStructureWithAccess,
  DiscussionPost,
  LessonBlock,
  MemberCourseProgress,
  PlayableCourseLesson,
  PlayableLessonBlock,
} from '#core/domain/index.js';

import { updateLastViewedInputSchema } from '#core/domain/index.js';

import { DocumentTitleProvider } from '../../components/layout/document-title.js';
import { actions } from '../../api.js';
import { StartPage } from './StartPage.js';
import { MemberShell } from './shell/MemberShell.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { en } from '../../i18n/en.js';
import { stylesAt } from '../../lib/stylesheet.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { LessonPlayerPage } from './LessonPlayerPage.js';
import { readLessonTextAutoExpand } from './lesson-reading-preference.js';

const entry = (
  lessonId: string,
  name: string,
  accessible = true,
): CourseStructureLesson => ({
  contentId: `ct-${lessonId}`,
  lessonId,
  name,
  accessStatus: accessible ? 'fully-accessible' : 'not-accessible',
  completionStatus: 'not-completed',
});

const structureOf = (lessons: CourseStructureLesson[]): CourseStructureWithAccess => ({
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
          lessons,
        },
      ],
    },
  ],
});

const structure = structureOf([
  entry('l1', 'Intro to Variables'),
  entry('l2', 'Advanced Variables'),
]);

const allBlocks: PlayableLessonBlock[] = [
  {
    type: 'video',
    storageKey: 'k1',
    streamVideoId: 'vid-1',
    streamLibraryId: '424242',
    embedUrl: 'https://iframe.mediadelivery.net/embed/424242/vid-1',
  },
  { type: 'pdf', pdfUrl: 'https://cdn.example.com/slides.pdf', name: 'Slides' },
  { type: 'embed', embedUrl: 'https://example.com/embed' },
  { type: 'html', html: '<p>Safe body</p><script>window.__xss = 1;</script>' },
  { type: 'link', url: 'https://github.com/acme/repo', description: 'Course repo' },
  { type: 'link', url: 'https://docs.example.com/guide' },
];

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

const okStructureOf = (value: CourseStructureWithAccess) =>
  http.get('/api/student/courses/:courseId/structure', () =>
    HttpResponse.json({ ok: true, data: { structure: value } }),
  );

const okStructure = () => okStructureOf(structure);

const okStructureFullyCompleted = () =>
  okStructureOf({ ...structure, completionStatus: 'fully-completed' });

const okProgress = (completedLessonIds: string[] = []) =>
  http.get('/api/student/progress', () =>
    HttpResponse.json({ ok: true, data: { progress: progress(completedLessonIds) } }),
  );

const stubDesktopViewport = (reducedMotion = false) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') || reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const stubMobileViewport = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const MAX_WIDTH = /max-width:\s*([\d.]+)px/u;
const MIN_WIDTH = /min-width:\s*([\d.]+)px/u;

const mediaStyles = (element: Element, inViewport: (conditionText: string) => boolean): Record<string, string> => Object.fromEntries(
  [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .flatMap((rule) => rule instanceof CSSMediaRule && inViewport(rule.conditionText) ? [...rule.cssRules] : [])
    .flatMap((rule) => rule instanceof CSSStyleRule && element.matches(rule.selectorText)
      ? Array.from({ length: rule.style.length }, (_, index) => rule.style.item(index)).map((property) => [property, rule.style.getPropertyValue(property)] as const)
      : []),
);

const stylesBelow = (element: Element, viewportWidth: number): Record<string, string> => mediaStyles(element, (conditionText) => {
  const maxWidth = MAX_WIDTH.exec(conditionText);
  return maxWidth !== null && Number(maxWidth[1]) >= viewportWidth;
});

const stylesAbove = (element: Element, viewportWidth: number): Record<string, string> => mediaStyles(element, (conditionText) => {
  const minWidth = MIN_WIDTH.exec(conditionText);
  return minWidth !== null && Number(minWidth[1]) <= viewportWidth;
});

const renderPage = async (node: ReactNode, queryClient?: QueryClient, shell = false) => {
  if (shell) server.use(http.get('/api/public/offer', () => HttpResponse.json({
    ok: true, data: { tenant: { slug: 'acme', name: 'Acme', socialLinks: [] }, products: [], contentVersion: 1 },
  })));
  const rootRoute = createRootRoute({ component: shell ? () => <MemberShell hostname="acme.localhost" /> : () => node });
  const routeTree = shell ? rootRoute.addChildren([createRoute({
    getParentRoute: () => rootRoute, path: '/my/courses/course-1/lessons/l1', component: () => node,
  })]) : rootRoute;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
  });
  await router.load();
  const page = shell ? <ThemeModeProvider><RouterProvider router={router} /></ThemeModeProvider> : <RouterProvider router={router} />;
  if (queryClient !== undefined) {
    return { queryClient, ...render(<QueryClientProvider client={queryClient}>{page}</QueryClientProvider>) };
  }
  return renderWithProviders(page);
};

const discussionPost = (id: string, body: string): DiscussionPost => ({
  id,
  tenantId: 't1',
  contextKind: 'lesson',
  contextId: 'l1',
  parentPostId: null,
  rootPostId: id,
  isOwn: false,
  authorDisplay: 'Olivia Author',
  authorIsStaff: false,
  authorAvatarUrl: null,
  body,
  bodyFormat: 'plain',
  bodyHtml: body,
  bodyPlainText: body,
  createdAt: '2026-08-15T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  replies: [],
  replyCount: 0,
});

const renderLessonRoute = async (initialEntry: string, queryClient?: QueryClient) => {
  const rootRoute = createRootRoute();
  const LessonRouteComponent = () => {
    const params = useParams({ strict: false });
    const { thread } = useSearch({ strict: false });
    return (
      <LessonPlayerPage
        courseId={params.courseId ?? ''}
        lessonId={params.lessonId ?? ''}
        threadRootPostId={thread ?? null}
      />
    );
  };
  const lessonRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/my/courses/$courseId/lessons/$lessonId',
    validateSearch: (search: Record<string, unknown>): { thread?: string } =>
      typeof search['thread'] === 'string' ? { thread: search['thread'] } : {},
    component: LessonRouteComponent,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([lessonRoute]),
    history: createMemoryHistory({
      initialEntries: [initialEntry],
    }),
  });
  await router.load();
  if (queryClient === undefined) renderWithProviders(<RouterProvider router={router} />);
  else render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
};

describe('LessonPlayerPage', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
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
      http.get('/api/member/settings', () =>
        HttpResponse.json({
          ok: true,
          data: {
            settings: {
              billingPortalUrl: null,
              supportUrl: null, supportConfigured: false,
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

  it('shows only the badge for a lesson whose one reader edition is the live content', async () => {
    server.use(okLesson([]), okStructure(), okProgress(),
      http.get('/api/student/lessons/:lessonId/editions', () => HttpResponse.json({
        ok: true,
        data: { editions: [{ number: '2.1', note: null, markedAt: '2026-10-01T12:00:00.000Z', matchesLive: true }], currentEdition: '2.1' },
      })),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    expect(await screen.findByTestId('lesson-edition-badge')).toHaveTextContent('Edition 2.1');
    expect(screen.queryByRole('button', { name: /Edition 2.1/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('lesson-edition-banner')).not.toBeInTheDocument();
  });

  it('offers the current version beside an edition the live lesson no longer matches', async () => {
    server.use(okLesson([]), okStructure(), okProgress(),
      http.get('/api/student/lessons/:lessonId/editions', () => HttpResponse.json({
        ok: true,
        data: { editions: [{ number: '2.1', note: null, markedAt: '2026-10-01T12:00:00.000Z', matchesLive: false }], currentEdition: null },
      })),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    expect(await screen.findByRole('button', { name: en.lesson.editionCurrentVersion })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByTestId('lesson-edition-banner')).not.toBeInTheDocument();
  });

  it('shows no banner on the edition URL whose content equals the live lesson', async () => {
    server.use(okStructure(), okProgress(), okLesson([]),
      http.get('/api/student/lessons/l1/editions/2.1', () => HttpResponse.json({
        ok: true,
        data: { lesson: lesson([{ type: 'html', html: '<p>Same as live</p>' }]), authenticated: true },
      })),
      http.get('/api/student/lessons/:lessonId/editions', () => HttpResponse.json({
        ok: true,
        data: { editions: [{ number: '2.1', note: null, markedAt: '2026-10-01T12:00:00.000Z', matchesLive: true }], currentEdition: '2.1' },
      })),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" editionNumber="2.1" />);
    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Same as live');
    expect(await screen.findByTestId('lesson-edition-badge')).toHaveTextContent('Edition 2.1');
    expect(screen.queryByTestId('lesson-edition-banner')).not.toBeInTheDocument();
  });

  it.each(['2', '1'])('shows no banner on edition %s when two identical editions both equal the live lesson', async (number) => {
    server.use(okStructure(), okProgress(), okLesson([]),
      http.get(`/api/student/lessons/l1/editions/${number}`, () => HttpResponse.json({
        ok: true,
        data: { lesson: lesson([{ type: 'html', html: '<p>Same as live</p>' }]), authenticated: true },
      })),
      http.get('/api/student/lessons/:lessonId/editions', () => HttpResponse.json({
        ok: true,
        data: { editions: ['2', '1'].map((edition) => ({ number: edition, note: null, markedAt: '2026-10-01T12:00:00.000Z', matchesLive: true })), currentEdition: '2' },
      })),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" editionNumber={number} />);
    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Same as live');
    expect(await screen.findByTestId('lesson-edition-badge')).toHaveTextContent(`Edition ${number}`);
    expect(screen.queryByTestId('lesson-edition-banner')).not.toBeInTheDocument();
  });

  it('renders selected edition content while completion and discussion remain on the lesson', async () => {
    const completions: unknown[] = [];
    const discussions: string[] = [];
    server.use(okStructure(), okProgress(), okLesson([]),
      http.get('/api/student/lessons/l1/editions/2.1', () => HttpResponse.json({
        ok: true,
        data: { lesson: lesson([{ type: 'html', html: '<p>Earlier chapter content</p>' }]), authenticated: true },
      })),
      http.get('/api/student/lessons/:lessonId/editions', () => HttpResponse.json({
        ok: true,
        data: { editions: [{ number: '2.1', note: null, markedAt: '2026-10-01T12:00:00.000Z', matchesLive: false }], currentEdition: null },
      })),
      http.get('/api/discussion', ({ request }) => {
        discussions.push(new URL(request.url).searchParams.get('contextId') ?? '');
        return HttpResponse.json({ ok: true, data: { discussion: { threads: [], nextCursor: null, viewerSubscriptions: {} } } });
      }),
      http.post('/api/student/lessons/complete', async ({ request }) => {
        completions.push(await request.json());
        return HttpResponse.json({ ok: true, data: { progress: progress(['l1']) } });
      }),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" editionNumber="2.1" />);
    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Earlier chapter content');
    expect(await screen.findByTestId('lesson-edition-banner')).toHaveTextContent('This is edition 2.1 from October 1, 2026. It differs from the current lesson.');
    await userEvent.click(await screen.findByTestId('mark-complete'));
    await waitFor(() => expect(completions).toEqual([{ lessonId: 'l1' }]));
    expect(discussions).toContain('l1');
  });

  it('uses the lesson title with the tenant name', async () => {
    server.use(okLesson([]), okStructure(), okProgress());
    await renderPage(
      <DocumentTitleProvider tenantName="Acme">
        <LessonPlayerPage courseId="course-1" lessonId="l1" />
      </DocumentTitleProvider>,
    );
    await waitFor(() => expect(document.title).toBe('Intro to Variables · Acme'));
  });

  it('refreshes Start after visits A, B, then A, including a visit settled after unmount', async () => {
    let lastViewedLessonId = 'l1';
    let releaseVisit: () => void = () => undefined;
    const visitResponse = new Promise<void>((resolve) => { releaseVisit = resolve; });
    const recorded: string[] = [];
    const lessonReads: string[] = [];
    let structureReads = 0;
    const names: Record<string, string> = { l1: 'Lesson A', l2: 'Lesson B' };
    server.use(
      http.get('/api/my/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
      http.get('/api/student/courses/:courseId/structure', () => {
        structureReads += 1;
        return HttpResponse.json({ ok: true, data: { structure } });
      }),
      http.get('/api/student/lessons/:lessonId', ({ params }) => {
        lessonReads.push(String(params.lessonId));
        return HttpResponse.json({
          ok: true, data: { lesson: { ...lesson([]), id: String(params.lessonId), name: names[String(params.lessonId)] }, authenticated: true },
        });
      }),
      http.get('/api/student/progress', () => HttpResponse.json({
        ok: true, data: { progress: { ...progress([]), lastViewedLessonId, resume: {
          target: { id: lastViewedLessonId, name: names[lastViewedLessonId] },
          firstIncomplete: { id: 'l1', name: 'Lesson A' }, isReview: false,
        } } },
      })),
      http.get('/api/member/navigation', () => HttpResponse.json({
        ok: true, data: { navigation: { spaces: [], lockedSpaces: [], courses: [{
          courseId: 'course-1', courseName: 'Course', completedLessonCount: 0,
          accessibleLessonCount: 2, lastViewedLessonId, lastActivityAt: '2026-09-01T00:00:00.000Z',
        }] } },
      })),
      http.get('/api/student/courses', () => HttpResponse.json({ ok: true, data: { courses: [{
        id: 'course-1', tenantId: 't1', name: 'Course', description: '', imageUrl: null,
        moduleOrder: [], publiclyVisible: false, legacyId: null, createdAt: '2026-09-01T00:00:00.000Z',
      }] } })),
      http.post('/api/student/progress/last-viewed', async ({ request }) => {
        const input = updateLastViewedInputSchema.parse(await request.json());
        if (input.lessonId === 'l2') await visitResponse;
        lastViewedLessonId = input.lessonId ?? 'l1';
        recorded.push(lastViewedLessonId);
        return HttpResponse.json({ ok: true, data: { progress: { ...progress([]), lastViewedLessonId } } });
      }),
    );
    const root = createRootRoute();
    const startRoute = createRoute({ getParentRoute: () => root, path: '/start', component: StartPage });
    const lessonRoute = createRoute({
      getParentRoute: () => root, path: '/my/courses/$courseId/lessons/$lessonId',
      component: function VisitedLesson() {
        const params = useParams({ strict: false });
        return <LessonPlayerPage courseId={params.courseId ?? ''} lessonId={params.lessonId ?? ''} />;
      },
    });
    const router = createRouter({ routeTree: root.addChildren([startRoute, lessonRoute]), history: createMemoryHistory({ initialEntries: ['/start'] }) });
    await router.load();
    const { queryClient } = renderWithProviders(<RouterProvider router={router} />);
    queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: Infinity } });
    const invalidates = vi.spyOn(queryClient, 'invalidateQueries');
    await screen.findByTestId('start-continue');
    await act(() => router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId', params: { courseId: 'course-1', lessonId: 'l1' } }));
    await waitFor(() => expect(recorded).toEqual(['l1']));
    await waitFor(() => expect(invalidates).toHaveBeenCalledWith(actions.studentProgressInvalidates('course-1')));
    expect(invalidates).toHaveBeenCalledWith(actions.memberNavigationInvalidates());
    await act(() => router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId', params: { courseId: 'course-1', lessonId: 'l2' } }));
    await screen.findByRole('heading', { name: 'Lesson B' });
    await act(() => router.navigate({ to: '/start' }));
    await screen.findByTestId('start-continue');
    releaseVisit();
    await waitFor(() => expect(screen.getByTestId('start-continue')).toHaveTextContent(en.start.continueLabel({ lesson: 'Lesson B' })));
    expect(screen.getByTestId('start-continue-cta')).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    await act(() => router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId', params: { courseId: 'course-1', lessonId: 'l1' } }));
    await waitFor(() => expect(recorded).toEqual(['l1', 'l2', 'l1']));
    await act(() => router.navigate({ to: '/start' }));
    await waitFor(() => expect(screen.getByTestId('start-continue')).toHaveTextContent(en.start.continueLabel({ lesson: 'Lesson A' })));
    expect(screen.getByTestId('start-continue-cta')).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    expect(lessonReads).toEqual(['l1', 'l2']);
    expect(structureReads).toBe(1);
  });

  it('uses the in-shell skeleton while lesson data loads', async () => {
    let releaseResponse: () => void = () => undefined;
    const response = new Promise<void>((resolve) => { releaseResponse = resolve; });
    server.use(okStructure(), okProgress(), http.get('/api/student/lessons/:lessonId', async () => {
      await response;
      return HttpResponse.json({ ok: true, data: { lesson: lesson(allBlocks), authenticated: true } });
    }));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const loading = screen.getByTestId('course-loading');
    expect(within(loading).getByRole('status', { name: en.lesson.loading })).toHaveAttribute('aria-busy', 'true');
    expect(within(loading).getByRole('heading', { level: 1, name: en.lesson.loading })).toBeInTheDocument();
    expect(screen.queryByTestId('brand-loader-mark')).not.toBeInTheDocument();

    releaseResponse();
    expect(await screen.findByTestId('lesson-video')).toBeInTheDocument();
  });

  it('renders every typed block', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    const { container } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l1" />,
    );

    const video = await screen.findByTestId('lesson-video');
    expect(video).toHaveAttribute(
      'src',
      'https://iframe.mediadelivery.net/embed/424242/vid-1?autoplay=false&preload=false',
    );
    expect(video).toHaveAttribute('allowfullscreen');

    expect(screen.getByTestId('lesson-pdf')).toHaveAttribute(
      'src',
      'https://cdn.example.com/slides.pdf',
    );
    expect(screen.getByRole('link', { name: en.lesson.openPdf })).toHaveAttribute(
      'href',
      'https://cdn.example.com/slides.pdf',
    );

    expect(screen.getByTestId('lesson-embed')).toHaveAttribute(
      'src',
      'https://example.com/embed',
    );

    const htmlBlock = screen.getByTestId('lesson-html');
    expect(htmlBlock).toHaveTextContent('Safe body');
    expect(within(htmlBlock).queryByText('window.__xss = 1;')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="lesson-html"] script')).toBeNull();

    expect(screen.getByTestId('link-icon-github')).toBeInTheDocument();
    expect(screen.getByTestId('link-icon-external')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Course repo/ })).toHaveAttribute(
      'href',
      'https://github.com/acme/repo',
    );
  });

  it('renders blocks in the saved lesson order', async () => {
    const savedOrder: LessonBlock[] = [
      { type: 'link', url: 'https://example.com/start' },
      { type: 'html', html: '<p>Context</p>' },
      { type: 'video', storageKey: 'k1', streamVideoId: 'vid-1' },
      { type: 'pdf', pdfUrl: 'https://example.com/notes.pdf' },
    ];
    server.use(okStructure(), okProgress(), okLesson(savedOrder));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('lesson-video-placeholder');
    expect(screen.getAllByTestId(/lesson-block-/u).map((node) => node.dataset.blockType)).toEqual([
      'links',
      'html',
      'video',
      'pdf',
    ]);
  });

  it('renders an embeddable link as a sandboxed editor with a new-tab link', async () => {
    const sandboxUrl = 'https://codesandbox.io/embed/github/acme-courses/task-1?autoresize=1';
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'link', url: sandboxUrl, description: 'Task 1 - flexbox' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const sandbox = await screen.findByTestId('lesson-sandbox');
    expect(sandbox).toHaveAttribute('src', sandboxUrl);
    expect(sandbox).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-modals',
    );
    expect(sandbox).toHaveAttribute('loading', 'lazy');
    expect(sandbox).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(sandbox).toHaveAttribute('title', 'Task 1 - flexbox');
    expect(screen.getByTestId('lesson-sandbox-caption')).toHaveTextContent('Task 1 - flexbox');
    expect(screen.getByTestId('lesson-media-skeleton')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: `${en.lesson.openInNewTab} — Task 1 - flexbox` }),
    ).toHaveAttribute('href', 'https://codesandbox.io/s/github/acme-courses/task-1?autoresize=1');
    expect(screen.getByTestId('lesson-block-0')).toHaveTextContent(
      en.lesson.labelSandbox({ provider: 'CodeSandbox' }),
    );
  });

  it('mounts a collapsed sandbox only after the reader expands it, and collapses it again', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'embed', embedUrl: 'https://codesandbox.io/s/alert-demo', collapsed: true }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const toggle = await screen.findByTestId('lesson-embed-toggle');
    expect(screen.getByTestId('lesson-embed-collapsed-warning')).toHaveTextContent(
      en.lesson.collapsedEmbedWarning,
    );
    expect(toggle).toHaveTextContent(en.lesson.expandEmbed);
    expect(screen.queryByTestId('lesson-sandbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: `${en.lesson.openInNewTab} — CodeSandbox / alert-demo` }),
    ).toBeInTheDocument();

    await userEvent.click(toggle);

    expect(await screen.findByTestId('lesson-sandbox')).toHaveAttribute(
      'src',
      'https://codesandbox.io/embed/alert-demo',
    );
    expect(screen.queryByTestId('lesson-embed-collapsed-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('lesson-embed-toggle')).toHaveTextContent(en.lesson.collapseEmbed);

    await userEvent.click(screen.getByTestId('lesson-embed-toggle'));

    expect(screen.queryByTestId('lesson-sandbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('lesson-embed-collapsed-warning')).toBeInTheDocument();
  });

  it('mounts a sandbox straight away when the embed is not collapsed', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'embed', embedUrl: 'https://codesandbox.io/s/alert-demo' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-sandbox')).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-embed-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lesson-embed-collapsed-warning')).not.toBeInTheDocument();
  });

  it('collapses a non-sandbox embed the author marked as collapsed', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'embed', embedUrl: 'https://example.com/embed', collapsed: true }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(screen.queryByTestId('lesson-embed')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('lesson-embed-toggle'));

    expect(await screen.findByTestId('lesson-embed')).toHaveAttribute('src', 'https://example.com/embed');
  });

  it('bleeds the sandbox past the lesson card on a phone and boxes it in from sm up', async () => {
    const phone = 375;
    const tablet = 600;
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'link', url: 'https://codesandbox.io/s/abc123' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const frame = (await screen.findByTestId('lesson-sandbox')).parentElement?.parentElement;
    expect(stylesAt(frame, phone)).toMatchObject({
      height: '70vh',
      'max-height': 'max(60vh, 100vh - 14rem)',
      width: 'auto',
      'margin-left': '-0.75rem',
      'margin-right': '-0.75rem',
    });
    expect(stylesAt(frame, phone)).not.toHaveProperty('min-height');
    expect(stylesAt(frame, tablet)).toMatchObject({
      height: '70vh',
      'max-height': 'max(60vh, 100vh - 14rem)',
      'min-height': 'min(600px, max(60vh, 100vh - 14rem))',
      'margin-left': '0px',
      'margin-right': '0px',
    });

    const card = screen.getByTestId('lesson-block-0');
    expect(stylesAt(card, phone)).toMatchObject({
      'padding-left': '0.75rem',
      'padding-right': '0.75rem',
      'padding-top': '1rem',
      'margin-left': '-0.5rem',
      'margin-right': '-0.5rem',
    });
    expect(stylesAt(card, tablet)).toMatchObject({
      'padding-left': '1.5rem',
      'padding-top': '1.5rem',
      'margin-left': '0px',
      'margin-right': '0px',
    });
  });

  it('tells two captionless sandboxes apart by their frame title and link name', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'embed', embedUrl: 'https://codesandbox.io/s/flexbox-task-1' },
        { type: 'embed', embedUrl: 'https://codesandbox.io/s/grid-task-2' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findAllByTestId('lesson-sandbox');
    expect(screen.getAllByTestId('lesson-sandbox').map((frame) => frame.getAttribute('title'))).toEqual([
      'CodeSandbox / flexbox-task-1',
      'CodeSandbox / grid-task-2',
    ]);
    expect(screen.queryByTestId('lesson-sandbox-caption')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: `${en.lesson.openInNewTab} — CodeSandbox / grid-task-2` }),
    ).toHaveAttribute('href', 'https://codesandbox.io/s/grid-task-2');
  });

  it('opens a mailto link in the mail app rather than a new tab', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'link', url: 'mailto:teacher@example.com', description: 'Email the instructor' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const mailLink = await screen.findByRole('link', {
      name: `Email the instructor ${en.lesson.mailHint}`,
    });
    expect(mailLink).toHaveAttribute('href', 'mailto:teacher@example.com');
    expect(mailLink).not.toHaveAttribute('target');
    expect(mailLink).not.toHaveAttribute('rel');
  });

  it('keeps an html block beside a sandbox that points at the same editor', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: 'https://codesandbox.io/embed/abc123', description: 'Task' },
        { type: 'html', html: '<p><a href="https://codesandbox.io/s/abc123">sandbox</a></p>' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('lesson-sandbox');
    expect(screen.getAllByTestId(/lesson-block-/u).map((node) => node.dataset.blockType)).toEqual([
      'sandbox',
      'html',
    ]);
    expect(screen.getByTestId('lesson-sandbox-caption')).toHaveTextContent('Task');
    expect(screen.getByTestId('lesson-html')).toHaveTextContent('sandbox');
  });

  it('merges consecutive links into one section without raw URLs', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: 'https://github.com/acme-courses/task-1', description: 'GitHub' },
        { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/HTML' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const section = await screen.findByTestId('lesson-block-0');
    expect(screen.getAllByTestId(/lesson-block-/u)).toHaveLength(1);
    expect(section.dataset.blockType).toBe('links');
    expect(within(section).getByText(en.lesson.linksHeading)).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    const links = within(section).getAllByRole('link');
    expect(links[0]).toHaveAttribute('title', 'https://github.com/acme-courses/task-1');
    expect(links[0]).toHaveAccessibleName(`GitHub ${en.lesson.newTabHint}`);
    expect(links[1]).toHaveAccessibleName(`developer.mozilla.org ${en.lesson.newTabHint}`);
    expect(section.textContent).not.toContain('https://');
    expect(section.textContent).not.toContain('/acme-courses/');
  });

  it('keeps description-less links on one host distinguishable', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: 'https://github.com/acme-courses/one' },
        { type: 'link', url: 'https://github.com/acme-courses/two' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const section = await screen.findByTestId('lesson-block-0');
    const names = within(section)
      .getAllByRole('link')
      .map((node) => node.getAttribute('title'));
    expect(names).toEqual(['https://github.com/acme-courses/one', 'https://github.com/acme-courses/two']);
    expect(within(section).getByRole('link', { name: `github.com / one ${en.lesson.newTabHint}` })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: `github.com / two ${en.lesson.newTabHint}` })).toBeInTheDocument();
  });

  it('leaves a single-anchor html block as html beside a link chip on the same target', async () => {
    const repoUrl = 'https://github.com/acme-courses/frontend--html-css-flexbox--task-1';
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: repoUrl, description: 'GitHub' },
        { type: 'html', html: `<p><a href="${repoUrl}" target="_blank">repository</a></p>` },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const section = await screen.findByTestId('lesson-block-0');
    expect(screen.getAllByTestId(/lesson-block-/u).map((node) => node.dataset.blockType)).toEqual([
      'links',
      'html',
    ]);
    const chips = within(section).getAllByRole('link');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('GitHub');
    expect(chips[0]).toHaveAttribute('href', repoUrl);
    const authored = within(screen.getByTestId('lesson-html')).getByRole('link');
    expect(authored).toHaveAttribute('href', repoUrl);
    expect(authored).not.toHaveAttribute('target');
  });

  it('renders every repeated link block the author placed', async () => {
    const repoUrl = 'https://github.com/acme-courses/task-1';
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: repoUrl, description: 'GitHub' },
        { type: 'link', url: repoUrl },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const section = await screen.findByTestId('lesson-block-0');
    expect(within(section).getAllByRole('link').map((node) => node.textContent)).toEqual([
      'GitHub',
      'github.com',
    ]);
  });

  it('keeps links separated by another block in their own sections', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: 'https://example.com/first', description: 'First' },
        { type: 'html', html: '<p>Notes</p><p>More</p>' },
        { type: 'link', url: 'https://example.com/second', description: 'Second' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('lesson-html');
    expect(screen.getAllByTestId(/lesson-block-/u).map((node) => node.dataset.blockType)).toEqual([
      'links',
      'html',
      'links',
    ]);
  });

  it('opens a preview in a fresh cache after the session expires without a member-query alert', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    let releaseIdentity: () => void = () => undefined;
    const identityReady = new Promise<void>((resolve) => { releaseIdentity = resolve; });
    const rejectMember = () => HttpResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 },
    );
    const structureRequest = vi.fn(rejectMember);
    server.use(
      http.get('/api/me', async () => { await identityReady; return rejectMember(); }),
      http.get('/api/student/courses/:courseId/structure', structureRequest),
      http.get('/api/student/lessons/:lessonId', () => HttpResponse.json({
        ok: true, data: { lesson: { ...lesson([{ type: 'html', html: '<p>Preview body</p>' }]), isPreview: true }, authenticated: false },
      })),
    );

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />, queryClient, true);
    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Preview body');
    await act(async () => releaseIdentity());
    expect(await screen.findByRole('link', { name: en.auth.signInLink })).toBeInTheDocument();
    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Preview body');
    expect(screen.queryAllByText(en.errors.messageUnauthorized)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument();
    expect(structureRequest).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(actions.me.queryKey)).toBeUndefined();
  });

  it('preserves a valid foreign-workspace identity and account actions on a preview', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'localhost');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    server.use(
      okStructure(), okProgress(),
      http.get('/api/me', () => HttpResponse.json({
        ok: true, data: { userId: 'visitor', email: 'visitor@example.com', emailVerified: true, name: 'Visitor', tenantAccess: 'none', tenant: null },
      })),
      http.get('/api/student/lessons/:lessonId', () => HttpResponse.json({
        ok: true, data: { lesson: { ...lesson([{ type: 'html', html: '<p>Preview body</p>' }]), isPreview: true }, authenticated: false },
      })),
    );
    const identity = await queryClient.fetchQuery(actions.me);

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />, queryClient, true);
    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Preview body');
    expect(screen.getByTestId('foreign-tenant-notice')).toHaveTextContent('visitor@example.com');
    expect(screen.getByRole('link', { name: en.tenant.visitorOwnCommunity })).toHaveAttribute('href', expect.stringContaining('start.localhost'));
    expect(screen.getByRole('button', { name: en.tenant.visitorSwitchAccount })).toBeInTheDocument();
    expect(queryClient.getQueryData(actions.me.queryKey)).toEqual(identity);
  });

  it('keeps the optimistic member queries while a valid session lesson loads', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const identity = await queryClient.fetchQuery(actions.me);
    let resolveResponse: (response: Response) => void = () => undefined;
    const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    server.use(http.get('/api/student/lessons/:lessonId', async () => (await response).clone()), okStructure(), okProgress());

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />, queryClient);
    await waitFor(() => expect(queryClient.getQueryState(actions.courseStructure('course-1').queryKey)?.status).toBe('success'));
    expect(screen.queryByTestId('lesson-html')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(actions.me.queryKey)).toEqual(identity);
    await act(async () => resolveResponse(HttpResponse.json({
      ok: true, data: { lesson: lesson([{ type: 'html', html: '<p>Member body</p>' }]), authenticated: true },
    })));

    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Member body');
    expect(await screen.findByTestId('mark-complete')).toBeInTheDocument();
    expect(screen.queryAllByText(en.errors.messageUnauthorized)).toHaveLength(0);
    expect(queryClient.getQueryData(actions.me.queryKey)).toEqual(identity);
  });

  it('redirects a guest on a non-preview lesson to sign in', async () => {
    server.use(http.get('/api/student/lessons/:lessonId', () => HttpResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 },
    )));
    const root = createRootRoute();
    const lessonRoute = createRoute({
      getParentRoute: () => root, path: '/my/courses/course-1/lessons/l1',
      component: () => <LessonPlayerPage courseId="course-1" lessonId="l1" />,
    });
    const loginRoute = createRoute({ getParentRoute: () => root, path: '/login', component: () => <p>{en.auth.signInLink}</p> });
    const router = createRouter({
      routeTree: root.addChildren([lessonRoute, loginRoute]),
      history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
    });
    await router.load();
    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(en.auth.signInLink)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.searchStr).toContain('returnTo=');
  });

  it('renders an anonymous preview without member-only requests or controls', async () => {
    let memberOnlyRequests = 0;
    const countMemberOnly = () => {
      memberOnlyRequests += 1;
      return HttpResponse.json(
        { ok: false, error: { code: 'unauthorized', message: 'Sign in' } },
        { status: 401 },
      );
    };
    server.use(
      http.get('/api/student/lessons/:lessonId', () => HttpResponse.json({
        ok: true,
        data: {
          lesson: { ...lesson([{ type: 'html', html: '<p>Preview body</p>' }, { type: 'video', storageKey: 'preview-video', streamVideoId: 'preview-video' }]), isPreview: true },
          authenticated: false,
        },
      })),
      http.get('/api/me', countMemberOnly),
      http.get('/api/student/lessons/:lessonId/playback', countMemberOnly),
      http.get('/api/student/courses/:courseId/structure', countMemberOnly),
      http.get('/api/student/progress', countMemberOnly),
      http.get('/api/discussion', countMemberOnly),
      http.post('/api/student/progress/last-viewed', countMemberOnly),
    );

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Preview body');
    expect(screen.getByTestId('lesson-video-placeholder')).toHaveTextContent(en.lesson.videoPlaceholder);
    expect(screen.queryByText(en.lesson.videoFailedTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument();
    expect(screen.queryByTestId('mark-complete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('discussion-section')).not.toBeInTheDocument();
    expect(memberOnlyRequests).toBe(0);
  });

  it('adds deterministic heading ids and scrolls anonymous previews to the hash', async () => {
    stubDesktopViewport();
    window.history.replaceState(null, '', '/#zolc-laka-2');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    server.use(
      http.get('/api/student/lessons/:lessonId', () => HttpResponse.json({
        ok: true,
        data: {
          lesson: {
            ...lesson([
              { type: 'html', html: '<h2 id="author-id">\u017b\u00f3\u0142\u0107 \u0141\u0105ka</h2>' },
              { type: 'html', html: '<h3>\u017b\u00f3\u0142\u0107, \u0141\u0105ka!</h3><h3>Next section</h3><h3>Forms</h3><h3>Cookie</h3>' },
            ]),
            isPreview: true,
          },
          authenticated: false,
        },
      })),
    );

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const first = await screen.findByRole('heading', { name: '\u017b\u00f3\u0142\u0107 \u0141\u0105ka' });
    const duplicate = screen.getByRole('heading', { name: '\u017b\u00f3\u0142\u0107, \u0141\u0105ka!' });
    const next = screen.getByRole('heading', { name: 'Next section' });
    expect(first).toHaveAttribute('id', 'zolc-laka');
    expect(duplicate).toHaveAttribute('id', 'zolc-laka-2');
    expect(next).toHaveAttribute('id', 'next-section');
    expect(screen.getByRole('heading', { name: 'Forms' })).toHaveAttribute('id', 'forms-section');
    expect(screen.getByRole('heading', { name: 'Cookie' })).toHaveAttribute('id', 'cookie-section');
    expect(stylesAt(duplicate, 1440)).toMatchObject({
      'scroll-margin-top': 'calc(var(--member-app-bar-height, 52px) + 1rem)',
    });
    await waitFor(() => expect(scrollIntoView.mock.instances).toContain(duplicate));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    window.history.replaceState(null, '', '/#next-section');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(scrollIntoView.mock.instances).toContain(next));
  });

  it('expands only the deep-linked long block before scrolling, including later hash changes', async () => {
    stubDesktopViewport();
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200);
    window.history.replaceState(null, '', '/#second-section');
    const collapsedWhenScrolled: (string | null | undefined)[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      collapsedWhenScrolled.push(this.closest('[data-collapsed]')?.getAttribute('data-collapsed'));
    });
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'embed', embedUrl: 'https://example.com/embed' },
        { type: 'html', html: '<h2>First section</h2><p>First body.</p>' },
        { type: 'html', html: '<h2>Second section</h2><p>Second body.</p>' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    await waitFor(() => expect(collapsedWhenScrolled).toEqual(['false']));
    const previews = screen.getAllByTestId('lesson-reading-preview');
    expect(previews[0]).toHaveAttribute('data-collapsed', 'true');
    expect(previews[1]).toHaveAttribute('data-collapsed', 'false');
    window.history.replaceState(null, '', '/#first-section');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(collapsedWhenScrolled).toEqual(['false', 'false']));
    expect(previews[0]).toHaveAttribute('data-collapsed', 'false');
  });

  it('starts a text-first lesson expanded and keeps later long text collapsed', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200);
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'html', html: '<h2>Opening</h2><p>Opening body.</p>' },
        { type: 'embed', embedUrl: 'https://example.com/embed' },
        { type: 'html', html: '<h2>Later</h2><p>Later body.</p>' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByRole('heading', { name: 'Later' });
    const previews = screen.getAllByTestId('lesson-reading-preview');
    expect(previews[0]).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByRole('button', { name: en.lesson.collapseText })).toHaveAttribute('aria-controls', previews[0]?.id);
    expect(previews[1]).toHaveAttribute('data-collapsed', 'true');
    expect(readLessonTextAutoExpand()).toBe(false);
  });

  it('scrolls to the hash after authenticated lesson content mounts', async () => {
    stubDesktopViewport();
    window.history.replaceState(null, '', '/#late-section');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    let settingsRequested = false;
    let releaseSettings: () => void = () => undefined;
    const settingsGate = new Promise<void>((resolve) => {
      releaseSettings = resolve;
    });
    server.use(
      http.get('/api/member/settings', async () => {
        settingsRequested = true;
        await settingsGate;
        return HttpResponse.json({
          ok: true,
          data: {
            settings: {
              billingPortalUrl: null,
              supportUrl: null, supportConfigured: false,
              videoAutoplayDefault: false,
              memberVideoAutoplayOverride: false,
            },
          },
        });
      }),
      okStructure(),
      okProgress(),
      okLesson([{ type: 'html', html: '<h2>Late section</h2>' }]),
    );

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await waitFor(() => expect(settingsRequested).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Late section' })).not.toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => releaseSettings());
    await screen.findByRole('heading', { name: 'Late section' });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.instances[0]).toHaveAttribute('id', 'late-section');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('reveals the loaded lesson after placeholder navigation with unchanged heading ids', async () => {
    stubDesktopViewport();
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200);
    const scrolled: { body: string | null; collapsed: string | null | undefined }[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push({ body: this.parentElement?.textContent ?? null, collapsed: this.closest('[data-collapsed]')?.getAttribute('data-collapsed') });
    });
    let releaseLesson: () => void = () => undefined;
    const lessonGate = new Promise<void>((resolve) => { releaseLesson = resolve; });
    server.use(
      okStructureOf(structureOf([entry('l1', 'First lesson'), entry('l2', 'Second lesson', false)])),
      okProgress(),
      http.get('/api/student/lessons/:lessonId', async ({ params }) => {
        const id = String(params.lessonId);
        if (id === 'l2') await lessonGate;
        return HttpResponse.json({ ok: true, data: {
          lesson: { ...lesson([{ type: 'html', html: `<h2>Shared section</h2><p>${id === 'l1' ? 'First body.' : 'Second body.'}</p>` }]), id },
          authenticated: true,
        } });
      }),
    );
    const root = createRootRoute();
    const lessonRoute = createRoute({
      getParentRoute: () => root, path: '/my/courses/$courseId/lessons/$lessonId',
      component: function NavigatedLesson() {
        const params = useParams({ strict: false });
        return <LessonPlayerPage courseId={params.courseId ?? ''} lessonId={params.lessonId ?? ''} />;
      },
    });
    const router = createRouter({
      routeTree: root.addChildren([lessonRoute]),
      history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
    });
    await router.load();
    renderWithProviders(<RouterProvider router={router} />);
    await screen.findByTestId('lesson-html');
    window.history.replaceState(null, '', '/#shared-section');

    await act(() => router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId', params: { courseId: 'course-1', lessonId: 'l2' } }));
    await screen.findByTestId('lesson-transition-loading');
    expect(scrolled).toEqual([]);
    await act(async () => releaseLesson());

    await waitFor(() => expect(scrolled).toEqual([{ body: 'Shared sectionSecond body.', collapsed: 'false' }]));
    expect(screen.getByTestId('lesson-reading-preview')).toHaveAttribute('data-collapsed', 'false');
  });

  it('reveals the same anchor when navigating between cached editions', async () => {
    stubDesktopViewport();
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200);
    const scrolled: { body: string | null; collapsed: string | null | undefined }[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push({ body: this.parentElement?.textContent ?? null, collapsed: this.closest('[data-collapsed]')?.getAttribute('data-collapsed') });
    });
    server.use(
      okStructureOf(structureOf([entry('l1', 'Intro to Variables')])),
      okProgress(),
      http.get('/api/public/offer', () => HttpResponse.json({
        ok: true, data: { tenant: { slug: 'acme', name: 'Acme', socialLinks: [] }, products: [], contentVersion: 1 },
      })),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    for (const number of ['2.1', '2.2']) {
      queryClient.setQueryData(actions.studentLessonEdition('l1', number).queryKey, {
        lesson: lesson([{ type: 'html', html: `<h2>Shared section</h2><p>Edition ${number} body.</p>` }]),
        authenticated: true,
      });
    }
    const root = createRootRoute();
    const lessonRoute = createRoute({
      getParentRoute: () => root, path: '/my/courses/$courseId/lessons/$lessonId/editions/$number',
      component: function CachedEdition() {
        const params = useParams({ strict: false });
        return <LessonPlayerPage courseId={params.courseId ?? ''} lessonId={params.lessonId ?? ''} editionNumber={params.number} />;
      },
    });
    const router = createRouter({
      routeTree: root.addChildren([lessonRoute]),
      history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1/editions/2.1'] }),
    });
    await router.load();
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
    await screen.findByTestId('lesson-html');
    window.history.replaceState(null, '', '/#shared-section');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(scrolled).toEqual([{ body: 'Shared sectionEdition 2.1 body.', collapsed: 'false' }]));

    await act(() => router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId/editions/$number', params: { courseId: 'course-1', lessonId: 'l1', number: '2.2' } }));
    await waitFor(() => expect(scrolled).toEqual([
      { body: 'Shared sectionEdition 2.1 body.', collapsed: 'false' },
      { body: 'Shared sectionEdition 2.2 body.', collapsed: 'false' },
    ]));
    expect(screen.getByTestId('lesson-reading-preview')).toHaveAttribute('data-collapsed', 'false');

    await act(() => router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId/editions/$number', params: { courseId: 'course-1', lessonId: 'l1', number: '2.1' } }));
    await waitFor(() => expect(scrolled).toHaveLength(3));
    expect(scrolled[2]).toEqual({ body: 'Shared sectionEdition 2.1 body.', collapsed: 'false' });
    expect(screen.getByTestId('lesson-reading-preview')).toHaveAttribute('data-collapsed', 'false');
  });

  it('does not scroll back to the same heading after lesson data refetches', async () => {
    stubDesktopViewport();
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    let reads = 0;
    server.use(
      okStructure(),
      okProgress(),
      http.get('/api/student/lessons/:lessonId', () => {
        reads += 1;
        return HttpResponse.json({
          ok: true,
          data: {
            lesson: lesson([
              { type: 'html', html: '<h2>Stable heading</h2>' },
              {
                type: 'video',
                storageKey: 'video',
                streamVideoId: 'video',
                embedUrl: `https://video.example.test/embed?signature=${String(reads)}`,
              },
            ]),
            authenticated: true,
          },
        });
      }),
    );

    const view = await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    await screen.findByRole('heading', { name: 'Stable heading' });
    window.history.replaceState(null, '', '/#stable-heading');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    const readsBeforeRefetch = reads;
    await view.queryClient.invalidateQueries(actions.studentLesson('l1'));
    await waitFor(() => expect(reads).toBeGreaterThan(readsBeforeRefetch));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('uses automatic hash scrolling when reduced motion is preferred', async () => {
    stubDesktopViewport(true);
    window.history.replaceState(null, '', '/#accessible-section');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    server.use(
      http.get('/api/student/lessons/:lessonId', () => HttpResponse.json({
        ok: true,
        data: {
          lesson: {
            ...lesson([{ type: 'html', html: '<h2>Accessible section</h2>' }]),
            isPreview: true,
          },
          authenticated: false,
        },
      })),
    );

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const heading = await screen.findByRole('heading', { name: 'Accessible section' });
    await waitFor(() => expect(scrollIntoView.mock.instances).toContain(heading));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('uses a signed Bunny embed url returned by the lesson endpoint', async () => {
    const embedUrl =
      'https://iframe.mediadelivery.net/embed/424242/vid-1?token=signed-token&expires=1782900000';
    const videoBlock = allBlocks[0];
    if (videoBlock === undefined || videoBlock.type !== 'video') throw new Error('missing video block');
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ ...videoBlock, embedUrl }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-video')).toHaveAttribute(
      'src',
      `${embedUrl}&autoplay=false&preload=false`,
    );
  });

  it('uses the member preference when the creator allows an override', async () => {
    const videoBlock = allBlocks[0];
    if (videoBlock === undefined || videoBlock.type !== 'video') throw new Error('missing video block');
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: {
            userId: 'u1',
            email: 'user@example.com',
            emailVerified: true,
            name: 'John Participant',
            tenant: {
              id: 't1',
              slug: 'acme',
              name: 'Acme',
              staffRole: null,
              memberId: 'mem-1',
              banned: false,
              videoAutoplay: true,
            },
          },
        }),
      ),
      http.get('/api/member/settings', () =>
        HttpResponse.json({
          ok: true,
          data: {
            settings: {
              billingPortalUrl: null,
              supportUrl: null, supportConfigured: false,
              videoAutoplayDefault: false,
              memberVideoAutoplayOverride: true,
            },
          },
        }),
      ),
      okStructure(),
      okProgress(),
      okLesson([{ ...videoBlock, embedUrl: 'https://iframe.mediadelivery.net/embed/424242/vid-1?autoplay=false&preload=false' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await waitFor(() =>
      expect(screen.getByTestId('lesson-video')).toHaveAttribute(
        'src',
        'https://iframe.mediadelivery.net/embed/424242/vid-1?autoplay=true&preload=true',
      ));
  });

  it('waits for the autoplay policy before mounting a video', async () => {
    let settingsRequested = false;
    let releaseSettings: () => void = () => undefined;
    const settingsGate = new Promise<void>((resolve) => {
      releaseSettings = resolve;
    });
    const videoBlock = allBlocks[0];
    if (videoBlock === undefined || videoBlock.type !== 'video') throw new Error('missing video block');
    server.use(
      http.get('/api/member/settings', async () => {
        settingsRequested = true;
        await settingsGate;
        return HttpResponse.json({
          ok: true,
          data: {
            settings: {
              billingPortalUrl: null,
              supportUrl: null, supportConfigured: false,
              videoAutoplayDefault: true,
              memberVideoAutoplayOverride: false,
            },
          },
        });
      }),
      okStructure(),
      okProgress(),
      okLesson([{ ...videoBlock, embedUrl: 'https://iframe.mediadelivery.net/embed/424242/vid-1' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await waitFor(() => expect(settingsRequested).toBe(true));
    expect(screen.queryByTestId('lesson-video')).not.toBeInTheDocument();
    releaseSettings();
    expect(await screen.findByTestId('lesson-video')).toHaveAttribute(
      'src',
      'https://iframe.mediadelivery.net/embed/424242/vid-1?autoplay=true&preload=true',
    );
  });

  it('shows a failed autoplay policy request beside the lesson', async () => {
    server.use(
      http.get('/api/member/settings', () =>
        HttpResponse.json({
          ok: false,
          error: { code: 'internal', message: 'boom' },
        }, { status: 500 })),
      okStructure(),
      okProgress(),
      okLesson(allBlocks),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByRole('button', { name: en.common.retry })).toBeInTheDocument();
    expect(screen.getByTestId('lesson-video')).toHaveAttribute(
      'src',
      'https://iframe.mediadelivery.net/embed/424242/vid-1?autoplay=false&preload=false',
    );
  });

  it('uses the tenant default when member overrides are disabled', async () => {
    const videoBlock = allBlocks[0];
    if (videoBlock === undefined || videoBlock.type !== 'video') throw new Error('missing video block');
    server.use(
      http.get('/api/member/settings', () =>
        HttpResponse.json({
          ok: true,
          data: {
            settings: {
              billingPortalUrl: null,
              supportUrl: null, supportConfigured: false,
              videoAutoplayDefault: true,
              memberVideoAutoplayOverride: false,
            },
          },
        }),
      ),
      okStructure(),
      okProgress(),
      okLesson([{ ...videoBlock, embedUrl: 'https://iframe.mediadelivery.net/embed/424242/vid-1' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await waitFor(() => expect(screen.getByTestId('lesson-video')).toHaveAttribute(
      'src',
      'https://iframe.mediadelivery.net/embed/424242/vid-1?autoplay=true&preload=true',
    ));
  });

  it('strips a script tag from html content', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'html', html: '<p>Hello</p><script>alert(1)</script>' }]),
    );
    const { container } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l1" />,
    );

    await screen.findByTestId('lesson-html');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByTestId('lesson-html')).toHaveTextContent('Hello');
  });

  it('shows a placeholder when the video has no embed url', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'video', storageKey: 'k1', streamVideoId: 'vid-1' }]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-video-placeholder')).toHaveTextContent(
      en.lesson.videoPlaceholder,
    );
    expect(screen.queryByTestId('lesson-video')).not.toBeInTheDocument();
  });

  it.each(['missing_library_id', 'secret_invalid'])('shows one member-facing line without a retry for unavailable video reason %s', async (reason) => {
    server.use(okStructure(), okProgress(), okLesson([{ type: 'video', storageKey: 'k1', streamVideoId: 'vid-1' }]),
      http.get('/api/student/lessons/:lessonId/playback', () => HttpResponse.json({ ok: true, data: {
        lessonId: 'l1', expiresAt: '2026-09-08T12:00:00.000Z', videos: [{ kind: 'unavailable', storageKey: 'k1', reason }],
      } })),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    expect(await screen.findByText(en.lesson.videoUnavailableNoContact)).toBeInTheDocument();
    expect(screen.queryByText(en.lesson.videoUnavailable)).not.toBeInTheDocument();
    expect(screen.queryByTestId('lesson-video-contact')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lesson-video')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument();
  });

  it.each([
    ['https://support.example.org/help', null, `${en.lesson.contactCreator} ${en.lesson.newTabHint}`],
    ['mailto:help@example.org', null, `${en.lesson.contactCreator} ${en.lesson.mailHint}`],
    [null, '/account?tab=profile&support=open', en.lesson.contactCreator],
    ['javascript:alert(1)', '/account?tab=profile&support=open', en.lesson.contactCreator],
  ] as const)('links the workspace contact %s from an unavailable video', async (supportUrl, formHref, accessibleName) => {
    server.use(okStructure(), okProgress(), okLesson([{ type: 'video', storageKey: 'k1', streamVideoId: 'vid-1' }]),
      http.get('/api/student/lessons/:lessonId/playback', () => HttpResponse.json({ ok: true, data: {
        lessonId: 'l1', expiresAt: '2026-09-08T12:00:00.000Z', videos: [{ kind: 'unavailable', storageKey: 'k1', reason: 'secret_invalid' }],
      } })),
      http.get('/api/member/settings', () => HttpResponse.json({ ok: true, data: { settings: {
        billingPortalUrl: null,
        supportUrl, supportConfigured: true,
        videoAutoplayDefault: false,
        memberVideoAutoplayOverride: false,
      } } })),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByText(en.lesson.videoUnavailable)).toBeInTheDocument();
    const contact = await screen.findByTestId('lesson-video-contact');
    expect(contact).toHaveTextContent(en.lesson.contactCreator);
    expect(contact).toHaveClass('MuiButton-outlined');
    expect(contact).toHaveAccessibleName(accessibleName);
    expect(contact).toHaveAttribute('href', formHref ?? supportUrl);
    if (supportUrl?.startsWith('https:') === true) {
      expect(contact).toHaveAttribute('target', '_blank');
      expect(contact).toHaveAttribute('rel', 'noopener noreferrer');
    } else {
      expect(contact).not.toHaveAttribute('target');
    }
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument();
  });

  it('retries a failed playback request', async () => {
    let recovered = false;
    server.use(okStructure(), okProgress(), okLesson([{ type: 'video', storageKey: 'k1', streamVideoId: 'vid-1' }]),
      http.get('/api/student/lessons/:lessonId/playback', () => recovered
        ? HttpResponse.json({ ok: true, data: {
          lessonId: 'l1', expiresAt: '2026-09-08T12:00:00.000Z', videos: [
            { kind: 'bunny', storageKey: 'k1', videoId: 'vid-1', libraryId: '1', embedUrl: 'https://courses.example.org/video', hlsUrl: null, signed: false },
          ],
        } })
        : HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Internal' } }, { status: 500 })),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    expect(await screen.findByText(en.lesson.videoFailedTitle)).toBeInTheDocument();
    recovered = true;
    await userEvent.setup().click(screen.getByRole('button', { name: en.common.retry }));
    expect(await screen.findByTestId('lesson-video')).toHaveAttribute('src', 'https://courses.example.org/video');
  });

  it('leaves the breadcrumb trail to the member app bar', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('lesson-html');
    expect(screen.queryByLabelText(en.common.breadcrumbs)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Intro to Variables' })).toBeInTheDocument();
    expect(screen.getByText(en.lesson.eyebrow)).toBeInTheDocument();
  });

  it('completes the lesson: optimistic checkmark, disabled button and invalidation', async () => {
    let completeCalls = 0;
    let progressReads = 0;
    server.use(
      okStructure(),
      okLesson(allBlocks),
      http.get('/api/student/progress', () => {
        progressReads += 1;
        const done = completeCalls > 0 ? ['l1'] : [];
        return HttpResponse.json({ ok: true, data: { progress: progress(done) } });
      }),
      http.post('/api/student/lessons/complete', () => {
        completeCalls += 1;
        return HttpResponse.json({ ok: true, data: { progress: progress(['l1']) } });
      }),
    );

    const user = userEvent.setup();
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const button = await screen.findByTestId('mark-complete');
    expect(button).not.toBeDisabled();

    const readsBefore = progressReads;
    await user.click(button);

    const unmarkButton = await screen.findByTestId('unmark-complete');
    expect(within(screen.getByTestId('lesson-completed-status')).getByTestId('completion-mark')).toBeInTheDocument();
    expect(unmarkButton).toBeEnabled();
    expect(completeCalls).toBe(1);
    await waitFor(() => expect(progressReads).toBeGreaterThan(readsBefore));
  });

  it('un-marks a completed lesson and restores the mark button', async () => {
    let uncompleteCalls = 0;
    server.use(
      okStructure(),
      okLesson(allBlocks),
      http.get('/api/student/progress', () => {
        const done = uncompleteCalls > 0 ? [] : ['l1'];
        return HttpResponse.json({ ok: true, data: { progress: progress(done) } });
      }),
      http.post('/api/student/lessons/uncomplete', () => {
        uncompleteCalls += 1;
        return HttpResponse.json({ ok: true, data: { progress: progress([]) } });
      }),
    );

    const user = userEvent.setup();
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const unmarkButton = await screen.findByTestId('unmark-complete');
    await user.click(unmarkButton);

    await waitFor(() => expect(screen.getByTestId('mark-complete')).toBeInTheDocument());
    expect(uncompleteCalls).toBe(1);
  });

  it.each([
    ['mark-complete', '/api/student/lessons/complete', [], 'unmark-complete'],
    ['unmark-complete', '/api/student/lessons/uncomplete', ['l2'], 'mark-complete'],
  ] as const)('shows a failed %s at the footer bar with a retry', async (trigger, endpoint, initiallyDone, settledTestId) => {
    let calls = 0;
    let done: readonly string[] = initiallyDone;
    server.use(
      okStructure(),
      okLesson(allBlocks),
      http.get('/api/student/progress', () => HttpResponse.json({ ok: true, data: { progress: progress([...done]) } })),
      http.post(endpoint, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Write failed' } }, { status: 500 });
        }
        done = initiallyDone.length === 0 ? ['l2'] : [];
        return HttpResponse.json({ ok: true, data: { progress: progress([...done]) } });
      }),
    );
    const user = userEvent.setup();
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l2" />);

    await user.click(await screen.findByTestId(trigger));

    const error = await screen.findByRole('alert');
    expect(error).toHaveAttribute('data-testid', 'lesson-completion-error');
    expect(error).toHaveTextContent(en.lesson.completionFailed);
    expect(error.closest('footer')).not.toBeNull();
    expect(screen.getByTestId('lesson-block-0').compareDocumentPosition(error)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId(trigger)).toBeInTheDocument();

    const footer = error.closest('footer');
    await user.click(within(error).getByRole('button', { name: en.common.retry }));

    expect(await screen.findByTestId(settledTestId)).toBeInTheDocument();
    expect(calls).toBe(2);
    await waitFor(() => expect(screen.queryByTestId('lesson-completion-error')).not.toBeInTheDocument());
    expect(footer).toHaveFocus();
  });

  it('closes a failed completion without changing the completion state and keeps a short alert on phones', async () => {
    let calls = 0;
    server.use(
      okStructure(),
      okLesson(allBlocks),
      okProgress(),
      http.post('/api/student/lessons/complete', () => {
        calls += 1;
        return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Write failed' } }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l2" />);

    await user.click(await screen.findByTestId('mark-complete'));
    const error = await screen.findByTestId('lesson-completion-error');
    const footer = error.closest('footer');

    const detail = within(error).getByTestId('lesson-completion-detail');
    expect(detail).toHaveTextContent(en.errors.messageInternal);
    expect(stylesBelow(detail, 375)).toMatchObject({ position: 'absolute', width: '1px', height: '1px' });
    expect(stylesAt(detail, 900).position).toBeUndefined();
    const retry = within(error).getByRole('button', { name: en.common.retry });
    expect(stylesBelow(retry, 375)).toMatchObject({ 'min-height': '44px' });
    expect(stylesAt(retry, 900)).toMatchObject({ 'min-height': '0px' });
    expect(stylesAbove(error, 900)).toMatchObject({ 'align-items': 'center' });
    expect(stylesBelow(error, 375)).not.toHaveProperty('align-items');
    const action = error.querySelector('.MuiAlert-action');
    if (action === null) throw new Error('Expected the alert action slot');
    expect(stylesAbove(action, 900)).toMatchObject({ 'padding-top': '0px', 'align-items': 'center' });
    expect(stylesBelow(action, 375)).not.toHaveProperty('padding-top');
    const close = within(error).getByRole('button', { name: en.common.close });
    expect(stylesBelow(close, 375)).toMatchObject({ width: '44px', height: '44px' });

    await user.click(close);

    await waitFor(() => expect(screen.queryByTestId('lesson-completion-error')).not.toBeInTheDocument());
    expect(footer).toHaveFocus();
    expect(screen.getByTestId('mark-complete')).toBeEnabled();
    expect(screen.queryByTestId('unmark-complete')).not.toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('retries a failed complete and continue and then moves on', async () => {
    let completeCalls = 0;
    let releaseRetry: () => void = () => undefined;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    server.use(
      okStructure(),
      okProgress(),
      http.get('/api/student/lessons/:lessonId', ({ params }) => {
        const id = String(params.lessonId);
        return HttpResponse.json({
          ok: true,
          data: {
            lesson: { ...lesson([{ type: 'html', html: `<p>${id} body</p>` }]), id, name: id === 'l2' ? 'Advanced Variables' : 'Intro to Variables' },
            authenticated: true,
          },
        });
      }),
      http.post('/api/student/lessons/complete', async () => {
        completeCalls += 1;
        if (completeCalls === 1) {
          return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Write failed' } }, { status: 500 });
        }
        await retryGate;
        return HttpResponse.json({ ok: true, data: { progress: progress(['l1']) } });
      }),
    );
    const rootRoute = createRootRoute();
    const LessonRouteComponent = () => {
      const params = useParams({ strict: false });
      return <LessonPlayerPage courseId={params.courseId ?? ''} lessonId={params.lessonId ?? ''} />;
    };
    const router = createRouter({
      routeTree: rootRoute.addChildren([createRoute({
        getParentRoute: () => rootRoute,
        path: '/my/courses/$courseId/lessons/$lessonId',
        component: LessonRouteComponent,
      })]),
      history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
    });
    await router.load();
    const user = userEvent.setup();
    renderWithProviders(<RouterProvider router={router} />);

    await user.click(await screen.findByTestId('complete-continue'));
    const error = await screen.findByTestId('lesson-completion-error');
    expect(screen.getByTestId('complete-continue')).toHaveTextContent(en.lesson.completeContinue);
    expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/l1');

    const footer = error.closest('footer');
    await user.click(within(error).getByRole('button', { name: en.common.retry }));
    expect(footer).toHaveFocus();
    expect(screen.getByTestId('complete-continue')).toHaveTextContent(en.lesson.completing);
    releaseRetry();

    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/l2'));
    expect(completeCalls).toBe(2);
    await waitFor(() => expect(screen.queryByTestId('lesson-completion-error')).not.toBeInTheDocument());
  });

  it('holds a pending state on continue until the next lesson is on screen', async () => {
    let releaseComplete: () => void = () => undefined;
    const completeGate = new Promise<void>((resolve) => {
      releaseComplete = resolve;
    });
    server.use(
      okStructure(),
      okProgress(),
      http.get('/api/student/lessons/:lessonId', ({ params }) => {
        const id = String(params.lessonId);
        return HttpResponse.json({
          ok: true,
          data: {
            lesson: {
              ...lesson([{ type: 'html', html: `<p>${id} body</p>` }]),
              id,
              name: id === 'l2' ? 'Advanced Variables' : 'Intro to Variables',
            },
            authenticated: true,
          },
        });
      }),
      http.post('/api/student/lessons/complete', async () => {
        await completeGate;
        return HttpResponse.json({ ok: true, data: { progress: progress(['l1']) } });
      }),
    );

    const rootRoute = createRootRoute();
    const LessonRouteComponent = () => {
      const params = useParams({ strict: false });
      return <LessonPlayerPage courseId={params.courseId ?? ''} lessonId={params.lessonId ?? ''} />;
    };
    const lessonRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/my/courses/$courseId/lessons/$lessonId',
      component: LessonRouteComponent,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([lessonRoute]),
      history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
    });
    await router.load();
    const user = userEvent.setup();
    renderWithProviders(<RouterProvider router={router} />);

    await user.click(await screen.findByTestId('complete-continue'));

    const pending = screen.getByTestId('complete-continue');
    expect(pending).toHaveTextContent(en.lesson.completing);
    expect(pending).toBeDisabled();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
    expect(screen.queryByText(en.lesson.next({ name: 'Advanced Variables' })))
      .not.toBeInTheDocument();
    expect(screen.queryByTestId('unmark-complete')).not.toBeInTheDocument();

    releaseComplete();

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/l2'));
    await waitFor(() => expect(screen.queryByTestId('complete-continue')).not.toBeInTheDocument());
  });

  it('completes the last lesson in place instead of navigating', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l2" />);

    expect(await screen.findByTestId('mark-complete')).toBeInTheDocument();
    expect(screen.queryByTestId('complete-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
  });

  it('renders outlined mobile lesson actions and keeps continue primary', async () => {
    stubMobileViewport();
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const complete = await screen.findByRole('button', { name: en.lesson.markCompleted });
    const previous = screen.getByRole('button', { name: en.lesson.previousLesson });
    const next = screen.getByTestId('skip-to-next-lesson');
    for (const action of [previous, next, complete]) {
      expect(action).toHaveClass('MuiButton-outlined');
    }
    expect(previous).toBeDisabled();
    expect(next).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(stylesAt(next, 390)).toMatchObject({ display: 'none' });
    expect(stylesAt(next, 900)).toMatchObject({ display: 'inline-flex' });
    const primary = screen.getByRole('button', { name: en.lesson.completeContinue });
    expect(primary).toHaveClass('MuiButton-contained');
    expect(stylesAt(complete.parentElement, 390)).toMatchObject({ 'flex-direction': 'row', gap: '0.5rem' });
    expect(stylesAt(complete.parentElement, 900)).toMatchObject({ 'flex-direction': 'row', gap: '0.75rem' });
    expect(previous.parentElement).toHaveAttribute('data-slot', 'compact');
    expect(next).toHaveAttribute('data-slot', 'compact');
    expect(complete).toHaveAttribute('data-slot', 'compact');
    expect(stylesAt(complete, 390)).not.toHaveProperty('flex-basis');
    expect(primary).toHaveAttribute('data-slot', 'primary');
    for (const icon of screen.getAllByTestId('lesson-nav-icon')) {
      expect(stylesAt(icon, 900)).toMatchObject({ display: 'none' });
      expect(stylesAt(icon, 390)).not.toMatchObject({ display: 'none' });
    }
    expect(stylesAt(complete.closest('footer'), 390)).toMatchObject({ position: 'sticky' });
  });

  it('shows completion as a status mark with a labelled undo and drops the Next prefix on mobile', async () => {
    stubMobileViewport();
    server.use(okStructure(), okProgress(['l1']), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const undo = await screen.findByRole('button', { name: en.lesson.unmarkCompleted });
    expect(undo).toHaveAttribute('data-testid', 'unmark-complete');
    expect(undo).toHaveTextContent(en.lesson.undoCompletion);
    expect(undo).toHaveClass('MuiButton-text');
    expect(undo).not.toHaveAttribute('data-slot', 'compact');
    const status = screen.getByTestId('lesson-completed-status');
    expect(status.closest('button, a')).toBeNull();
    expect(within(status).queryByRole('button')).not.toBeInTheDocument();
    expect(within(status).getByRole('img', { name: en.lesson.completed })).toBeInTheDocument();
    const next = screen.getByTestId('next-lesson');
    expect(next).toHaveAttribute('data-slot', 'primary');
    expect(next).toHaveAccessibleName(en.lesson.next({ name: 'Advanced Variables' }));
    const prefixed = within(next).getByText(en.lesson.next({ name: 'Advanced Variables' }));
    const bare = within(next).getByText('Advanced Variables', { exact: true });
    expect(stylesAt(prefixed, 390)).toMatchObject({ display: 'none' });
    expect(stylesAt(bare, 390)).toMatchObject({ display: 'inline' });
    expect(stylesAt(prefixed, 900)).toMatchObject({ display: 'inline' });
    expect(stylesAt(bare, 900)).toMatchObject({ display: 'none' });
    expect(screen.queryByTestId('skip-to-next-lesson')).not.toBeInTheDocument();
    const chevron = within(next).getByTestId('lesson-nav-icon');
    expect(bare.compareDocumentPosition(chevron)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(stylesAt(chevron, 390)).not.toMatchObject({ display: 'none' });
    expect(stylesAt(chevron, 900)).toMatchObject({ display: 'none' });
    expect(stylesBelow(next, 390)).toMatchObject({ 'min-height': '44px' });
    const label = bare.parentElement;
    if (label === null) throw new Error('next-lesson label has no wrapper');
    expect(stylesBelow(label, 390)).toMatchObject({ display: '-webkit-box', '-webkit-line-clamp': '2' });
    expect(stylesBelow(label, 390)['white-space']).toBeUndefined();
    expect(stylesBelow(undo, 390)).toMatchObject({ 'min-width': '44px', 'padding-inline': '0.5rem' });
  });

  it('gives mark-as-completed the full row on the final lesson', async () => {
    stubMobileViewport();
    server.use(okStructureOf(structureOf([entry('l1', 'Final lesson')])), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const complete = await screen.findByTestId('mark-complete');
    expect(complete).toHaveAttribute('data-slot', 'fill');
    expect(complete).toHaveClass('MuiButton-contained');
    expect(screen.getByTestId('course-end')).toHaveAttribute('data-slot', 'status');
  });

  it('keeps marking the final lesson complete primary on mobile', async () => {
    stubMobileViewport();
    server.use(okStructureOf(structureOf([entry('l1', 'Final lesson')])), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('mark-complete')).toHaveClass('MuiButton-contained');
    expect(screen.queryByTestId('complete-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
  });

  it('makes continue the primary action and demotes marking the lesson complete', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const primary = await screen.findByTestId('complete-continue');
    expect(primary).toHaveTextContent(en.lesson.completeContinue);
    expect(primary.className).toContain('MuiButton-contained');
    expect(screen.getByTestId('mark-complete').className).toContain('MuiButton-outlined');
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
  });

  it('offers a neutral next-lesson link that leaves the lesson unfinished', async () => {
    let completions = 0;
    server.use(
      okStructureOf(
        structureOf([
          entry('l1', 'Intro to Variables'),
          entry('l2', 'Advanced Variables'),
          entry('l3', 'Scopes'),
        ]),
      ),
      okProgress(),
      okLesson(allBlocks),
      http.post('/api/student/lessons/complete', () => {
        completions += 1;
        return HttpResponse.json({ ok: true, data: { progress: progress(['l2']) } });
      }),
    );
    const user = userEvent.setup();
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l2" />);

    const neutral = await screen.findByTestId('skip-to-next-lesson');
    expect(neutral).toHaveTextContent(en.lesson.nextLesson);
    expect(neutral).toHaveAttribute('href', '/my/courses/course-1/lessons/l3');
    const muiClasses = (element: HTMLElement) =>
      [...element.classList].filter((name) => name.startsWith('MuiButton'));
    expect(muiClasses(neutral)).toEqual(muiClasses(screen.getByTestId('prev-lesson')));

    await user.click(neutral);
    expect(completions).toBe(0);
  });

  it('drops the neutral next-lesson link once the primary next-lesson action appears', async () => {
    server.use(okStructure(), okProgress(['l1']), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('next-lesson');
    expect(screen.queryByTestId('skip-to-next-lesson')).not.toBeInTheDocument();
  });

  it('promotes the next lesson and demotes the undo once the lesson is completed', async () => {
    server.use(okStructure(), okProgress(['l1']), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const primary = await screen.findByTestId('next-lesson');
    expect(primary).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(primary).toHaveTextContent('Advanced Variables');
    expect(primary.className).toContain('MuiButton-contained');
    expect(screen.getByTestId('unmark-complete').className).toContain('MuiButton-text');
    expect(screen.queryByTestId('complete-continue')).not.toBeInTheDocument();
  });

  it('shows completion at course end', async () => {
    server.use(okStructureFullyCompleted(), okProgress(['l1', 'l2']), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l2" />);

    expect(await screen.findByTestId('course-completed')).toHaveTextContent(en.lesson.courseCompleted);
    expect(screen.queryByTestId('course-end')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
  });

  it('shows a neutral end-of-course state at the last lesson when the course is not finished', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l2" />);

    const markComplete = await screen.findByTestId('mark-complete');
    expect(markComplete.className).toContain('MuiButton-contained');
    expect(screen.queryByTestId('course-completed')).not.toBeInTheDocument();
    expect(await screen.findByTestId('course-end')).toHaveTextContent(en.lesson.lastLesson);
  });

  it('links the previous lesson and disables that slot on the first one', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    const { unmount } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l2" />,
    );

    const previous = await screen.findByTestId('prev-lesson');
    expect(previous).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    expect(previous).toHaveTextContent(en.lesson.previousLesson);
    unmount();

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    expect(await screen.findByTestId('prev-lesson')).toBeDisabled();
  });

  it('skips a locked lesson for the primary action and disables a locked previous one', async () => {
    server.use(
      okStructureOf(
        structureOf([
          entry('l1', 'Intro to Variables'),
          entry('l2', 'Advanced Variables', false),
          entry('l3', 'Scopes'),
        ]),
      ),
      okProgress(['l1']),
      okLesson(allBlocks),
    );
    const { unmount } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l1" />,
    );

    expect(await screen.findByTestId('next-lesson')).toHaveAttribute(
      'href',
      '/my/courses/course-1/lessons/l3',
    );
    expect(screen.queryByTestId('next-locked')).not.toBeInTheDocument();
    unmount();

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l3" />);
    expect(await screen.findByTestId('prev-lesson')).toBeDisabled();
  });

  it('links the next locked lesson with a visible label when every remaining lesson is locked', async () => {
    stubMobileViewport();
    server.use(
      okStructureOf(
        structureOf([entry('l1', 'Intro to Variables'), entry('l2', 'Advanced Variables', false)]),
      ),
      okProgress(),
      okLesson(allBlocks),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const nextLocked = await screen.findByRole('link', { name: en.lesson.nextLocked });
    expect(nextLocked).toHaveAttribute('data-testid', 'next-locked');
    expect(nextLocked).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(nextLocked).not.toHaveAttribute('aria-disabled');
    expect(nextLocked).toHaveClass('MuiButton-contained');
    expect(nextLocked).toHaveAttribute('data-slot', 'primary');
    expect(within(nextLocked).getByTestId('lock-closed')).toBeInTheDocument();
    const label = within(nextLocked).getByText(en.lesson.nextLocked);
    expect(stylesAt(label, 390)).not.toMatchObject({ position: 'absolute' });
    expect(stylesBelow(label, 390)).toMatchObject({ '-webkit-line-clamp': '2' });
    expect(stylesBelow(within(screen.getByTestId('mark-complete')).getByText(en.lesson.markCompleted), 390)).toMatchObject({ 'white-space': 'nowrap' });
    const markComplete = screen.getByTestId('mark-complete');
    expect(markComplete).toHaveClass('MuiButton-outlined');
    expect(markComplete).toHaveAttribute('data-slot', 'wide');
    expect(markComplete).toHaveTextContent(en.lesson.markCompleted);
    expect(within(markComplete).queryByTestId('lesson-nav-icon')).not.toBeInTheDocument();
    const previous = screen.getByTestId('prev-lesson');
    expect(previous.compareDocumentPosition(markComplete)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(markComplete.compareDocumentPosition(nextLocked)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    for (const width of [390, 900]) {
      expect(stylesAt(markComplete, width)).not.toHaveProperty('order');
      expect(stylesAt(markComplete, width)).not.toHaveProperty('flex-basis');
      expect(stylesAt(nextLocked, width)).not.toMatchObject({ 'flex-basis': '100%' });
    }
    expect(stylesBelow(markComplete, 390)).toMatchObject({ 'min-width': '0px' });
    expect(stylesBelow(markComplete, 390)).not.toHaveProperty('order');
    expect(stylesBelow(nextLocked, 390)).toMatchObject({ 'flex-basis': '100%' });
    expect(screen.queryByTestId('complete-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-end')).not.toBeInTheDocument();
    expect(screen.queryByTestId('locked-lessons-skipped')).not.toBeInTheDocument();
  });

  it.each([
    [1, ['l2']],
    [2, ['l2', 'l3']],
  ] as const)('says that %i locked lessons were skipped and links the first one', async (count, lockedIds) => {
    server.use(
      okStructureOf(
        structureOf([
          entry('l1', 'Intro to Variables'),
          ...lockedIds.map((id) => ({ ...entry(id, `Locked ${id}`, false), unlockProductId: 'prod-full' })),
          entry('l9', 'Scopes'),
        ]),
      ),
      okProgress(),
      okLesson(allBlocks),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const skipped = await screen.findByTestId('locked-lessons-skipped');
    expect(skipped).toHaveTextContent(en.lesson.lockedSkipped({ count }));
    expect(skipped).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(skipped.closest('footer')).not.toBeNull();
    expect(screen.getByTestId('complete-continue')).toBeInTheDocument();
    expect(screen.queryByTestId('next-locked')).not.toBeInTheDocument();
  });

  it('links the first skipped lesson a product can unlock', async () => {
    server.use(
      okStructureOf(
        structureOf([
          entry('l1', 'Intro to Variables'),
          entry('l2', 'Locked l2', false),
          { ...entry('l3', 'Locked l3', false), unlockProductId: 'prod-full' },
          entry('l9', 'Scopes'),
        ]),
      ),
      okProgress(),
      okLesson(allBlocks),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const skipped = await screen.findByTestId('locked-lessons-skipped');
    expect(skipped).toHaveTextContent(en.lesson.lockedSkipped({ count: 2 }));
    expect(skipped).toHaveAttribute('href', '/my/courses/course-1/lessons/l3');
  });

  it.each([1, 2] as const)('says that %i skipped lessons are locked without promising an unlock when no product sells them', async (count) => {
    server.use(
      okStructureOf(
        structureOf([
          entry('l1', 'Intro to Variables'),
          ...['l2', 'l3'].slice(0, count).map((id) => entry(id, `Locked ${id}`, false)),
          entry('l9', 'Scopes'),
        ]),
      ),
      okProgress(),
      okLesson(allBlocks),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const skipped = await screen.findByTestId('locked-lessons-skipped');
    expect(skipped).toHaveTextContent(en.lesson.lockedSkippedNotForSale({ count }));
    expect(skipped).not.toHaveTextContent(en.lesson.lockedSkipped({ count }));
    expect(skipped).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
  });

  it('invites the member to unlock the next lesson when a product sells it', async () => {
    server.use(
      okStructureOf(
        structureOf([
          entry('l1', 'Intro to Variables'),
          { ...entry('l2', 'Advanced Variables', false), unlockProductId: 'prod-full' },
        ]),
      ),
      okProgress(),
      okLesson(allBlocks),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const nextLocked = await screen.findByRole('link', { name: en.lesson.unlockNextLesson });
    expect(nextLocked).toHaveAttribute('data-testid', 'next-locked');
    expect(nextLocked).toHaveAttribute('href', '/my/courses/course-1/lessons/l2');
    expect(within(nextLocked).getByTestId('lock-closed')).toBeInTheDocument();
    expect(nextLocked).not.toHaveTextContent(en.lesson.nextLocked);
  });

  it('renders an entitlement-backed attachment download', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson(allBlocks),
      http.get('/api/student/lessons/:lessonId/playback', () =>
        HttpResponse.json({ ok: true, data: { lessonId: 'l1', expiresAt: '2026-09-08T12:00:00.000Z', videos: [] } }),
      ),
      http.get('/api/student/lessons/:lessonId/attachments', () =>
        HttpResponse.json({
          ok: true,
          data: {
            attachments: [{
              id: 'attachment-1',
              lessonId: 'l1',
              fileName: 'worksheet.pdf',
              contentType: 'application/pdf',
              sizeBytes: 4096,
              status: 'ready',
              createdAt: '2026-08-03T12:00:00.000Z',
              downloadPath: '/api/student/lessons/l1/attachments/attachment-1/download',
            }],
          },
        }),
      ),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const download = await screen.findByRole('link', {
      name: en.lesson.downloadAttachment({ name: 'worksheet.pdf' }),
    });
    expect(download).toHaveAttribute(
      'href',
      '/api/student/lessons/l1/attachments/attachment-1/download',
    );
  });

  const forbiddenLesson = () =>
    http.get('/api/student/lessons/:lessonId', () =>
      HttpResponse.json(
        { ok: false, error: { code: 'forbidden', message: 'Forbidden' } },
        { status: 403 },
      ),
    );

  const lockedStructure: CourseStructureWithAccess = {
    ...structure,
    modules: structure.modules.map((module) => ({
      ...module,
      chapters: module.chapters.map((chapter) => ({
        ...chapter,
        lessons: chapter.lessons.map((entry) => ({
          ...entry,
          accessStatus: 'not-accessible',
          unlockProductId: 'prod-full',
        })),
      })),
    })),
  };

  const offerProduct = {
    id: 'prod-full',
    type: 'course',
    slug: 'complete-javascript-course',
    title: 'Complete JavaScript Course',
    description: 'All lessons',
    coverUrl: null,
    priceCents: 19900,
    currency: 'PLN',
    prices: [{
      id: 'price-prod-full-monthly',
      kind: 'recurring',
      interval: 'month',
      amountCents: 4900,
      currency: 'PLN',
    }],
  };

  const okOffer = (product: Record<string, unknown> = {}) =>
    http.get('/api/public/offer', () =>
      HttpResponse.json({
        ok: true,
        data: {
          tenant: { slug: 'studio', name: 'Studio' },
          contentVersion: 1,
          products: [{ ...offerProduct, ...product }],
        },
      }),
    );

  it('tells the member a lesson no product sells is not for sale and leads back to the course', async () => {
    server.use(forbiddenLesson(), okStructure(), okProgress());
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const card = await screen.findByTestId('locked-lesson-upsell');
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'not-for-sale'));
    expect(within(card).getByRole('heading', { name: en.lesson.notForSaleTitle })).toBeInTheDocument();
    expect(within(card).getByText(en.lesson.notForSaleBodyNoContact)).toBeInTheDocument();
    expect(within(card).queryByText(en.lesson.notForSaleBody)).not.toBeInTheDocument();
    expect(screen.queryByTestId('locked-contact-creator')).not.toBeInTheDocument();
    expect(within(card).getByTestId('locked-lesson-lock')).toBeInTheDocument();
    expect(within(card).queryByText(en.lesson.lockedInProduct)).not.toBeInTheDocument();
    expect(within(card).queryByText(en.lesson.contentLocked)).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlock-lesson-cta')).not.toBeInTheDocument();
    const backLinks = screen.getAllByRole('link', { name: en.lesson.backToCourse });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute('href', '/my/courses/course-1');
    expect(backLinks[0]).toHaveAttribute('data-testid', 'locked-back-to-course');
  });

  it.each([
    ['https://help.studio.togethercommunity.app/contact', true],
    ['mailto:help@studio.togethercommunity.app', false],
  ] as const)('offers to contact the course creator at %s when the workspace has a support address', async (supportUrl, opensNewTab) => {
    server.use(
      forbiddenLesson(),
      okStructure(),
      okProgress(),
      http.get('/api/member/settings', () =>
        HttpResponse.json({
          ok: true,
          data: {
            settings: {
              billingPortalUrl: null,
              supportUrl, supportConfigured: true,
              videoAutoplayDefault: false,
              memberVideoAutoplayOverride: false,
            },
          },
        }),
      ),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const card = await screen.findByTestId('locked-lesson-upsell');
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'not-for-sale'));
    expect(within(card).getByText(en.lesson.notForSaleBody)).toBeInTheDocument();
    const contact = within(card).getByTestId('locked-contact-creator');
    expect(contact).toHaveAttribute('href', supportUrl);
    expect(contact).toHaveTextContent(en.lesson.contactCreator);
    expect(contact).toHaveClass('MuiButton-outlined');
    if (opensNewTab) {
      expect(contact).toHaveAttribute('target', '_blank');
      expect(contact).toHaveAttribute('rel', 'noopener noreferrer');
      expect(contact).toHaveAccessibleName(`${en.lesson.contactCreator} ${en.lesson.newTabHint}`);
    } else {
      expect(contact).not.toHaveAttribute('target');
      expect(contact).toHaveAccessibleName(`${en.lesson.contactCreator} ${en.lesson.mailHint}`);
    }
    expect(within(card).getByTestId('locked-back-to-course').compareDocumentPosition(contact))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('links the previous lesson and the next unlocked lesson from the locked page footer', async () => {
    stubMobileViewport();
    const locked = (lessonId: string, name: string): CourseStructureLesson => ({ ...entry(lessonId, name, false), unlockProductId: 'prod-full' });
    server.use(
      forbiddenLesson(),
      okStructureOf(structureOf([
        entry('l1', 'Intro to Variables'),
        locked('l2', 'Advanced Variables'),
        locked('l3', 'Closures'),
        entry('l4', 'Scopes'),
      ])),
      okOffer(),
      okProgress(),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l2" />);

    const footer = await screen.findByTestId('locked-lesson-footer');
    expect(footer.tagName).toBe('FOOTER');
    expect(within(footer).getByTestId('prev-lesson')).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    const next = within(footer).getByRole('link', { name: en.lesson.next({ name: 'Scopes' }) });
    expect(next).toHaveAttribute('href', '/my/courses/course-1/lessons/l4');
    expect(next).toHaveClass('MuiButton-outlined');
    const bare = within(next).getByText('Scopes');
    const chevron = within(next).getByTestId('lesson-nav-icon');
    expect(bare.compareDocumentPosition(chevron)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(stylesAt(chevron, 390)).not.toMatchObject({ display: 'none' });
    expect(stylesAt(chevron, 900)).toMatchObject({ display: 'none' });
    expect(stylesBelow(bare.parentElement ?? next, 390)).toMatchObject({ display: '-webkit-box', '-webkit-line-clamp': '2' });
    expect(screen.getByTestId('locked-lesson-upsell').compareDocumentPosition(footer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('leaves the footer off a locked first lesson with no unlocked lesson after it', async () => {
    server.use(forbiddenLesson(), okStructureOf(lockedStructure), okOffer(), okProgress());
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('unlock-lesson-cta')).toBeInTheDocument();
    expect(screen.queryByTestId('locked-lesson-footer')).not.toBeInTheDocument();
  });

  it('offers the in-app support form from the not-for-sale card when the workspace has no support address', async () => {
    server.use(
      forbiddenLesson(),
      okStructure(),
      okProgress(),
      http.get('/api/member/settings', () =>
        HttpResponse.json({
          ok: true,
          data: {
            settings: {
              billingPortalUrl: null,
              supportUrl: null, supportConfigured: true,
              videoAutoplayDefault: false,
              memberVideoAutoplayOverride: false,
            },
          },
        }),
      ),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const card = await screen.findByTestId('locked-lesson-upsell');
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'not-for-sale'));
    expect(within(card).getByText(en.lesson.notForSaleBody)).toBeInTheDocument();
    expect(within(card).queryByText(en.lesson.notForSaleBodyNoContact)).not.toBeInTheDocument();
    const contact = within(card).getByTestId('locked-contact-creator');
    expect(contact).toHaveAttribute('href', '/account?tab=profile&support=open');
    expect(contact).not.toHaveAttribute('target');
    expect(contact).toHaveAccessibleName(en.lesson.contactCreator);
    expect(contact).toHaveClass('MuiButton-outlined');
    expect(within(card).getByTestId('locked-back-to-course').compareDocumentPosition(contact))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows a skeleton card instead of the fallback copy while the course structure loads', async () => {
    let releaseStructure: () => void = () => undefined;
    const structureGate = new Promise<void>((resolve) => { releaseStructure = resolve; });
    server.use(
      forbiddenLesson(),
      okProgress(),
      okOffer(),
      http.get('/api/student/courses/:courseId/structure', async () => {
        await structureGate;
        return HttpResponse.json({ ok: true, data: { structure: lockedStructure } });
      }),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const skeleton = await screen.findByTestId('locked-lesson-skeleton');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('locked-lesson-upsell')).toHaveAttribute('data-state', 'loading');
    expect(screen.queryByText(en.lesson.notForSaleTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(en.lesson.contentLocked)).not.toBeInTheDocument();
    expect(screen.queryByText(en.lesson.lockedInProduct)).not.toBeInTheDocument();

    releaseStructure();
    expect(await screen.findByTestId('unlock-lesson-cta')).toBeInTheDocument();
    expect(screen.queryByTestId('locked-lesson-skeleton')).not.toBeInTheDocument();
  });

  it('keeps the skeleton card while the offer for the unlocking product loads', async () => {
    let releaseOffer: () => void = () => undefined;
    const offerGate = new Promise<void>((resolve) => { releaseOffer = resolve; });
    server.use(
      forbiddenLesson(),
      okProgress(),
      okStructureOf(lockedStructure),
      http.get('/api/public/offer', async () => {
        await offerGate;
        return HttpResponse.json({
          ok: true,
          data: { tenant: { slug: 'studio', name: 'Studio' }, contentVersion: 1, products: [offerProduct] },
        });
      }),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Intro to Variables' })).toBeInTheDocument();
    expect(screen.getByTestId('locked-lesson-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('unlock-lesson-cta')).not.toBeInTheDocument();

    releaseOffer();
    expect(await screen.findByRole('heading', { name: 'Complete JavaScript Course' })).toBeInTheDocument();
  });

  it('leads with the lock and the no-access line and shows the price once, in the unlock button', async () => {
    server.use(forbiddenLesson(), okStructureOf(lockedStructure), okOffer(), okProgress());
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const unlock = await screen.findByTestId('unlock-lesson-cta');
    const price = en.common.priceMonthly({ price: 'PLN 49.00' });
    expect(unlock).toHaveAttribute('href', '/checkout/prod-full');
    expect(unlock).toHaveTextContent(en.courseTree.unlockAccessWithPrice({ price }));
    const card = screen.getByTestId('locked-lesson-upsell');
    expect(card.textContent?.match(/49\.00/g)).toHaveLength(1);
    expect(screen.queryByTestId('locked-product-price')).not.toBeInTheDocument();
    const lead = within(card).getByTestId('locked-lesson-lead');
    expect(lead).toHaveTextContent(en.lesson.noAccess);
    expect(lead.parentElement?.firstElementChild).toBe(within(card).getByTestId('locked-lesson-lock'));
    expect(stylesAt(lead.parentElement, 390)).toMatchObject({ 'align-items': 'flex-start' });
    expect(stylesAt(lead, 390)).toMatchObject({ 'line-height': '1.4' });
    expect(card.querySelector('[data-testid="locked-lesson-lead"]')).toBe(
      [...card.querySelectorAll('p, h2')][0],
    );
    expect(within(card).getByText(en.lesson.lockedInProduct)).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Complete JavaScript Course' })).toBeInTheDocument();
    const scope = within(card).getByTestId('locked-product-scope');
    expect(scope).toHaveTextContent('All lessons');
    expect(stylesAt(scope, 390)).toMatchObject({ '-webkit-line-clamp': '3' });
    expect(stylesAt(scope, 600)).toMatchObject({ '-webkit-line-clamp': '2' });
    expect(screen.getByRole('link', { name: en.lesson.backToCourse })).toHaveAttribute('href', '/my/courses/course-1');
  });

  it('reads the scope line from the product description as plain text, or names the product type', async () => {
    server.use(
      forbiddenLesson(),
      okStructureOf(lockedStructure),
      okOffer({ description: '<p>Every <strong>module</strong>,</p><ul><li>quizzes</li></ul>' }),
      okProgress(),
    );
    const { unmount } = await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    expect((await screen.findByTestId('locked-product-scope')).textContent).toBe('Every module, quizzes');
    unmount();

    server.use(okOffer({ description: '<p> </p>' }));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
    expect(await screen.findByTestId('locked-product-scope')).toHaveTextContent(en.salesLinks.lineTypes.course);
  });

  it('keeps adjacent paragraphs, list items and line breaks apart in the scope line', async () => {
    const cases = [
      ['<p>All lessons</p><p>Community access</p>', 'All lessons · Community access'],
      ['<p>Includes:</p><ul><li>Video\n  lessons</li><li>Quizzes</li></ul>', 'Includes: Video lessons · Quizzes'],
      ['<p>Lifetime access<br>Certificate</p>', 'Lifetime access · Certificate'],
    ] as const;
    for (const [description, expected] of cases) {
      server.use(forbiddenLesson(), okStructureOf(lockedStructure), okOffer({ description }), okProgress());
      const { unmount } = await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);
      expect((await screen.findByTestId('locked-product-scope')).textContent).toBe(expected);
      unmount();
    }
  });

  it('falls back to the product price when the locked product has no active price rows', async () => {
    server.use(forbiddenLesson(), okStructureOf(lockedStructure), okOffer({ prices: [] }), okProgress());
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('unlock-lesson-cta')).toHaveTextContent(
      en.courseTree.unlockAccessWithPrice({ price: en.common.priceOneTime({ price: 'PLN 199.00' }) }),
    );
  });

  it('leaves the program to the shell below md, where the program sheet carries it', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-html')).toBeInTheDocument();
    expect(screen.queryByTestId('curriculum-card')).not.toBeInTheDocument();
  });

  it('caps the video and the document to the viewport height and widens the reading column', async () => {
    const desktop = 1440;
    const belowContainerLg = 1100;
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const videoFrame = (await screen.findByTestId('lesson-video')).parentElement?.parentElement;
    expect(stylesAt(videoFrame, desktop)).toMatchObject({
      'aspect-ratio': '16/9',
      'max-width': 'max((60vh) * 16 / 9, (100vh - 14rem) * 16 / 9)',
      'margin-left': 'auto',
      'margin-right': 'auto',
    });

    const documentFrame = screen.getByTestId('lesson-pdf').parentElement?.parentElement;
    expect(stylesAt(documentFrame, desktop)).toMatchObject({
      'aspect-ratio': '10/7',
      'max-width': 'max((60vh) * 10 / 7, (100vh - 14rem) * 10 / 7)',
      'min-height': 'min(24rem, max(60vh, 100vh - 14rem))',
    });

    expect(stylesAt(screen.getByTestId('lesson-embed').parentElement?.parentElement, desktop))
      .toMatchObject({ 'max-width': 'max((60vh) * 16 / 9, (100vh - 14rem) * 16 / 9)' });

    const column = screen.getByTestId('lesson-block-0').closest('.MuiContainer-root');
    expect(stylesAt(column, belowContainerLg)).toMatchObject({ 'max-width': '72rem' });

    expect(stylesAt(screen.getByTestId('lesson-html'), desktop)).toMatchObject({
      'max-width': '44rem',
      'margin-inline': 'auto',
      'text-align': 'left',
    });
  });

  it('puts the reading eyebrow on the centred reading column and leaves other eyebrows at the card edge', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const readingBlock = (await screen.findByTestId('lesson-html')).closest('[data-block-type="html"]');
    if (!(readingBlock instanceof HTMLElement)) throw new Error('Expected the reading block card');
    const readingColumn = { 'max-width': '44rem', 'margin-left': 'auto', 'margin-right': 'auto' };
    expect(stylesAt(within(readingBlock).getByText(en.lesson.labelReading), 1440)).toMatchObject(readingColumn);
    expect(stylesAt(within(readingBlock).getByText(en.lesson.labelReading), 375)).toMatchObject(readingColumn);
    expect(stylesAt(within(screen.getByTestId('lesson-block-0')).getByText(en.lesson.labelVideo), 1440)['max-width']).toBeUndefined();
  });

  it('leaves the program to the shell sidebar from md up', async () => {
    stubDesktopViewport();
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-html')).toBeInTheDocument();
    expect(screen.queryByTestId('curriculum-card')).not.toBeInTheDocument();
  });

  it('keeps the lesson shell mounted across a lesson switch', async () => {
    let releaseLesson: () => void = () => undefined;
    const lessonGate = new Promise<void>((resolve) => {
      releaseLesson = resolve;
    });
    server.use(
      okStructure(),
      okProgress(['l1']),
      http.get('/api/student/lessons/:lessonId', async ({ params }) => {
        const lessonId = String(params.lessonId);
        if (lessonId === 'l2') await lessonGate;
        return HttpResponse.json({
          ok: true,
          data: {
            lesson: {
              ...lesson([{ type: 'html', html: `<p>${lessonId === 'l2' ? 'L2 body' : 'L1 body'}</p>` }]),
              id: lessonId,
              name: lessonId === 'l2' ? 'Advanced Variables' : 'Intro to Variables',
            },
            authenticated: true,
          },
        });
      }),
    );

    const rootRoute = createRootRoute();
    const LessonRouteComponent = () => {
      const params = useParams({ strict: false });
      return <LessonPlayerPage courseId={params.courseId ?? ''} lessonId={params.lessonId ?? ''} />;
    };
    const lessonRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/my/courses/$courseId/lessons/$lessonId',
      component: LessonRouteComponent,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([lessonRoute]),
      history: createMemoryHistory({
        initialEntries: ['/my/courses/course-1/lessons/l1'],
      }),
    });
    await router.load();
    const user = userEvent.setup();
    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('L1 body');
    const heading = await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByTestId('next-lesson'));

    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
    expect(screen.getByTestId('lesson-transition-loading')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.auth.signInLink })).not.toBeInTheDocument();

    releaseLesson();

    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('L2 body');
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
  });

  it('shows a friendly empty state for a lesson without blocks', async () => {
    server.use(okStructure(), okProgress(), okLesson([]));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const empty = await screen.findByTestId('lesson-empty-state');
    expect(within(empty).getByTestId('empty-lesson-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(en.lesson.noContentTitle);
    expect(empty).toHaveTextContent(en.lesson.noContent);
  });

  it('fires a fire-and-forget last-viewed with module and chapter ids on mount', async () => {
    let lastViewedBody: unknown = null;
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      http.post('/api/student/progress/last-viewed', async ({ request }) => {
        lastViewedBody = await request.json();
        return HttpResponse.json({ ok: true, data: { progress: progress([]) } });
      }),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('lesson-video');
    await waitFor(() =>
      expect(lastViewedBody).toEqual({
        courseId: 'course-1',
        lessonId: 'l1',
        moduleId: 'm1',
        chapterId: 'c1',
      }),
    );
  });

  it.each([403, 500])('keeps background %s failures off the lesson page', async (status) => {
    let lastViewedCalls = 0;
    server.use(
      okLesson(allBlocks),
      okStructure(),
      http.get('/api/student/progress', () => HttpResponse.json(
        { ok: false, error: { code: status === 403 ? 'forbidden' : 'internal', message: 'Progress unavailable' } },
        { status },
      )),
      http.post('/api/student/progress/last-viewed', () => {
        lastViewedCalls += 1;
        return HttpResponse.json(
          { ok: false, error: { code: status === 403 ? 'forbidden' : 'internal', message: 'Write failed' } },
          { status },
        );
      }),
    );
    const view = await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-video')).toBeInTheDocument();
    await waitFor(() => expect(lastViewedCalls).toBe(1));
    await waitFor(() => expect(view.queryClient.getQueryState(actions.studentProgress('course-1').queryKey)?.status).toBe('error'));
    await waitFor(() =>
      expect(view.queryClient.getMutationCache().getAll().some((mutation) => mutation.state.status === 'error')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('skips the last-viewed write and its error alert while viewing as a member', async () => {
    let lastViewedCalls = 0;
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
            impersonation: {
              id: 'imp-1',
              subjectMemberId: 'mem-1',
              subjectName: 'John Participant',
              actorName: 'Olivia Operator',
              expiresAt: '2026-08-15T09:00:00.000Z',
            },
          },
        }),
      ),
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      http.post('/api/student/progress/last-viewed', () => {
        lastViewedCalls += 1;
        return HttpResponse.json({ ok: true, data: { progress: progress([]) } });
      }),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('lesson-video');
    await screen.findByTestId('mark-complete');

    expect(lastViewedCalls).toBe(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('focuses the thread named by the search param and clears it on exit', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      http.get('/api/discussion', () =>
        HttpResponse.json({
          ok: true,
          data: {
            discussion: {
              threads: [discussionPost('t1', 'Question about hammocks'), discussionPost('t2', 'Question about panels')],
              nextCursor: null,
              viewerSubscriptions: {},
            },
          },
        }),
      ),
      http.get('/api/discussion/threads/:postId', ({ params, request }) => {
        expect(new URL(request.url).searchParams.get('contextKind')).toBe('lesson');
        return params.postId === 't1'
          ? HttpResponse.json({ ok: true, data: { discussion: { threads: [discussionPost('t1', 'Question about hammocks')], nextCursor: null, viewerSubscriptions: {} } } })
          : HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Thread not found' } }, { status: 404 });
      }),
    );

    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1?thread=t1');

    const subthread = await screen.findByTestId('discussion-subthread-t1');
    expect(subthread).toHaveTextContent('Question about hammocks');
    expect(screen.queryByTestId('discussion-thread-t2')).not.toBeInTheDocument();

    await waitFor(() => expect(subthread).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    expect(scrollIntoView.mock.instances).toEqual([subthread]);

    await userEvent.click(screen.getByTestId('back-to-discussion'));

    expect(await screen.findByTestId('discussion-thread-t2')).toHaveTextContent(
      'Question about panels',
    );
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
  });

  const focusedThreadHandlers = (thread: DiscussionPost) => [
    http.get('/api/discussion', () =>
      HttpResponse.json({ ok: true, data: { discussion: { threads: [thread], nextCursor: null, viewerSubscriptions: {} } } }),
    ),
    http.get('/api/discussion/threads/:postId', () =>
      HttpResponse.json({ ok: true, data: { discussion: { threads: [thread], nextCursor: null, viewerSubscriptions: {} } } }),
    ),
  ];

  it('shows a reply that fails after the member left a thread opened from the link in the all-threads alert', async () => {
    let releasePost: (value: undefined) => void = () => undefined;
    const postResponse = new Promise<undefined>((resolve) => {
      releasePost = resolve;
    });
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      ...focusedThreadHandlers(discussionPost('t1', 'Question about hammocks')),
      http.post('/api/posts', async () => {
        await postResponse;
        return HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Slow down' } }, { status: 429 });
      }),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1?thread=t1');

    await user.click(await screen.findByTestId('reply-button-t1'));
    await user.type(screen.getByTestId('reply-composer-t1-input'), 'My reply');
    await user.click(screen.getByTestId('reply-composer-t1-submit'));
    await screen.findByTestId('pending-post');

    await user.click(screen.getByTestId('back-to-discussion'));
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
    expect(await screen.findByTestId('discussion-composer')).toBeInTheDocument();
    releasePost(undefined);

    const discussion = screen.getByTestId('discussion-section');
    const error = await within(discussion).findByRole('alert');
    expect(error).toHaveTextContent(en.community.postTooFast);
    expect(screen.getByTestId('discussion-composer')).not.toContainElement(error);
    expect(within(discussion).getAllByRole('alert')).toHaveLength(1);
  });

  it('shows an edit that fails after the member went back from a thread opened from the link in the all-threads alert', async () => {
    let releaseUpdate: (value: undefined) => void = () => undefined;
    const updateResponse = new Promise<undefined>((resolve) => {
      releaseUpdate = resolve;
    });
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      ...focusedThreadHandlers({ ...discussionPost('t1', 'Question about hammocks'), isOwn: true }),
      http.post('/api/posts/update', async () => {
        await updateResponse;
        return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Write failed' } }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1');
    await router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId', params: { courseId: 'course-1', lessonId: 'l1' }, search: { thread: 't1' } });

    await user.click(await screen.findByTestId('edit-button-t1'));
    await user.type(screen.getByTestId('edit-composer-t1-input'), ' changed');
    await user.click(screen.getByTestId('edit-composer-t1-submit'));
    await waitFor(() => expect(screen.getByTestId('edit-composer-t1-submit')).toHaveTextContent(en.discussion.saving));

    router.history.back();
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
    expect(await screen.findByTestId('discussion-composer')).toBeInTheDocument();
    releaseUpdate(undefined);

    const discussion = screen.getByTestId('discussion-section');
    const error = await within(discussion).findByRole('alert');
    expect(error).toHaveTextContent(en.errors.messageInternal);
    expect(screen.getByTestId('discussion-composer')).not.toContainElement(error);
    expect(within(discussion).getAllByRole('alert')).toHaveLength(1);
  });

  it('keeps a new reply draft under the same post open when a reply sent from the linked thread succeeds later', async () => {
    const thread = discussionPost('t1', 'Question about hammocks');
    let releasePost: (value: undefined) => void = () => undefined;
    const postResponse = new Promise<undefined>((resolve) => {
      releasePost = resolve;
    });
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      ...focusedThreadHandlers(thread),
      http.post('/api/posts', async () => {
        await postResponse;
        return HttpResponse.json({
          ok: true,
          data: { post: { ...discussionPost('n1', 'My reply'), parentPostId: 't1', rootPostId: 't1', isOwn: true } },
        });
      }),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1?thread=t1');

    await user.click(await screen.findByTestId('reply-button-t1'));
    await user.type(screen.getByTestId('reply-composer-t1-input'), 'My reply');
    await user.click(screen.getByTestId('reply-composer-t1-submit'));
    await screen.findByTestId('pending-post');

    await user.click(screen.getByTestId('back-to-discussion'));
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
    await user.click(await screen.findByTestId('reply-button-t1'));
    await user.type(screen.getByTestId('reply-composer-t1-input'), 'New draft');
    releasePost(undefined);

    await waitFor(() => expect(screen.getByTestId('reply-composer-t1-submit')).toHaveTextContent(en.discussion.send));
    expect(screen.getByTestId('reply-composer-t1')).toBeInTheDocument();
    expect(screen.getByTestId('reply-composer-t1-input')).toHaveTextContent('New draft');
  });

  it('keeps a new edit draft of the same post open when an edit sent from the linked thread succeeds later', async () => {
    const thread = { ...discussionPost('t1', 'Question about hammocks'), isOwn: true };
    let releaseUpdate: (value: undefined) => void = () => undefined;
    const updateResponse = new Promise<undefined>((resolve) => {
      releaseUpdate = resolve;
    });
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      ...focusedThreadHandlers(thread),
      http.post('/api/posts/update', async () => {
        await updateResponse;
        return HttpResponse.json({ ok: true, data: { post: { ...thread, editedAt: '2026-08-16T08:00:00.000Z' } } });
      }),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1?thread=t1');

    await user.click(await screen.findByTestId('edit-button-t1'));
    await user.type(screen.getByTestId('edit-composer-t1-input'), ' changed');
    await user.click(screen.getByTestId('edit-composer-t1-submit'));
    await waitFor(() => expect(screen.getByTestId('edit-composer-t1-submit')).toHaveTextContent(en.discussion.saving));

    await user.click(screen.getByTestId('back-to-discussion'));
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
    await user.click(await screen.findByTestId('edit-button-t1'));
    await user.type(screen.getByTestId('edit-composer-t1-input'), ' again');
    releaseUpdate(undefined);

    await waitFor(() => expect(screen.getByTestId('edit-composer-t1-submit')).toHaveTextContent(en.common.save));
    expect(screen.getByTestId('edit-composer-t1')).toBeInTheDocument();
    expect(screen.getByTestId('edit-composer-t1-input')).toHaveValue('Question about hammocks again');
  });

  it('shows a reply sent from the linked thread that fails after a new reply draft under the same post opened in the discussion alert', async () => {
    let releasePost: (value: undefined) => void = () => undefined;
    const postResponse = new Promise<undefined>((resolve) => {
      releasePost = resolve;
    });
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      ...focusedThreadHandlers(discussionPost('t1', 'Question about hammocks')),
      http.post('/api/posts', async () => {
        await postResponse;
        return HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Slow down' } }, { status: 429 });
      }),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1?thread=t1');

    await user.click(await screen.findByTestId('reply-button-t1'));
    await user.type(screen.getByTestId('reply-composer-t1-input'), 'My reply');
    await user.click(screen.getByTestId('reply-composer-t1-submit'));
    await screen.findByTestId('pending-post');

    await user.click(screen.getByTestId('back-to-discussion'));
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
    await user.click(await screen.findByTestId('reply-button-t1'));
    await user.type(screen.getByTestId('reply-composer-t1-input'), 'New draft');
    releasePost(undefined);

    const discussion = screen.getByTestId('discussion-section');
    const error = await within(discussion).findByRole('alert');
    expect(error).toHaveTextContent(en.community.postTooFast);
    expect(screen.getByTestId('reply-composer-t1')).not.toContainElement(error);
    expect(within(screen.getByTestId('reply-composer-t1')).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(discussion).getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByTestId('reply-composer-t1-input')).toHaveTextContent('New draft');
  });

  it('shows an edit sent from the linked thread that fails after a new edit draft of the same post opened in the discussion alert', async () => {
    const thread = { ...discussionPost('t1', 'Question about hammocks'), isOwn: true };
    let releaseUpdate: (value: undefined) => void = () => undefined;
    const updateResponse = new Promise<undefined>((resolve) => {
      releaseUpdate = resolve;
    });
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      ...focusedThreadHandlers(thread),
      http.post('/api/posts/update', async () => {
        await updateResponse;
        return HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Write failed' } }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1?thread=t1');

    await user.click(await screen.findByTestId('edit-button-t1'));
    await user.type(screen.getByTestId('edit-composer-t1-input'), ' changed');
    await user.click(screen.getByTestId('edit-composer-t1-submit'));
    await waitFor(() => expect(screen.getByTestId('edit-composer-t1-submit')).toHaveTextContent(en.discussion.saving));

    await user.click(screen.getByTestId('back-to-discussion'));
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
    await user.click(await screen.findByTestId('edit-button-t1'));
    await user.type(screen.getByTestId('edit-composer-t1-input'), ' again');
    releaseUpdate(undefined);

    const discussion = screen.getByTestId('discussion-section');
    const error = await within(discussion).findByRole('alert');
    expect(error).toHaveTextContent(en.errors.messageInternal);
    expect(screen.getByTestId('edit-composer-t1')).not.toContainElement(error);
    expect(within(screen.getByTestId('edit-composer-t1')).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(discussion).getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByTestId('edit-composer-t1-input')).toHaveValue('Question about hammocks again');
  });

  it('keeps the discussion search term and its hits after opening a hit and coming back', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const thread = discussionPost('t1', 'Question about hammocks');
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      http.get('/api/discussion', () =>
        HttpResponse.json({ ok: true, data: { discussion: { threads: [thread], nextCursor: null, viewerSubscriptions: {} } } }),
      ),
      http.get('/api/discussion/threads/:postId', () =>
        HttpResponse.json({ ok: true, data: { discussion: { threads: [thread], nextCursor: null, viewerSubscriptions: {} } } }),
      ),
      http.get('/api/posts/search', () =>
        HttpResponse.json({ ok: true, data: { hits: [{ post: thread, lessonId: 'l1', snippet: 'Question about hammocks' }] } }),
      ),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1');

    await user.type(await screen.findByTestId('discussion-search-input'), 'hammocks');
    await user.click(await screen.findByTestId('search-hit-link-t1'));
    await waitFor(() => expect(router.state.location.searchStr).toBe('?thread=t1'));
    expect(await screen.findByTestId('discussion-subthread-t1')).toBeInTheDocument();
    expect(screen.queryByTestId('discussion-search-input')).not.toBeInTheDocument();

    const discussionHeading = screen.getByRole('heading', { level: 2, name: en.discussion.heading });
    const headingBlock = discussionHeading.parentElement;
    scrollTo.mockClear();
    scrollIntoView.mockClear();
    await user.click(screen.getByTestId('back-to-discussion'));
    const input = await screen.findByTestId('discussion-search-input');
    expect(input).toHaveValue('hammocks');
    expect(await screen.findByTestId('search-hit-link-t1')).toBeInTheDocument();
    await waitFor(() => expect(discussionHeading).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    expect(scrollIntoView.mock.instances).toEqual([headingBlock]);
    expect(scrollTo).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('search-hit-link-t1'));
    await waitFor(() => expect(screen.getByTestId('discussion-subthread-t1')).toHaveFocus());
    scrollIntoView.mockClear();
    router.history.back();
    const inputAfterBack = await screen.findByTestId('discussion-search-input');
    expect(inputAfterBack).toHaveValue('hammocks');
    expect(await screen.findByTestId('search-hit-link-t1')).toBeInTheDocument();
    await waitFor(() => expect(discussionHeading).toHaveFocus());
    expect(scrollIntoView.mock.instances).toEqual([headingBlock]);

    await router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId', params: { courseId: 'course-1', lessonId: 'l2' } });
    await waitFor(() => expect(screen.getByTestId('discussion-search-input')).toHaveValue(''));

    await router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId', params: { courseId: 'course-1', lessonId: 'l1' } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/my/courses/course-1/lessons/l1'));
    expect(await screen.findByTestId('discussion-search-input')).toHaveValue('');
    expect(screen.queryByTestId('discussion-search-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('search-hit-link-t1')).not.toBeInTheDocument();
  });

  it.each(['the back button', 'browser history'])('reveals the discussion heading after leaving a hit whose thread is past the loaded threads through %s', async (exit) => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const loaded = discussionPost('t2', 'Question about panels');
    const older = discussionPost('t1', 'Question about hammocks');
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      http.get('/api/discussion', () =>
        HttpResponse.json({ ok: true, data: { discussion: { threads: [loaded], nextCursor: 'cursor-2', viewerSubscriptions: {} } } }),
      ),
      http.get('/api/discussion/threads/:postId', () =>
        HttpResponse.json({ ok: true, data: { discussion: { threads: [older], nextCursor: null, viewerSubscriptions: {} } } }),
      ),
      http.get('/api/posts/search', () =>
        HttpResponse.json({ ok: true, data: { hits: [{ post: older, lessonId: 'l1', snippet: 'Question about hammocks' }] } }),
      ),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1');

    await user.type(await screen.findByTestId('discussion-search-input'), 'hammocks');
    await user.click(await screen.findByTestId('search-hit-link-t1'));
    await waitFor(() => expect(screen.getByTestId('discussion-subthread-t1')).toHaveFocus());

    const discussionHeading = screen.getByRole('heading', { level: 2, name: en.discussion.heading });
    scrollIntoView.mockClear();
    if (exit === 'the back button') await user.click(screen.getByTestId('back-to-discussion'));
    else router.history.back();
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));

    expect(await screen.findByTestId('discussion-search-input')).toHaveValue('hammocks');
    expect(await screen.findByTestId('discussion-thread-t2')).toBeInTheDocument();
    await waitFor(() => expect(discussionHeading).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    expect(scrollIntoView.mock.instances).toEqual([discussionHeading.parentElement]);

    await user.click(await screen.findByTestId('search-hit-link-t1'));
    await waitFor(() => expect(screen.getByTestId('discussion-subthread-t1')).toHaveFocus());
  });

  it('keeps the next lesson where it starts after leaving a thread opened by link for that lesson', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const chainPost = (id: string, parentPostId: string, replies: DiscussionPost[]): DiscussionPost => ({
      ...discussionPost(id, `Reply ${id}`), contextId: 'l2', parentPostId, rootPostId: 'r1', replies, replyCount: replies.length,
    });
    const deepThread: DiscussionPost = {
      ...discussionPost('r1', 'Question about rafters'),
      contextId: 'l2',
      replies: [chainPost('c2', 'r1', [chainPost('c3', 'c2', [chainPost('c4', 'c3', [chainPost('c5', 'c4', [chainPost('c6', 'c5', [])])])])])],
    };
    const linked = discussionPost('t1', 'Question about hammocks');
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      http.get('/api/discussion', ({ request }) => {
        const threads = new URL(request.url).searchParams.get('contextId') === 'l2' ? [deepThread] : [linked];
        return HttpResponse.json({ ok: true, data: { discussion: { threads, nextCursor: null, viewerSubscriptions: {} } } });
      }),
      http.get('/api/discussion/threads/:postId', () =>
        HttpResponse.json({ ok: true, data: { discussion: { threads: [linked], nextCursor: null, viewerSubscriptions: {} } } }),
      ),
    );
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1?thread=t1', queryClient);

    await waitFor(() => expect(screen.getByTestId('discussion-subthread-t1')).toHaveFocus());
    await waitFor(() => expect(queryClient.getQueryState(actions.studentLesson('l2').queryKey)?.status).toBe('success'));
    const discussionHeading = screen.getByRole('heading', { level: 2, name: en.discussion.heading });
    const nextFrame = () => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    const discussionScrolled = () =>
      scrollIntoView.mock.instances.some((element) => element instanceof Element && screen.getByTestId('discussion-section').contains(element));
    scrollIntoView.mockClear();

    await router.navigate({ to: '/my/courses/$courseId/lessons/$lessonId', params: { courseId: 'course-1', lessonId: 'l2' } });
    expect(await screen.findByTestId('discussion-thread-r1')).toBeInTheDocument();
    await nextFrame();
    expect(discussionScrolled()).toBe(false);
    expect(discussionHeading).not.toHaveFocus();

    await user.click(await screen.findByTestId('continue-thread-c5'));
    await user.click(await screen.findByTestId('back-to-discussion'));
    expect(await screen.findByTestId('discussion-thread-r1')).toBeInTheDocument();
    await nextFrame();
    expect(discussionScrolled()).toBe(false);
    expect(discussionHeading).not.toHaveFocus();
  });

  it('shows a reply that fails after the member went back from a search hit before the search box with its hits', async () => {
    const thread = discussionPost('t1', 'Question about hammocks');
    let releasePost: (value: undefined) => void = () => undefined;
    const postResponse = new Promise<undefined>((resolve) => {
      releasePost = resolve;
    });
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      ...focusedThreadHandlers(thread),
      http.get('/api/posts/search', () =>
        HttpResponse.json({ ok: true, data: { hits: [{ post: thread, lessonId: 'l1', snippet: 'Question about hammocks' }] } }),
      ),
      http.post('/api/posts', async () => {
        await postResponse;
        return HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Slow down' } }, { status: 429 });
      }),
    );
    const user = userEvent.setup();
    const router = await renderLessonRoute('/my/courses/course-1/lessons/l1');

    await user.type(await screen.findByTestId('discussion-search-input'), 'hammocks');
    await user.click(await screen.findByTestId('search-hit-link-t1'));
    await user.click(await screen.findByTestId('reply-button-t1'));
    await user.type(screen.getByTestId('reply-composer-t1-input'), 'My reply');
    await user.click(screen.getByTestId('reply-composer-t1-submit'));
    await screen.findByTestId('pending-post');

    await user.click(screen.getByTestId('back-to-discussion'));
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
    expect(await screen.findByTestId('search-hit-link-t1')).toBeInTheDocument();
    releasePost(undefined);

    const discussion = screen.getByTestId('discussion-section');
    const error = await within(discussion).findByRole('alert');
    expect(error).toHaveTextContent(en.community.postTooFast);
    expect(error.compareDocumentPosition(screen.getByTestId('discussion-search-input')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('discussion-composer').compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(discussion).getAllByRole('alert')).toHaveLength(1);
  });
});
