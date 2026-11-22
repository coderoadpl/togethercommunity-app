import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { actions } from '../../api.js';
import { server } from '../../test/server.js';
import { en } from '../../i18n/en.js';
import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { languagePreference } from '../../theme-mode.js';
import { LessonEditionBadge, LessonEditionBanner, LessonEditionControls, LessonEditionNotice, LessonEditionPicker, LessonEditionsList } from './LessonEditions.js';

const editions = [
  { number: '10', note: 'Revised examples', markedAt: '2026-10-01T12:00:00.000Z' },
  { number: '2.1', note: null, markedAt: '2026-09-01T12:00:00.000Z' },
];

const inPolish = (ui: ReactElement) => {
  languagePreference.save('pl');
  return renderWithProviders(<LanguageProvider>{ui}</LanguageProvider>);
};

const picker = (props: Partial<Parameters<typeof LessonEditionPicker>[0]> = {}) => {
  const onSelect = vi.fn();
  const onCurrent = vi.fn();
  renderWithProviders(<LessonEditionPicker editions={editions} currentEdition="10" onSelect={onSelect} onCurrent={onCurrent} {...props} />);
  return { onSelect, onCurrent };
};

describe('lesson editions', () => {
  it('labels the displayed edition discreetly', () => {
    renderWithProviders(<LessonEditionBadge number="2.1" />);
    expect(screen.getByTestId('lesson-edition-badge')).toHaveTextContent('Edition 2.1');
  });

  it('shows nothing without editions and a static badge when the only edition is the live lesson', () => {
    const { unmount } = renderWithProviders(<LessonEditionPicker editions={[]} currentEdition={null} onSelect={vi.fn()} onCurrent={vi.fn()} />);
    expect(screen.queryByTestId('lesson-edition-badge')).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<LessonEditionPicker editions={editions.slice(0, 1)} currentEdition="10" onSelect={vi.fn()} onCurrent={vi.fn()} />);
    expect(screen.getByTestId('lesson-edition-badge')).toHaveTextContent('Edition 10');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    { currentEdition: '10', viewing: undefined, label: 'Edition 10' },
    { currentEdition: null, viewing: undefined, label: en.lesson.editionCurrentVersion },
    { currentEdition: '10', viewing: '2.1', label: 'Edition 2.1' },
    { currentEdition: '10', viewing: '10', label: 'Edition 10' },
  ])('labels the trigger with what is on screen: $label', ({ currentEdition, viewing, label }) => {
    picker({ currentEdition, viewing });
    expect(screen.getByTestId('lesson-edition-badge')).toHaveTextContent(label);
  });

  it('opens the editions dialog straight from the badge and closes it with a visible control', async () => {
    picker();
    const trigger = screen.getByRole('button', { name: 'Edition 10' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.querySelector('svg')).not.toBeNull();
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: en.lesson.editionsTitle });
    expect(document.querySelectorAll(`[id="${dialog.getAttribute('aria-labelledby') ?? ''}"]`)).toHaveLength(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('lists the live lesson first as current and does not repeat its matching edition', async () => {
    const { onSelect, onCurrent } = picker({ viewing: '2.1' });
    await userEvent.click(screen.getByTestId('lesson-edition-badge'));
    const rows = within(screen.getByTestId('lesson-editions-list')).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Edition 10');
    expect(rows[0]).toHaveTextContent(en.lesson.editionCurrentMark);
    expect(rows[0]).toHaveTextContent('Oct 1, 2026');
    expect(rows[0]).toHaveTextContent('Revised examples');
    expect(rows[0]).not.toHaveAttribute('aria-current');
    expect(rows[1]).toHaveTextContent('Edition 2.1');
    expect(rows[1]).not.toHaveTextContent(en.lesson.editionCurrentMark);
    expect(rows[1]).toHaveAttribute('aria-current', 'page');
    expect(rows[1]).toHaveClass('Mui-selected');
    expect(rows[1]?.querySelector('svg')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Edition 10/ }));
    expect(onCurrent).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('names the live lesson the current version when no edition matches it', async () => {
    const { onSelect, onCurrent } = picker({ currentEdition: null });
    await userEvent.click(screen.getByTestId('lesson-edition-badge'));
    const rows = within(screen.getByTestId('lesson-editions-list')).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      en.lesson.editionCurrentVersion,
      'Edition 10Oct 1, 2026Revised examples',
      'Edition 2.1Sep 1, 2026',
    ]);
    expect(rows[0]).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(screen.getByTestId('lesson-editions-list')).getByRole('button', { name: en.lesson.editionCurrentVersion }));
    expect(onCurrent).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId('lesson-edition-badge'));
    await userEvent.click(screen.getByRole('button', { name: /Edition 2.1/ }));
    expect(onSelect).toHaveBeenCalledWith('2.1');
  });

  it('marks the live row on an edition URL whose content equals the live lesson', () => {
    renderWithProviders(<LessonEditionsList editions={editions} currentEdition="10" viewing="10" onSelect={vi.fn()} onCurrent={vi.fn()} />);
    const rows = screen.getAllByRole('button');
    expect(rows[0]).toHaveAttribute('aria-current', 'page');
    expect(rows[1]).not.toHaveAttribute('aria-current');
  });

  it('titles the dialog in Polish', async () => {
    inPolish(<LessonEditionPicker editions={editions} currentEdition={null} onSelect={vi.fn()} onCurrent={vi.fn()} />);
    expect(screen.getByTestId('lesson-edition-badge')).toHaveTextContent(pl.lesson.editionCurrentVersion);
    await userEvent.click(screen.getByTestId('lesson-edition-badge'));
    expect(screen.getByRole('dialog', { name: pl.lesson.editionsTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.common.close })).toBeInTheDocument();
  });

  it('defers the editions request until lesson content has loaded successfully', async () => {
    const reads = vi.fn(() => HttpResponse.json({ ok: true, data: { editions, currentEdition: '10' } }));
    server.use(http.get('/api/student/lessons/l1/editions', reads));
    const view = renderWithProviders(<LessonEditionControls lessonId="l1" enabled={false} onSelect={vi.fn()} onCurrent={vi.fn()} />);
    expect(view.queryClient.getQueryState(actions.studentLessonEditions('l1').queryKey)?.fetchStatus).toBe('idle');
    expect(reads).not.toHaveBeenCalled();
    view.rerender(<QueryClientProvider client={view.queryClient}><LessonEditionControls lessonId="l1" enabled onSelect={vi.fn()} onCurrent={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByTestId('lesson-edition-badge')).toHaveTextContent('Edition 10');
    expect(reads).toHaveBeenCalledOnce();
  });

  it('names the older edition and its date and leads to the current lesson', async () => {
    const onCurrent = vi.fn();
    renderWithProviders(<LessonEditionBanner number="2.1" markedAt="2026-09-01T12:00:00.000Z" onCurrent={onCurrent} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This is edition 2.1 from Sep 1, 2026. The lesson has newer content.');
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-standard', 'MuiAlert-colorWarning');
    expect(screen.getByRole('alert').querySelector('.MuiAlert-action')).toContainElement(screen.getByRole('button', { name: en.lesson.editionGoToCurrent }));
    await userEvent.click(screen.getByRole('button', { name: en.lesson.editionGoToCurrent }));
    expect(onCurrent).toHaveBeenCalledOnce();
  });

  it('words the banner in Polish without a reading or watching verb', () => {
    inPolish(<LessonEditionBanner number="2.1" markedAt="2026-09-01T12:00:00.000Z" onCurrent={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(pl.lesson.editionOlderNotice({ number: '2.1', date: new Intl.DateTimeFormat('pl', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-09-01T12:00:00.000Z')) }));
    expect(screen.getByRole('button', { name: pl.lesson.editionGoToCurrent })).toBeInTheDocument();
  });

  it.each([
    { currentEdition: '10', viewing: '2.1', banner: 'This is edition 2.1 from Sep 1, 2026. The lesson has newer content.' },
    { currentEdition: '2.1', viewing: '2.1', banner: null },
    { currentEdition: null, viewing: '10', banner: 'This is edition 10 from Oct 1, 2026. The lesson has newer content.' },
  ])('shows the banner on edition $viewing only when it differs from the live lesson', async ({ currentEdition, viewing, banner }) => {
    server.use(http.get('/api/student/lessons/l1/editions', () => HttpResponse.json({ ok: true, data: { editions, currentEdition } })));
    const view = renderWithProviders(<LessonEditionNotice lessonId="l1" editionNumber={viewing} enabled onCurrent={vi.fn()} />);
    await vi.waitFor(() => expect(view.queryClient.getQueryState(actions.studentLessonEditions('l1').queryKey)?.status).toBe('success'));
    if (banner === null) expect(screen.queryByTestId('lesson-edition-banner')).not.toBeInTheDocument();
    else expect(await screen.findByTestId('lesson-edition-banner')).toHaveTextContent(banner);
  });

  it('keeps the banner without a date when the editions cannot be read', async () => {
    server.use(http.get('/api/student/lessons/l1/editions', () => HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Down' } }, { status: 500 })));
    renderWithProviders(<LessonEditionNotice lessonId="l1" editionNumber="2.1" enabled onCurrent={vi.fn()} />);
    expect(await screen.findByTestId('lesson-edition-banner')).toHaveTextContent('This is edition 2.1. The lesson has newer content.');
  });
});
