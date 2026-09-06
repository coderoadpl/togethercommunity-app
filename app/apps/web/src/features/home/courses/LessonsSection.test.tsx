import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { lessonUpdateInputSchema } from '#core/contract/index.js';
import {
  newCourseLessonSchema,
  type CourseLesson,
  type LessonBlock,
  type TenantSecretMasked,
} from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { stylesAt } from '../../../lib/stylesheet.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelLessonEditRoute } from '../panel-routes.js';
import { LessonCreatePage, LessonsSection } from './LessonsSection.js';

const renderLessonsAt = async (initialEntry = '/panel/lessons', secrets: TenantSecretMasked[] = []) => {
  server.use(http.get('/api/tenant-secrets', () => HttpResponse.json({ ok: true, data: { secrets, stripeMode: null, stripeWebhookUrl: 'https://studio.together.dev/api/stripe/webhook' } })));
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

const referencesPayload = (courses: Array<{ courseId: string; courseName: string; publiclyVisible: boolean }>) => ({
  ok: true,
  data: {
    references: {
      lessonId: 'lesson-1',
      lessonName: 'Intro lesson',
      chapters: [],
      courses,
      products: [],
      progressCount: 0,
    },
  },
});

beforeEach(() => {
  server.use(
    http.get('/api/lessons/:lessonId/attachments', () =>
      HttpResponse.json({ ok: true, data: { attachments: [] } }),
    ),
    http.get('/api/lessons/references', () => HttpResponse.json(referencesPayload([]))),
  );
});

const privacyNoteScenarios: Array<{
  name: string;
  secrets: TenantSecretMasked[];
  showBunnyNote: boolean;
}> = [
  { name: 'without Bunny security', secrets: [], showBunnyNote: true },
  {
    name: 'with Bunny security',
    secrets: [
      {
        key: 'bunny.securityKey',
        maskedPreview: 'se••••ey',
        updatedAt: '2026-08-03T08:00:00.000Z',
      },
    ],
    showBunnyNote: false,
  },
];

describe('LessonsSection pagination', { timeout: 15000 }, () => {
  it('paginates the lesson pool and applies the type filter to the full set', async () => {
    const manyLessons: CourseLesson[] = Array.from({ length: 26 }, (_, index) => ({
      id: `lesson-${index}`,
      tenantId: 't1',
      name: `Lesson ${String(index).padStart(2, '0')}`,
      isPreview: false,
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
  it('uploads an attachment directly to storage and completes the lesson record', async () => {
    const lesson: CourseLesson = {
      id: 'lesson-1',
      tenantId: 't1',
      name: 'Attachment lesson',
      isPreview: false,
      contents: [],
      legacyId: null,
      createdAt: '2026-07-12T10:00:00.000Z',
    };
    const readyAttachment = {
      id: 'attachment-1',
      lessonId: lesson.id,
      fileName: 'worksheet.pdf',
      contentType: 'application/pdf',
      sizeBytes: 7,
      status: 'ready' as const,
      createdAt: '2026-08-03T12:00:00.000Z',
      downloadPath: '/api/student/lessons/lesson-1/attachments/attachment-1/download',
    };
    let completed = false;
    let directUploadCalled = false;
    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [lesson] } })),
      http.get('/api/lessons/:lessonId/attachments', () =>
        HttpResponse.json({
          ok: true,
          data: { attachments: completed ? [readyAttachment] : [] },
        }),
      ),
      http.post('/api/lessons/:lessonId/attachments/upload', () =>
        HttpResponse.json({
          ok: true,
          data: {
            attachment: {
              id: 'attachment-1',
              lessonId: lesson.id,
              fileName: 'worksheet.pdf',
              contentType: 'application/pdf',
              sizeBytes: 7,
              status: 'pending',
              createdAt: '2026-08-03T12:00:00.000Z',
            },
            upload: {
              url: 'https://storage.example.test/upload/attachment-1',
              headers: { 'content-type': 'application/pdf' },
              expiresAt: '2026-08-03T12:15:00.000Z',
            },
          },
        }),
      ),
      http.put('https://storage.example.test/upload/attachment-1', () => {
        directUploadCalled = true;
        return new HttpResponse(null, { status: 200 });
      }),
      http.post('/api/lessons/:lessonId/attachments/:attachmentId/complete', () => {
        completed = true;
        return HttpResponse.json({ ok: true, data: { attachment: readyAttachment } });
      }),
    );

    await renderLessonsAt('/panel/lessons/lesson-1');
    const input = await screen.findByLabelText(pl.lessons.attachmentFileInput);
    await userEvent.upload(input, new File(['content'], 'worksheet.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(directUploadCalled).toBe(true));
    expect(await screen.findByText('worksheet.pdf')).toBeInTheDocument();
    expect(completed).toBe(true);
  });

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
          isPreview: body.isPreview,
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
    await userEvent.type(await screen.findByLabelText(pl.lessons.storageKeyLabel), 'videos/intro.mp4');
    await userEvent.type(screen.getByLabelText(pl.lessons.streamVideoIdLabel), 'vid-1');

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: pl.lessons.typeEmbed }));
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));
    const embedUrlInput = await screen.findByLabelText(pl.lessons.embedUrlLabel);
    await userEvent.type(embedUrlInput, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(screen.getAllByTestId('block-type').map((node) => node.textContent)).toEqual([
      pl.lessons.typeVideo,
      pl.lessons.typeEmbed,
    ]);

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.moveUp({ index: 1 }) }));

    expect(screen.getAllByTestId('block-type').map((node) => node.textContent)).toEqual([
      pl.lessons.typeEmbed,
      pl.lessons.typeVideo,
    ]);

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.createLesson }));

    await waitFor(() => {
      expect(submitted.map((block) => block.type)).toEqual(['embed', 'video']);
    });
    expect(submitted[0]).toEqual({
      type: 'embed',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    });
    expect(await screen.findByText('Reordered Lesson')).toBeInTheDocument();
  });

  it('blocks the free preview switch on a new lesson, which no course references yet', async () => {
    let submittedPreview: boolean | undefined;
    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.post('/api/lessons', async ({ request }) => {
        const body = newCourseLessonSchema.parse(await request.json());
        submittedPreview = body.isPreview;
        const created: CourseLesson = {
          id: 'lesson-preview',
          tenantId: 't1',
          name: body.name,
          isPreview: body.isPreview,
          contents: body.contents,
          legacyId: null,
          createdAt: '2026-07-12T10:00:00.000Z',
        };
        return HttpResponse.json({ ok: true, data: { lesson: created } });
      }),
    );

    await renderLessonsAt('/panel/lessons/new');

    fireEvent.change(await screen.findByLabelText(pl.common.name), { target: { value: 'Preview' } });
    expect(screen.getByRole('switch', { name: pl.lessons.previewLabel })).toBeDisabled();
    expect(screen.getByText(pl.lessons.previewNeedsPublicCourseHint)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: pl.lessons.createLesson }));

    await waitFor(() => expect(submittedPreview).toBe(false));
  });

  it('unblocks the free preview switch once a publicly visible course references the lesson', async () => {
    const existing: CourseLesson = {
      id: 'lesson-1',
      tenantId: 't1',
      name: 'Intro lesson',
      isPreview: false,
      contents: [],
      legacyId: null,
      createdAt: '2026-07-12T10:00:00.000Z',
    };
    let submittedPreview: boolean | undefined;
    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [existing] } })),
      http.get('/api/lessons/references', () =>
        HttpResponse.json(referencesPayload([{ courseId: 'c1', courseName: 'Launch Kit', publiclyVisible: true }])),
      ),
      http.post('/api/lessons/update', async ({ request }) => {
        const body = lessonUpdateInputSchema.parse(await request.json());
        submittedPreview = body.isPreview;
        return HttpResponse.json({
          ok: true,
          data: { lesson: { ...existing, isPreview: body.isPreview ?? existing.isPreview } },
        });
      }),
    );

    await renderLessonsAt('/panel/lessons/lesson-1');

    const preview = await screen.findByRole('switch', { name: pl.lessons.previewLabel });
    await waitFor(() => expect(preview).toBeEnabled());
    expect(screen.getByText(pl.lessons.previewHelper)).toBeInTheDocument();
    await userEvent.click(preview);
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.saveLesson }));

    await waitFor(() => expect(submittedPreview).toBe(true));
  });

  it('keeps the free preview switch blocked when every referencing course stays private', async () => {
    const existing: CourseLesson = {
      id: 'lesson-1',
      tenantId: 't1',
      name: 'Intro lesson',
      isPreview: false,
      contents: [],
      legacyId: null,
      createdAt: '2026-07-12T10:00:00.000Z',
    };
    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [existing] } })),
      http.get('/api/lessons/references', () =>
        HttpResponse.json(referencesPayload([{ courseId: 'c1', courseName: 'Launch Kit', publiclyVisible: false }])),
      ),
    );

    await renderLessonsAt('/panel/lessons/lesson-1');

    expect(await screen.findByRole('switch', { name: pl.lessons.previewLabel })).toBeDisabled();
    expect(screen.getByText(pl.lessons.previewNeedsPublicCourseHint)).toBeInTheDocument();
  });

  it('preloads and updates the free preview setting for an existing lesson', async () => {
    const existing: CourseLesson = {
      id: 'lesson-preview',
      tenantId: 't1',
      name: 'Preview lesson',
      isPreview: true,
      contents: [],
      legacyId: null,
      createdAt: '2026-07-12T10:00:00.000Z',
    };
    let submittedPreview: boolean | undefined;
    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [existing] } })),
      http.post('/api/lessons/update', async ({ request }) => {
        const body = lessonUpdateInputSchema.parse(await request.json());
        submittedPreview = body.isPreview;
        return HttpResponse.json({
          ok: true,
          data: { lesson: { ...existing, isPreview: body.isPreview ?? existing.isPreview } },
        });
      }),
    );

    await renderLessonsAt('/panel/lessons/lesson-preview');

    const preview = await screen.findByRole('switch', { name: pl.lessons.previewLabel });
    expect(preview).toBeChecked();
    expect(preview).toBeEnabled();
    await userEvent.click(preview);
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.saveLesson }));

    await waitFor(() => expect(submittedPreview).toBe(false));
  });

  it('rejects malformed provider URLs with specific inline and submit messages', async () => {
    server.use(http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })));

    await renderLessonsAt('/panel/lessons/new');

    fireEvent.change(await screen.findByLabelText(pl.common.name), { target: { value: 'Provider validation' } });
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: pl.lessons.typeEmbed }));
    fireEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));
    const embedUrlInput = await screen.findByLabelText(pl.lessons.embedUrlLabel);

    fireEvent.change(embedUrlInput, { target: { value: 'https://youtube.com/watch?v=bad' } });
    expect(screen.getByText(pl.lessons.embedInvalidYoutubeUrl)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: pl.lessons.createLesson }));
    expect(screen.getByRole('alert')).toHaveTextContent(pl.lessons.embedInvalidYoutubeUrl);

    fireEvent.change(embedUrlInput, { target: { value: 'https://player.vimeo.com/video/not-a-number' } });
    expect(screen.getByText(pl.lessons.embedInvalidVimeoUrl)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: pl.lessons.createLesson }));
    expect(screen.getByRole('alert')).toHaveTextContent(pl.lessons.embedInvalidVimeoUrl);
  });

  it.each(privacyNoteScenarios)('renders inline previews and applicable privacy notes $name', async ({ secrets, showBunnyNote }) => {
    const lesson: CourseLesson = {
      id: 'provider-lesson',
      tenantId: 't1',
      name: 'Provider lesson',
      isPreview: false,
      contents: [
        { type: 'video', storageKey: 'video-1', streamVideoId: 'video-1' },
        { type: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' },
        { type: 'embed', embedUrl: 'https://player.vimeo.com/video/76979871' },
      ],
      legacyId: null,
      createdAt: '2026-08-03T08:00:00.000Z',
    };
    server.use(http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [lesson] } })));

    await renderLessonsAt('/panel/lessons/provider-lesson', secrets);

    const expectedNotes = [
      ...(showBunnyNote ? [pl.integrations.bunnySecurityHint] : []),
      pl.lessons.youtubePrivacyNote,
      pl.lessons.vimeoPrivacyNote,
    ];
    await waitFor(() => {
      expect(screen.getAllByRole('note').map((note) => note.textContent)).toEqual(expectedNotes);
    });
    expect(screen.getAllByTestId('embed-preview').map((preview) => preview.getAttribute('src'))).toEqual([
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'https://player.vimeo.com/video/76979871',
    ]);
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

    expect(screen.getByLabelText(pl.lessons.streamVideoIdLabel)).toHaveValue('guid-1');
    expect(screen.getByLabelText(pl.lessons.streamLibraryIdLabel)).toHaveValue('lib-9');
    expect(screen.getByLabelText(pl.lessons.storageKeyLabel)).toHaveValue('guid-1');
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
      '/panel/integrations#video',
    );

    await userEvent.click(screen.getByRole('button', { name: pl.common.cancel }));
    expect(screen.getByLabelText(pl.lessons.storageKeyLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.lessons.streamVideoIdLabel)).toBeInTheDocument();
  });

  it('inserts markup via the toolbar and renders a sanitized live preview', async () => {
    server.use(http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })));

    const { container } = await renderLessonsAt('/panel/lessons/new');

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: pl.lessons.typeHtml }));
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));

    const editor = await screen.findByLabelText(pl.lessons.htmlLabel);
    await userEvent.type(editor, '<p>Safe body</p><script>window.__xss=1</script>');

    await userEvent.click(screen.getByRole('button', { name: pl.htmlEditor.toolbarBold }));
    expect(editor).toHaveValue(
      `<p>Safe body</p><script>window.__xss=1</script><strong>${pl.htmlEditor.placeholderBold}</strong>`,
    );

    await userEvent.click(screen.getByRole('tab', { name: pl.htmlEditor.previewTab }));

    const preview = await screen.findByTestId('html-preview');
    expect(preview).toHaveTextContent('Safe body');
    expect(preview).toHaveTextContent(pl.htmlEditor.placeholderBold);
    expect(container.querySelector('[data-testid="html-preview"] script')).toBeNull();
    expect(screen.queryByText('window.__xss=1')).not.toBeInTheDocument();
  });

  it('previews a link block only once its URL passes the block schema', async () => {
    server.use(http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })));

    await renderLessonsAt('/panel/lessons/new');

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: pl.lessons.typeLink }));
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));

    const urlField = await screen.findByLabelText(pl.lessons.linkUrlLabel);
    expect(urlField).toHaveAccessibleName(pl.lessons.linkUrlLabel);
    expect(urlField).toHaveAccessibleDescription(pl.lessons.technicalFieldHint({ field: 'url' }));

    await userEvent.type(urlField, 'javascript:alert(1)');
    expect(screen.queryByTestId('lesson-links')).not.toBeInTheDocument();

    await userEvent.clear(urlField);
    await userEvent.type(urlField, 'https://github.com/coderoadpl/task-1');
    expect(await screen.findByTestId('lesson-links')).toBeInTheDocument();
    expect(screen.getByText(pl.lessons.blockPreviewLabel)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /github\.com/ })).toHaveAttribute(
      'href',
      'https://github.com/coderoadpl/task-1',
    );
  });

  it('shows the sandbox preview in full as soon as the block editor holds one', async () => {
    server.use(http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })));

    await renderLessonsAt('/panel/lessons/new');

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: pl.lessons.typeLink }));
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));

    await userEvent.type(
      await screen.findByLabelText(pl.lessons.linkUrlLabel),
      'https://codesandbox.io/s/abc123',
    );
    await userEvent.type(await screen.findByLabelText(pl.lessons.linkDescriptionLabel), 'Zadanie');

    const sandbox = await screen.findByTestId('lesson-sandbox');
    expect(sandbox).toHaveAttribute('src', 'https://codesandbox.io/embed/abc123');
    expect(screen.queryByTestId('lesson-sandbox-caption')).not.toBeInTheDocument();
    expect(stylesAt(sandbox.parentElement?.parentElement, 375)).toMatchObject({
      'margin-left': '0px',
      'margin-right': '0px',
    });
  });

  it('submits the collapsed flag from the embed block checkbox and collapses the preview', async () => {
    let submitted: LessonBlock[] = [];
    server.use(
      http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons: [] } })),
      http.post('/api/lessons', async ({ request }) => {
        const body = newCourseLessonSchema.parse(await request.json());
        submitted = body.contents;
        return HttpResponse.json({
          ok: true,
          data: {
            lesson: {
              id: 'lesson-new',
              tenantId: 't1',
              name: body.name,
              isPreview: body.isPreview,
              contents: body.contents,
              legacyId: null,
              createdAt: '2026-07-12T10:00:00.000Z',
            },
          },
        });
      }),
    );

    await renderLessonsAt('/panel/lessons/new');

    await userEvent.type(await screen.findByLabelText(pl.common.name), 'Dialogs');
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: pl.lessons.typeEmbed }));
    await userEvent.click(screen.getByRole('button', { name: pl.lessons.addBlock }));
    await userEvent.type(
      await screen.findByLabelText(pl.lessons.embedUrlLabel),
      'https://codesandbox.io/s/alert-demo',
    );

    expect(await screen.findByTestId('lesson-sandbox')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: pl.lessons.embedCollapsedLabel }));

    await waitFor(() => {
      expect(screen.queryByTestId('lesson-sandbox')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('lesson-embed-collapsed-warning')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.createLesson }));

    await waitFor(() => {
      expect(submitted).toEqual([
        { type: 'embed', embedUrl: 'https://codesandbox.io/s/alert-demo', collapsed: true },
      ]);
    });
  });

  it('filters lessons by name and by content type', async () => {
    const lessons: CourseLesson[] = [
      {
        id: 'l1',
        tenantId: 't1',
        name: 'Video intro',
        isPreview: false,
        contents: [{ type: 'video', storageKey: 'videos/a.mp4', streamVideoId: 'vid-1' }],
        legacyId: null,
        createdAt: '2026-07-10T10:00:00.000Z',
      },
      {
        id: 'l2',
        tenantId: 't1',
        name: 'Reading list',
        isPreview: false,
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
        isPreview: false,
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
              courses: [{ courseId: 'c1', courseName: 'Course', publiclyVisible: false }],
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
              courses: [],
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
