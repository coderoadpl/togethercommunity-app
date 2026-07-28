import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { newCourseLessonSchema, type CourseLesson, type LessonBlock } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelLessonEditRoute } from '../panel-routes.js';
import { LessonCreatePage, LessonsSection } from './LessonsSection.js';

const renderLessonsAt = async (initialEntry = '/panel/lessons') => {
  const rootRoute = createRootRoute();
  const listRoute = createRoute({ getParentRoute: () => rootRoute, path: '/panel/lessons', component: LessonsSection });
  const createRoutePage = createRoute({ getParentRoute: () => rootRoute, path: '/panel/lessons/new', component: LessonCreatePage });
  const editRoute = createRoute({ getParentRoute: () => rootRoute, path: '/panel/lessons/$lessonId', component: PanelLessonEditRoute });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, createRoutePage, editRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('LessonsSection pagination', { timeout: 15000 }, () => {
  it('paginates the lesson pool and applies the type filter to the full set', async () => {
    const manyLessons: CourseLesson[] = Array.from({ length: 26 }, (_, index) => ({
      id: `lesson-${index}`,
      tenantId: 't1',
      name: `Lesson ${String(index).padStart(2, '0')}`,
      contents: index === 0 ? [{ type: 'html', html: '<p>intro</p>' }] : [],
      legacyId: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    server.use(http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: manyLessons } })));

    await renderLessonsAt();
    await screen.findByText('Lesson 25');

    expect(screen.getAllByTestId('lesson-row')).toHaveLength(25);

    await userEvent.click(screen.getByRole('button', { name: pl.pagination.nextPage }));
    expect(screen.getAllByTestId('lesson-row')).toHaveLength(1);
    expect(screen.getByText('Lesson 00')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('lessons-type-filter-html'));
    await waitFor(() => expect(screen.getAllByTestId('lesson-row')).toHaveLength(1));
    expect(screen.getByText('Lesson 00')).toBeInTheDocument();
    expect(screen.queryByTestId('lessons-pagination')).not.toBeInTheDocument();
  });
});

describe('LessonsSection blocks editor', { timeout: 15000 }, () => {
  it('adds a video block, reorders it and creates the lesson', async () => {
    let lessons: CourseLesson[] = [];
    let submitted: LessonBlock[] = [];

    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons } })),
      http.post('/api/lessons', async ({ request }) => {
        const body = newCourseLessonSchema.parse(await request.json());
        submitted = body.contents;
        const created: CourseLesson = {
          id: 'lesson-new',
          tenantId: 't1',
          name: body.name,
          contents: body.contents,
          legacyId: null,
          createdAt: '2026-07-12T10:00:00.000Z',
        };
        lessons = [created];
        return HttpResponse.json({ ok: true, data: { lesson: created } });
      }),
    );

    await renderLessonsAt('/panel/lessons/new');

    await userEvent.type(await screen.findByLabelText(pl.common.name), 'Reordered Lesson');

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));
    await userEvent.type(await screen.findByLabelText('storageKey'), 'videos/intro.mp4');
    await userEvent.type(screen.getByLabelText('streamVideoId'), 'vid-1');

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: pl.lessons.typeEmbed }));
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));
    await userEvent.type(await screen.findByLabelText('embedUrl'), 'https://example.com/embed');

    expect(screen.getAllByTestId('block-type').map((node) => node.textContent)).toEqual(['video', 'embed']);

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.moveUp({ index: 1 }) }));

    expect(screen.getAllByTestId('block-type').map((node) => node.textContent)).toEqual(['embed', 'video']);

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.createLesson }));

    await waitFor(() => {
      expect(submitted.map((block) => block.type)).toEqual(['embed', 'video']);
    });
    expect(await screen.findByText('Reordered Lesson')).toBeInTheDocument();
  });

  it('fills the video ids from the Bunny Stream picker', async () => {
    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.get('/api/integrations/bunny/videos', () =>
        HttpResponse.json({
          ok: true,
          data: {
            page: {
              libraryId: 'lib-9',
              videos: [
                { id: 'guid-1', title: 'Intro video', lengthSeconds: 95, uploadedAt: '2026-07-01T10:00:00.000Z' },
              ],
              totalItems: 1,
              page: 1,
              pageSize: 24,
            },
          },
        }),
      ),
    );

    await renderLessonsAt('/panel/lessons/new');

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));
    await userEvent.click(await screen.findByTestId('block-0-bunny-picker'));
    await userEvent.click(await screen.findByTestId('bunny-picker-video'));

    expect(screen.getByLabelText('streamVideoId')).toHaveValue('guid-1');
    expect(screen.getByLabelText('streamLibraryId')).toHaveValue('lib-9');
    expect(screen.getByLabelText('storageKey')).toHaveValue('guid-1');
  });

  it('keeps manual fields and shows a settings hint when Bunny Stream is not configured', async () => {
    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.get('/api/integrations/bunny/videos', () =>
        HttpResponse.json(
          {
            ok: false,
            error: { code: 'integration_not_configured', message: 'Save a Bunny Stream API key first' },
          },
          { status: 412 },
        ),
      ),
    );

    await renderLessonsAt('/panel/lessons/new');

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));
    await userEvent.click(await screen.findByTestId('block-0-bunny-picker'));

    expect(await screen.findByTestId('bunny-picker-not-configured')).toHaveTextContent(
      pl.lessons.videoPickerNotConfigured,
    );
    expect(screen.getByRole('link', { name: pl.lessons.videoPickerOpenIntegrations })).toHaveAttribute(
      'href',
      '/panel/integrations',
    );

    await userEvent.click(screen.getByRole('button', { name: pl.common.cancel }));
    expect(screen.getByLabelText('storageKey')).toBeInTheDocument();
    expect(screen.getByLabelText('streamVideoId')).toBeInTheDocument();
  });

  it('inserts markup via the toolbar and renders a sanitized live preview', async () => {
    server.use(http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })));

    const { container } = await renderLessonsAt('/panel/lessons/new');

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: pl.lessons.typeHtml }));
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));

    const editor = await screen.findByLabelText(pl.lessons.htmlLabel);
    await userEvent.type(editor, '<p>Safe body</p><script>window.__xss=1</script>');

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.htmlToolbarBold }));
    expect(editor).toHaveValue(
      `<p>Safe body</p><script>window.__xss=1</script><strong>${pl.lessons.htmlPlaceholderBold}</strong>`,
    );

    await userEvent.click(screen.getByRole('tab', { name: pl.lessons.htmlPreviewTab }));

    const preview = await screen.findByTestId('html-preview');
    expect(preview).toHaveTextContent('Safe body');
    expect(preview).toHaveTextContent(pl.lessons.htmlPlaceholderBold);
    expect(container.querySelector('[data-testid="html-preview"] script')).toBeNull();
    expect(screen.queryByText('window.__xss=1')).not.toBeInTheDocument();
  });

  it('filters lessons by name and by content type', async () => {
    const lessons: CourseLesson[] = [
      {
        id: 'l1',
        tenantId: 't1',
        name: 'Video intro',
        contents: [{ type: 'video', storageKey: 'videos/a.mp4', streamVideoId: 'vid-1' }],
        legacyId: null,
        createdAt: '2026-07-10T10:00:00.000Z',
      },
      {
        id: 'l2',
        tenantId: 't1',
        name: 'Reading list',
        contents: [{ type: 'html', html: '<p>Read me</p>' }],
        legacyId: null,
        createdAt: '2026-07-11T10:00:00.000Z',
      },
    ];
    server.use(http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons } })));

    await renderLessonsAt();
    await screen.findByText('Video intro');

    expect(screen.getAllByTestId('lesson-row').map((node) => node.textContent)).toEqual([
      expect.stringContaining('Reading list'),
      expect.stringContaining('Video intro'),
    ]);

    await userEvent.click(screen.getByTestId('lessons-type-filter-html'));
    await waitFor(() => expect(screen.getAllByTestId('lesson-row')).toHaveLength(1));
    expect(screen.getByText('Reading list')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('lessons-type-filter-all'));
    await userEvent.type(screen.getByTestId('lessons-search'), 'video');
    await waitFor(() => expect(screen.getAllByTestId('lesson-row')).toHaveLength(1));
    expect(screen.getByText('Video intro')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('lessons-search'), ' nothing-matches');
    expect(await screen.findByText(pl.lessons.noMatches)).toBeInTheDocument();
  });

  it('shows what references a lesson and deletes it after confirmation', async () => {
    let lessons: CourseLesson[] = [
      {
        id: 'lesson-1',
        tenantId: 't1',
        name: 'Intro lesson',
        contents: [],
        legacyId: null,
        createdAt: '2026-07-12T10:00:00.000Z',
      },
    ];
    let deleted = false;

    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons } })),
      http.get('/api/lessons/references', () =>
        HttpResponse.json({
          ok: true,
          data: {
            references: {
              lessonId: 'lesson-1',
              lessonName: 'Intro lesson',
              chapters: [
                {
                  moduleId: 'm1',
                  moduleName: 'Module',
                  chapterId: 'ch1',
                  chapterName: 'Chapter',
                  contentId: 'ct1',
                  contentName: 'Intro',
                },
              ],
              products: [{ productId: 'p1', productTitle: 'Bundle' }],
              progressCount: 2,
            },
          },
        }),
      ),
      http.delete('/api/lessons/:lessonId', () => {
        deleted = true;
        lessons = [];
        return HttpResponse.json({
          ok: true,
          data: {
            references: {
              lessonId: 'lesson-1',
              lessonName: 'Intro lesson',
              chapters: [],
              products: [],
              progressCount: 2,
            },
          },
        });
      }),
    );

    await renderLessonsAt();

    await userEvent.click(await screen.findByRole('button', { name: pl.lessons.deleteAria({ name: 'Intro lesson' }) }));

    expect(await screen.findByText(pl.lessons.deleteReferencesChapters({ count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(pl.lessons.deleteReferencesProducts({ count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(pl.lessons.deleteReferencesProgress({ count: 2 }))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.deleteConfirm }));

    await waitFor(() => expect(deleted).toBe(true));
    expect(await screen.findByText(pl.lessons.empty)).toBeInTheDocument();
  });
});
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
