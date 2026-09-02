import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useParams,
  useSearch,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
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

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { LessonPlayerPage } from './LessonPlayerPage.js';

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

const stubDesktopViewport = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

const renderPage = async (node: ReactNode) => {
  const rootRoute = createRootRoute({ component: () => node });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my/courses/course-1/lessons/l1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('LessonPlayerPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
            name: 'Jan Uczestnik',
            tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: null, memberId: 'mem-1', banned: false },
          },
        }),
      ),
      http.get('/api/discussion', () =>
        HttpResponse.json({
          ok: true,
          data: { discussion: { threads: [], nextCursor: null, viewerSubscriptions: {} } },
        }),
      ),
      http.get('/api/student/lessons/:lessonId/attachments', () =>
        HttpResponse.json({ ok: true, data: { attachments: [] } }),
      ),
    );
  });

  it('renders every typed block', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    const { container } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l1" />,
    );

    const video = await screen.findByTestId('lesson-video');
    expect(video).toHaveAttribute(
      'src',
      'https://iframe.mediadelivery.net/embed/424242/vid-1',
    );
    expect(video).toHaveAttribute('allowfullscreen');

    expect(screen.getByTestId('lesson-pdf')).toHaveAttribute(
      'src',
      'https://cdn.example.com/slides.pdf',
    );
    expect(screen.getByRole('link', { name: pl.lesson.openPdf })).toHaveAttribute(
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
    const sandboxUrl = 'https://codesandbox.io/embed/github/coderoadpl/task-1?autoresize=1';
    server.use(
      okStructure(),
      okProgress(),
      okLesson([{ type: 'link', url: sandboxUrl, description: 'Zadanie 1 — flexbox' }]),
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
    expect(sandbox).toHaveAttribute('title', 'Zadanie 1 — flexbox');
    expect(screen.getByTestId('lesson-sandbox-caption')).toHaveTextContent('Zadanie 1 — flexbox');
    expect(screen.getByTestId('lesson-media-skeleton')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: `${pl.lesson.openInNewTab} — Zadanie 1 — flexbox` }),
    ).toHaveAttribute('href', 'https://codesandbox.io/s/github/coderoadpl/task-1?autoresize=1');
  });

  it('renders one iframe when a link and an html anchor point at the same sandbox', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: 'https://codesandbox.io/embed/abc123', description: 'Zadanie' },
        { type: 'html', html: '<p><a href="https://codesandbox.io/s/abc123">sandbox</a></p>' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    await screen.findByTestId('lesson-sandbox');
    expect(screen.getAllByTestId('lesson-sandbox')).toHaveLength(1);
    expect(screen.getAllByTestId(/lesson-block-/u)).toHaveLength(1);
    expect(screen.getByTestId('lesson-sandbox-caption')).toHaveTextContent('Zadanie');
  });

  it('merges consecutive links into one section without raw URLs', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: 'https://github.com/coderoadpl/task-1', description: 'GitHub' },
        { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/HTML' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const section = await screen.findByTestId('lesson-block-0');
    expect(screen.getAllByTestId(/lesson-block-/u)).toHaveLength(1);
    expect(section.dataset.blockType).toBe('links');
    expect(within(section).getByText(pl.lesson.linksHeading)).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    const links = within(section).getAllByRole('link');
    expect(links[0]).toHaveAttribute('title', 'https://github.com/coderoadpl/task-1');
    expect(links[0]).toHaveAccessibleName(`GitHub ${pl.lesson.newTabHint}`);
    expect(links[1]).toHaveAccessibleName(`developer.mozilla.org / HTML ${pl.lesson.newTabHint}`);
    expect(section.textContent).not.toContain('https://');
    expect(section.textContent).not.toContain('/coderoadpl/');
  });

  it('keeps description-less links on one host distinguishable', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: 'https://github.com/coderoadpl/one' },
        { type: 'link', url: 'https://github.com/coderoadpl/two' },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const section = await screen.findByTestId('lesson-block-0');
    const names = within(section)
      .getAllByRole('link')
      .map((node) => node.getAttribute('title'));
    expect(names).toEqual(['https://github.com/coderoadpl/one', 'https://github.com/coderoadpl/two']);
    expect(within(section).getByRole('link', { name: `github.com / one ${pl.lesson.newTabHint}` })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: `github.com / two ${pl.lesson.newTabHint}` })).toBeInTheDocument();
  });

  it('labels a chip from the path when the anchor text is a schemeless URL', async () => {
    const repoUrl = 'https://github.com/coderoadpl/frontend--html-css-flexbox--task-1';
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'html', html: `<p><a href="${repoUrl}">github.com/coderoadpl/frontend--html-css-flexbox--task-1</a></p>` },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const section = await screen.findByTestId('lesson-block-0');
    expect(within(section).getByRole('link')).toHaveAttribute('href', repoUrl);
    expect(section.textContent).not.toContain('/coderoadpl/');
  });

  it('folds a single-anchor html block into the links section and drops the duplicate', async () => {
    const repoUrl = 'https://github.com/coderoadpl/frontend--html-css-flexbox--task-1';
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: repoUrl, description: 'GitHub' },
        { type: 'html', html: `<p><a href="${repoUrl}" target="_blank">${repoUrl}</a></p>` },
      ]),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const section = await screen.findByTestId('lesson-block-0');
    expect(screen.getAllByTestId(/lesson-block-/u)).toHaveLength(1);
    expect(screen.queryByTestId('lesson-html')).not.toBeInTheDocument();
    const links = within(section).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('GitHub');
    expect(links[0]).toHaveAttribute('href', repoUrl);
  });

  it('keeps links separated by another block in their own sections', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson([
        { type: 'link', url: 'https://example.com/first', description: 'Pierwszy' },
        { type: 'html', html: '<p>Notatki</p><p>Więcej</p>' },
        { type: 'link', url: 'https://example.com/second', description: 'Drugi' },
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
          lesson: { ...lesson([{ type: 'html', html: '<p>Preview body</p>' }]), isPreview: true },
          authenticated: false,
        },
      })),
      http.get('/api/me', countMemberOnly),
      http.get('/api/student/courses/:courseId/structure', countMemberOnly),
      http.get('/api/student/progress', countMemberOnly),
      http.get('/api/discussion', countMemberOnly),
      http.post('/api/student/progress/last-viewed', countMemberOnly),
    );

    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('Preview body');
    expect(screen.queryByTestId('mark-complete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('discussion-section')).not.toBeInTheDocument();
    expect(memberOnlyRequests).toBe(0);
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

    expect(await screen.findByTestId('lesson-video')).toHaveAttribute('src', embedUrl);
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
      pl.lesson.videoPlaceholder,
    );
    expect(screen.queryByTestId('lesson-video')).not.toBeInTheDocument();
  });

  it('renders breadcrumbs from the course structure', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const crumbs = await screen.findByLabelText(pl.common.breadcrumbs);
    expect(within(crumbs).getByRole('link', { name: 'JavaScript Foundations' })).toBeInTheDocument();
    expect(within(crumbs).getByText('01 - Fundamentals')).toBeInTheDocument();
    expect(within(crumbs).getByText('Getting started')).toBeInTheDocument();
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
    expect(within(unmarkButton).getByTestId('completion-full')).toBeInTheDocument();
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

  it('makes continue the primary action and demotes marking the lesson complete', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const primary = await screen.findByTestId('complete-continue');
    expect(primary).toHaveTextContent(pl.lesson.completeContinue);
    expect(primary.className).toContain('MuiButton-contained');
    expect(screen.getByTestId('mark-complete').className).toContain('MuiButton-text');
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
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

    expect(await screen.findByTestId('course-completed')).toHaveTextContent(pl.lesson.courseCompleted);
    expect(screen.queryByTestId('course-end')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
  });

  it('shows a neutral end-of-course state at the last lesson when the course is not finished', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l2" />);

    const markComplete = await screen.findByTestId('mark-complete');
    expect(markComplete.className).toContain('MuiButton-contained');
    expect(screen.queryByTestId('course-completed')).not.toBeInTheDocument();
    expect(await screen.findByTestId('course-end')).toHaveTextContent(pl.lesson.lastLesson);
  });

  it('links the previous lesson and disables that slot on the first one', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    const { unmount } = await renderPage(
      <LessonPlayerPage courseId="course-1" lessonId="l2" />,
    );

    const previous = await screen.findByTestId('prev-lesson');
    expect(previous).toHaveAttribute('href', '/my/courses/course-1/lessons/l1');
    expect(previous).toHaveTextContent(pl.lesson.previousLesson);
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

  it('disables the next slot when every remaining lesson is locked', async () => {
    server.use(
      okStructureOf(
        structureOf([entry('l1', 'Intro to Variables'), entry('l2', 'Advanced Variables', false)]),
      ),
      okProgress(),
      okLesson(allBlocks),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('next-locked')).toBeDisabled();
    expect(screen.getByTestId('mark-complete').className).toContain('MuiButton-contained');
    expect(screen.queryByTestId('complete-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('course-end')).not.toBeInTheDocument();
  });

  it('renders an entitlement-backed attachment download', async () => {
    server.use(
      okStructure(),
      okProgress(),
      okLesson(allBlocks),
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
      name: pl.lesson.downloadAttachment({ name: 'worksheet.pdf' }),
    });
    expect(download).toHaveAttribute(
      'href',
      '/api/student/lessons/l1/attachments/attachment-1/download',
    );
  });

  it('renders a SectionCard locked state inside the member skeleton without a paid CTA', async () => {
    server.use(
      http.get('/api/student/lessons/:lessonId', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'forbidden', message: 'Forbidden' } },
          { status: 403 },
        ),
      ),
      okStructure(),
      okProgress(),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByRole('heading', { name: pl.lesson.contentLocked })).toBeInTheDocument();
    expect(screen.getByTestId('locked-lesson-upsell')).toBeInTheDocument();
    expect(screen.getByTestId('locked-state-icon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.lesson.backToCourse })).toHaveAttribute(
      'href',
      '/my/courses/course-1',
    );
    expect(screen.queryByTestId('unlock-lesson-cta')).not.toBeInTheDocument();
  });

  it('shows an unlock CTA on the locked page when a product covers the lesson', async () => {
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
    server.use(
      http.get('/api/student/lessons/:lessonId', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'forbidden', message: 'Forbidden' } },
          { status: 403 },
        ),
      ),
      http.get('/api/student/courses/:courseId/structure', () =>
        HttpResponse.json({ ok: true, data: { structure: lockedStructure } }),
      ),
      http.get('/api/public/offer', () =>
        HttpResponse.json({
          ok: true,
          data: {
            tenant: { slug: 'studio', name: 'Studio' },
            contentVersion: 1,
            products: [{
              id: 'prod-full',
              type: 'course',
              slug: 'pelny-kurs-javascript',
              title: 'Pełny kurs JavaScript',
              description: 'Wszystkie lekcje',
              coverUrl: null,
              priceCents: 19900,
              currency: 'PLN',
              prices: [],
            }],
          },
        }),
      ),
      okProgress(),
    );
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const unlock = await screen.findByTestId('unlock-lesson-cta');
    expect(unlock).toHaveAttribute('href', '/checkout/prod-full');
    expect(unlock).toHaveTextContent(pl.courseTree.unlockAccess);
    expect(await screen.findByRole('heading', { name: 'Pełny kurs JavaScript' })).toBeInTheDocument();
    expect(await screen.findByTestId('locked-product-price')).toHaveTextContent('199');
  });

  it('leaves the program to the shell below md, where the program sheet carries it', async () => {
    server.use(okStructure(), okProgress(), okLesson(allBlocks));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    expect(await screen.findByTestId('lesson-html')).toBeInTheDocument();
    expect(screen.queryByTestId('curriculum-card')).not.toBeInTheDocument();
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
    const breadcrumbs = await screen.findByTestId('member-breadcrumbs');
    await user.click(screen.getByTestId('next-lesson'));

    expect(screen.getByTestId('member-breadcrumbs')).toBe(breadcrumbs);
    expect(screen.getByTestId('lesson-transition-loading')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: pl.auth.signInLink })).not.toBeInTheDocument();

    releaseLesson();

    expect(await screen.findByTestId('lesson-html')).toHaveTextContent('L2 body');
    expect(screen.getByTestId('member-breadcrumbs')).toBe(breadcrumbs);
  });

  it('shows a friendly empty state for a lesson without blocks', async () => {
    server.use(okStructure(), okProgress(), okLesson([]));
    await renderPage(<LessonPlayerPage courseId="course-1" lessonId="l1" />);

    const empty = await screen.findByTestId('lesson-empty-state');
    expect(within(empty).getByTestId('empty-lesson-icon')).toBeInTheDocument();
    expect(empty).toHaveTextContent(pl.lesson.noContentTitle);
    expect(empty).toHaveTextContent(pl.lesson.noContent);
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
  it('focuses the thread named by the search param and clears it on exit', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const post = (id: string, body: string): DiscussionPost => ({
      id,
      tenantId: 't1',
      contextKind: 'lesson',
      contextId: 'l1',
      parentPostId: null,
      rootPostId: id,
      isOwn: false,
      authorDisplay: 'Ola Autorka',
      authorIsStaff: false,
      authorAvatarUrl: null,
      body,
      createdAt: '2026-08-15T08:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      replies: [],
      replyCount: 0,
    });
    server.use(
      okLesson(allBlocks),
      okStructure(),
      okProgress(),
      http.get('/api/discussion', () =>
        HttpResponse.json({
          ok: true,
          data: {
            discussion: {
              threads: [post('t1', 'Pytanie o hamaki'), post('t2', 'Pytanie o panele')],
              nextCursor: null,
              viewerSubscriptions: {},
            },
          },
        }),
      ),
    );

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
        initialEntries: ['/my/courses/course-1/lessons/l1?thread=t1'],
      }),
    });
    await router.load();
    renderWithProviders(<RouterProvider router={router} />);

    const subthread = await screen.findByTestId('discussion-subthread-t1');
    expect(subthread).toHaveTextContent('Pytanie o hamaki');
    expect(screen.queryByTestId('discussion-thread-t2')).not.toBeInTheDocument();

    await waitFor(() => expect(subthread).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    expect(scrollIntoView.mock.instances).toEqual([subthread]);

    await userEvent.click(screen.getByTestId('back-to-discussion'));

    expect(await screen.findByTestId('discussion-thread-t2')).toHaveTextContent(
      'Pytanie o panele',
    );
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
  });
});
