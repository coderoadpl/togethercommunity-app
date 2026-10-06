import { QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { actions } from '../../api.js';
import { server } from '../../test/server.js';
import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { LessonEditionBadge, LessonEditionBanner, LessonEditionControls, LessonEditionMenu, LessonEditionsList } from './LessonEditions.js';

const editions = [
  { number: '10', note: 'Revised examples', markedAt: '2026-10-01T12:00:00.000Z' },
  { number: '2.1', note: null, markedAt: '2026-09-01T12:00:00.000Z' },
];

describe('lesson editions', () => {
  it('labels the displayed edition discreetly', () => {
    renderWithProviders(<LessonEditionBadge number="2.1" />);
    expect(screen.getByTestId('lesson-edition-badge')).toHaveTextContent('Edition 2.1');
  });

  it.each([{ available: [] }, { available: editions.slice(0, 1) }])('omits the menu without previous editions', ({ available }) => {
    renderWithProviders(<LessonEditionMenu editions={available} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: en.lesson.editionMenu })).not.toBeInTheDocument();
  });

  it('keeps the edition list behind the overflow menu and selects a numbered edition', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<LessonEditionMenu editions={editions} onSelect={onSelect} />);
    expect(screen.queryByText(en.lesson.previousEditions)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.lesson.editionMenu }));
    await userEvent.click(screen.getByRole('menuitem', { name: en.lesson.previousEditions }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Revised examples');
    await userEvent.click(screen.getByRole('button', { name: /Edition 2.1/ }));
    expect(onSelect).toHaveBeenCalledWith('2.1');
  });

  it('shows each edition number, date and optional note in the supplied numeric order', () => {
    renderWithProviders(<LessonEditionsList editions={editions} onSelect={vi.fn()} />);
    const items = screen.getAllByRole('button');
    expect(items[0]).toHaveTextContent('Edition 10');
    expect(items[0]).toHaveTextContent('Oct 1, 2026');
    expect(items[0]).toHaveTextContent('Revised examples');
    expect(items[1]).toHaveTextContent('Edition 2.1');
  });

  it('defers the editions request until lesson content has loaded successfully', async () => {
    const reads = vi.fn(() => HttpResponse.json({ ok: true, data: { editions } }));
    server.use(http.get('/api/student/lessons/l1/editions', reads));
    const view = renderWithProviders(<LessonEditionControls lessonId="l1" enabled={false} onSelect={vi.fn()} />);
    expect(view.queryClient.getQueryState(actions.studentLessonEditions('l1').queryKey)?.fetchStatus).toBe('idle');
    expect(reads).not.toHaveBeenCalled();
    view.rerender(<QueryClientProvider client={view.queryClient}><LessonEditionControls lessonId="l1" enabled onSelect={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByTestId('lesson-edition-badge')).toHaveTextContent('Edition 10');
    expect(reads).toHaveBeenCalledOnce();
  });

  it('prominently warns about historical content and returns to the current lesson', async () => {
    const onCurrent = vi.fn();
    renderWithProviders(<LessonEditionBanner onCurrent={onCurrent} />);
    expect(screen.getByRole('alert')).toHaveTextContent(en.lesson.editionOlderWarning);
    await userEvent.click(screen.getByRole('button', { name: en.lesson.editionBackToCurrent }));
    expect(onCurrent).toHaveBeenCalledOnce();
  });
});
