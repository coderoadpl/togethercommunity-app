import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { HistoryPanel } from './HistoryPanel.js';

const version = (over: Record<string, unknown>) => ({
  id: 'version-1',
  entityKind: 'course',
  entityId: 'course-1',
  ordinal: 1,
  schemaVersion: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'user-creator',
  createdByDisplayName: 'Ada Creator',
  subjectKind: 'course',
  subjectName: 'Course one',
  ...over,
});

describe('HistoryPanel', () => {
  it('labels entries by their ordinal and keeps the schema version as fine print', async () => {
    server.use(
      http.get('/api/courses/history', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('courseId')).toBe('course-1');
        return HttpResponse.json({
          ok: true,
          data: {
            versions: [
              version({ id: 'version-2', ordinal: 2, entityKind: 'course_module', entityId: 'module-1', subjectKind: 'module', subjectName: 'Foundations', createdAt: '2026-01-02T00:00:00.000Z' }),
              version({}),
            ],
          },
        });
      }),
    );

    renderWithProviders(<HistoryPanel courseId="course-1" />);

    expect(await screen.findByText(pl.courses.historyHint)).toBeInTheDocument();
    expect(screen.getByText(pl.courses.historyHeading)).toBeInTheDocument();
    expect(
      await screen.findAllByText((content) => content.includes('Wersja ') && content.includes('Ada Creator')),
    ).toHaveLength(2);
    expect(screen.queryByText((content) => content.includes('Schemat v'))).not.toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Kurs: Course one') && content.includes('schemat v4')),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Moduł: Foundations')),
    ).toBeInTheDocument();
  });

  it('opens a read-only preview with the field diff against the current state', async () => {
    server.use(
      http.get('/api/courses/history', () =>
        HttpResponse.json({ ok: true, data: { versions: [version({})] } }),
      ),
      http.get('/api/courses/history/version', ({ request }) => {
        expect(new URL(request.url).searchParams.get('id')).toBe('version-1');
        return HttpResponse.json({
          ok: true,
          data: {
            version: { ...version({}), currentSchemaVersion: 4, payload: {} },
            preview: {
              fields: [
                { name: 'title', value: { kind: 'text', value: 'Old title' } },
                { name: 'publiclyVisible', value: { kind: 'flag', value: false } },
              ],
            },
            current: {
              fields: [
                { name: 'title', value: { kind: 'text', value: 'New title' } },
                { name: 'publiclyVisible', value: { kind: 'flag', value: false } },
              ],
            },
            changedFields: ['title'],
          },
        });
      }),
    );

    renderWithProviders(<HistoryPanel courseId="course-1" />);
    await userEvent.click(
      await screen.findByRole('button', { name: pl.courses.historyOpenAria({ ordinal: 1 }) }),
    );

    expect(await screen.findByText(pl.courses.versionDialogTitle({ ordinal: 1 }))).toBeInTheDocument();
    expect(screen.getByText('Old title')).toBeInTheDocument();
    expect(screen.getByText('New title')).toBeInTheDocument();
    expect(screen.getByTestId('version-field-title')).toHaveAttribute('data-changed', 'true');
    expect(screen.getByTestId('version-field-publiclyVisible')).toHaveAttribute('data-changed', 'false');
  });

  it('restores a version only after the confirmation is accepted', async () => {
    const restored: unknown[] = [];
    server.use(
      http.get('/api/courses/history', () =>
        HttpResponse.json({ ok: true, data: { versions: [version({})] } }),
      ),
      http.get('/api/courses/history/version', () =>
        HttpResponse.json({
          ok: true,
          data: {
            version: { ...version({}), currentSchemaVersion: 4, payload: {} },
            preview: { fields: [{ name: 'title', value: { kind: 'text', value: 'Old title' } }] },
            current: { fields: [{ name: 'title', value: { kind: 'text', value: 'New title' } }] },
            changedFields: ['title'],
          },
        }),
      ),
      http.post('/api/courses/history/restore', async ({ request }) => {
        restored.push(await request.json());
        return HttpResponse.json({
          ok: true,
          data: {
            restored: {
              entityKind: 'course',
              entityId: 'course-1',
              restoredFromVersionId: 'version-1',
              restoredFromOrdinal: 1,
            },
          },
        });
      }),
    );

    renderWithProviders(<HistoryPanel courseId="course-1" />);
    await userEvent.click(
      await screen.findByRole('button', { name: pl.courses.historyOpenAria({ ordinal: 1 }) }),
    );
    await userEvent.click(await screen.findByTestId('version-restore'));

    expect(await screen.findByText(pl.courses.versionRestoreConfirmTitle)).toBeInTheDocument();
    expect(restored).toEqual([]);

    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(restored).toEqual([{ versionId: 'version-1' }]));
    expect(
      await screen.findByText(pl.courses.versionRestoreDone({ ordinal: 1 })),
    ).toBeInTheDocument();
  });

  it('shows the empty state when a course has no snapshots yet', async () => {
    server.use(
      http.get('/api/courses/history', () =>
        HttpResponse.json({ ok: true, data: { versions: [] } }),
      ),
    );

    renderWithProviders(<HistoryPanel courseId="course-2" />);

    expect(await screen.findByText(pl.courses.historyEmpty)).toBeInTheDocument();
    expect(screen.getByText(pl.courses.historyEmptyBody)).toBeInTheDocument();
  });
});
