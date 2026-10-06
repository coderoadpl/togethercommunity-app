import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { LessonEditionEditor } from './LessonEditionEditor.js';

const edition = { versionId: 'version-1', number: '2', note: 'Updated examples', markedAt: '2026-10-01T00:00:00.000Z' };

describe('LessonEditionEditor', () => {
  it('marks the saved current content and validates edition numbers', async () => {
    let received: unknown;
    server.use(http.post('/api/courses/history/edition/mark', async ({ request }) => {
      received = await request.json();
      return HttpResponse.json({ ok: true, data: { edition } });
    }));
    renderWithProviders(<LessonEditionEditor lessonId="lesson-1" edition={null} />);
    const number = screen.getByRole('textbox', { name: en.courses.editionNumber });
    const mark = screen.getByRole('button', { name: en.courses.editionMark });
    expect(mark).toBeDisabled();
    await userEvent.type(number, '02');
    expect(mark).toBeDisabled();
    await userEvent.clear(number);
    await userEvent.type(number, '2');
    await userEvent.type(screen.getByRole('textbox', { name: en.courses.editionNote }), 'Updated examples');
    await userEvent.click(mark);
    await waitFor(() => expect(received).toEqual({ lessonId: 'lesson-1', edition: { number: '2', note: 'Updated examples' } }));
    expect(await screen.findByText(en.courses.editionSaved)).toBeInTheDocument();
  });

  it('updates a selected stored version and can hide its edition', async () => {
    let marked: unknown;
    let removed: unknown;
    server.use(
      http.post('/api/courses/history/edition/mark', async ({ request }) => {
        marked = await request.json();
        return HttpResponse.json({ ok: true, data: { edition } });
      }),
      http.post('/api/courses/history/edition/unmark', async ({ request }) => {
        removed = await request.json();
        return HttpResponse.json({ ok: true, data: { removed: true } });
      }),
    );
    renderWithProviders(<LessonEditionEditor lessonId="lesson-1" versionId="version-1" edition={edition} />);
    const note = screen.getByRole('textbox', { name: en.courses.editionNote });
    expect(note).toHaveAttribute('maxlength', '200');
    await userEvent.clear(note);
    await userEvent.type(note, 'Revised note');
    await userEvent.click(screen.getByRole('button', { name: en.courses.editionUpdate }));
    await waitFor(() => expect(marked).toEqual({ lessonId: 'lesson-1', versionId: 'version-1', edition: { number: '2', note: 'Revised note' } }));
    await userEvent.click(screen.getByRole('button', { name: en.courses.editionUnmark }));
    await waitFor(() => expect(removed).toEqual({ lessonId: 'lesson-1', number: '2' }));
    expect(await screen.findByText(en.courses.editionRemoved)).toBeInTheDocument();
  });

  it('explains when another version already uses the edition number', async () => {
    server.use(http.post('/api/courses/history/edition/mark', () => HttpResponse.json({
      ok: false, error: { code: 'conflict', message: 'Edition number already exists for this lesson' },
    }, { status: 409 })));
    renderWithProviders(<LessonEditionEditor lessonId="lesson-1" edition={null} />);
    await userEvent.type(screen.getByRole('textbox', { name: en.courses.editionNumber }), '2');
    await userEvent.click(screen.getByRole('button', { name: en.courses.editionMark }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.courses.editionNumberConflict);
  });

  it('prevents marking while lesson edits are unsaved', () => {
    renderWithProviders(<LessonEditionEditor lessonId="lesson-1" edition={edition} disabled />);
    expect(screen.getByRole('button', { name: en.courses.editionUpdate })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.courses.editionUnmark })).toBeDisabled();
    expect(screen.getByText(en.courses.editionCurrentHint)).toBeInTheDocument();
  });
});
