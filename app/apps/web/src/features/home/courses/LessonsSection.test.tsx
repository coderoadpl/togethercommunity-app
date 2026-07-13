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
});
