import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { newCourseLessonSchema, type CourseLesson, type LessonBlock } from '@core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { LessonsSection } from './LessonsSection.js';

describe('LessonsSection blocks editor', () => {
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

    renderWithProviders(<LessonsSection />);

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

    renderWithProviders(<LessonsSection />);

    await userEvent.click(await screen.findByRole('button', { name: pl.lessons.deleteAria({ name: 'Intro lesson' }) }));

    expect(await screen.findByText(pl.lessons.deleteReferencesChapters({ count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(pl.lessons.deleteReferencesProducts({ count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(pl.lessons.deleteReferencesProgress({ count: 2 }))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.lessons.deleteConfirm }));

    await waitFor(() => expect(deleted).toBe(true));
    expect(await screen.findByText(pl.lessons.empty)).toBeInTheDocument();
  });
});
