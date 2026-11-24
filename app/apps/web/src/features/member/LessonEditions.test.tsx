import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { darken, lighten, type Theme } from '@mui/material/styles';
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
import { stylesAt } from '../../lib/stylesheet.js';
import { renderWithProviders } from '../../test/render.js';
import { createThemeForMode, MODES } from '../../theme.js';
import { languagePreference } from '../../theme-mode.js';
import { LessonEditionBadge, LessonEditionBanner, LessonEditionControls, LessonEditionNotice, LessonEditionPicker, LessonEditionsList } from './LessonEditions.js';

const editions = [
  { number: '10', note: 'Revised examples', markedAt: '2026-10-01T12:00:00.000Z' },
  { number: '2.1', note: null, markedAt: '2026-09-01T12:00:00.000Z' },
];

const editionsMatching = (matching: readonly string[]) => ({
  editions: editions.map((edition) => ({ ...edition, matchesLive: matching.includes(edition.number) })),
  currentEdition: matching[0] ?? null,
});

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

  it.each(['scoreboard', 'logbook', 'shadcn'] as const)('keeps the %s list card hover effects off the edition rows', (mode) => {
    renderWithProviders(<ThemeProvider theme={createThemeForMode(mode)}><LessonEditionsList editions={editions} currentEdition="10" onSelect={vi.fn()} onCurrent={vi.fn()} /></ThemeProvider>);
    const row = screen.getByTestId('lesson-editions-list').querySelector('.MuiListItem-root');
    expect(stylesAt(row, 1440)).toMatchObject({ 'box-shadow': 'none', transform: 'none', 'background-image': 'none' });
  });

  it('titles the dialog in Polish', async () => {
    inPolish(<LessonEditionPicker editions={editions} currentEdition={null} onSelect={vi.fn()} onCurrent={vi.fn()} />);
    expect(screen.getByTestId('lesson-edition-badge')).toHaveTextContent(pl.lesson.editionCurrentVersion);
    await userEvent.click(screen.getByTestId('lesson-edition-badge'));
    expect(screen.getByRole('dialog', { name: pl.lesson.editionsTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.common.close })).toBeInTheDocument();
  });

  it('defers the editions request until lesson content has loaded successfully', async () => {
    const reads = vi.fn(() => HttpResponse.json({ ok: true, data: editionsMatching(['10']) }));
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
    expect(screen.getByRole('alert')).toHaveTextContent('This is edition 2.1 from September 1, 2026. It differs from the current lesson.');
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-standard', 'MuiAlert-colorWarning');
    expect(screen.getByRole('alert').querySelector('.MuiAlert-action')).toContainElement(screen.getByRole('button', { name: en.lesson.editionGoToCurrent }));
    await userEvent.click(screen.getByRole('button', { name: en.lesson.editionGoToCurrent }));
    expect(onCurrent).toHaveBeenCalledOnce();
  });

  it.each([
    ...MODES.flatMap((mode) => (['light', 'dark'] as const).map((scheme) => ({ name: `${mode.id}/${scheme}`, theme: createThemeForMode(mode.id, undefined, scheme) }))),
    ...(['light', 'dark'] as const).map((scheme) => ({ name: `shadcn member/${scheme}`, theme: createThemeForMode('shadcn', undefined, scheme, 'member') })),
  ])('tints the banner as a standard alert of its severity in the $name theme', ({ theme }) => {
    const tint = (current: Theme, color: 'warning' | 'info') => current.palette.mode === 'light'
      ? { background: lighten(current.palette[color].light, 0.9), text: darken(current.palette[color].light, 0.6) }
      : { background: darken(current.palette[color].light, 0.9), text: lighten(current.palette[color].light, 0.6) };
    const { unmount } = renderWithProviders(<ThemeProvider theme={theme}><LessonEditionBanner number="2.1" markedAt="2026-09-01T12:00:00.000Z" onCurrent={vi.fn()} /></ThemeProvider>);
    expect(stylesAt(screen.getByRole('alert'), 1440)).toMatchObject({
      'background-color': tint(theme, 'warning').background,
      color: tint(theme, 'warning').text,
    });
    unmount();
    renderWithProviders(<ThemeProvider theme={theme}><LessonEditionBanner number="2.1" onCurrent={vi.fn()} /></ThemeProvider>);
    expect(stylesAt(screen.getByRole('alert'), 1440)).toMatchObject({
      'background-color': tint(theme, 'info').background,
      color: tint(theme, 'info').text,
    });
  });

  it('words the banner in Polish without a reading or watching verb', () => {
    inPolish(<LessonEditionBanner number="2.1" markedAt="2026-09-01T12:00:00.000Z" onCurrent={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(pl.lesson.editionOlderNotice({ number: '2.1', date: new Intl.DateTimeFormat('pl', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date('2026-09-01T12:00:00.000Z')) }));
    expect(screen.getByRole('button', { name: pl.lesson.editionGoToCurrent })).toBeInTheDocument();
  });

  it.each([
    { matching: ['10'], viewing: '2.1', banner: 'This is edition 2.1 from September 1, 2026. It differs from the current lesson.' },
    { matching: ['2.1'], viewing: '2.1', banner: null },
    { matching: [], viewing: '10', banner: 'This is edition 10 from October 1, 2026. It differs from the current lesson.' },
    { matching: ['10', '2.1'], viewing: '10', banner: null },
    { matching: ['10', '2.1'], viewing: '2.1', banner: null },
  ])('shows the banner on edition $viewing only when it differs from the live lesson (matching $matching)', async ({ matching, viewing, banner }) => {
    server.use(http.get('/api/student/lessons/l1/editions', () => HttpResponse.json({ ok: true, data: editionsMatching(matching) })));
    const view = renderWithProviders(<LessonEditionNotice lessonId="l1" editionNumber={viewing} enabled onCurrent={vi.fn()} />);
    await vi.waitFor(() => expect(view.queryClient.getQueryState(actions.studentLessonEditions('l1').queryKey)?.status).toBe('success'));
    if (banner === null) expect(screen.queryByTestId('lesson-edition-banner')).not.toBeInTheDocument();
    else expect(await screen.findByTestId('lesson-edition-banner')).toHaveTextContent(banner);
  });

  it('names the edition without claiming newer content when the editions were never read', async () => {
    server.use(http.get('/api/student/lessons/l1/editions', () => HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Down' } }, { status: 500 })));
    renderWithProviders(<LessonEditionNotice lessonId="l1" editionNumber="2.1" enabled onCurrent={vi.fn()} />);
    const banner = await screen.findByTestId('lesson-edition-banner');
    expect(banner).toHaveTextContent(/^This is edition 2\.1\.Go to the current lesson$/);
    expect(banner).toHaveClass('MuiAlert-colorInfo');
  });

  it('keeps a matching edition free of the banner when a later read fails', async () => {
    server.use(http.get('/api/student/lessons/l1/editions', () => HttpResponse.json({ ok: true, data: editionsMatching(['10', '2.1']) })));
    const view = renderWithProviders(<LessonEditionNotice lessonId="l1" editionNumber="2.1" enabled onCurrent={vi.fn()} />);
    const queryKey = actions.studentLessonEditions('l1').queryKey;
    await vi.waitFor(() => expect(view.queryClient.getQueryState(queryKey)?.status).toBe('success'));
    server.use(http.get('/api/student/lessons/l1/editions', () => HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Down' } }, { status: 500 })));
    await view.queryClient.refetchQueries({ queryKey });
    await vi.waitFor(() => expect(view.queryClient.getQueryState(queryKey)?.status).toBe('error'));
    expect(screen.queryByTestId('lesson-edition-banner')).not.toBeInTheDocument();
  });

  it('names an edition missing from the list without claiming newer content', async () => {
    server.use(http.get('/api/student/lessons/l1/editions', () => HttpResponse.json({ ok: true, data: editionsMatching(['10']) })));
    renderWithProviders(<LessonEditionNotice lessonId="l1" editionNumber="3" enabled onCurrent={vi.fn()} />);
    expect(await screen.findByTestId('lesson-edition-banner')).toHaveTextContent(/^This is edition 3\.Go to the current lesson$/);
  });
});
