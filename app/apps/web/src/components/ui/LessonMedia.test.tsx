import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';

import { LanguageProvider } from '../../i18n/index.js';
import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import { languagePreference } from '../../theme-mode.js';
import { createThemeForMode, LESSON_VIDEO_FRAME_SX } from '../../theme.js';
import { LessonMediaEmbed } from './LessonMedia.js';

const embed = (src = 'https://courses.example.org/video') => <LessonMediaEmbed src={src} externalUrl="https://courses.example.org/watch" title="Lesson video" frameSx={LESSON_VIDEO_FRAME_SX} />;

describe('LessonMediaEmbed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the skeleton until 15 seconds, then retries with a fresh iframe and timer', async () => {
    render(embed());
    const first = screen.getByTitle('Lesson video');
    await act(() => vi.advanceTimersByTime(14_999));
    expect(screen.getByTestId('lesson-media-skeleton')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent(en.lesson.mediaFailedTitle);
    expect(screen.queryByTitle('Lesson video')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.lesson.mediaOpenExternal })).toHaveAttribute('href', 'https://courses.example.org/watch');
    fireEvent.click(screen.getByRole('button', { name: en.common.retry }));
    expect(screen.getByTitle('Lesson video')).not.toBe(first);
    expect(screen.getByTestId('lesson-media-skeleton')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('status')).toHaveTextContent(en.lesson.mediaFailedTitle);
  });

  it('clears the timeout when the iframe loads and resets on a source change', async () => {
    const view = render(embed());
    fireEvent.load(screen.getByTitle('Lesson video'));
    await act(() => vi.advanceTimersByTime(15_000));
    expect(screen.queryByTestId('lesson-media-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    view.rerender(embed('https://courses.example.org/next'));
    expect(screen.getByTestId('lesson-media-skeleton')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('does not time out a lazy iframe before it loads and still handles errors', async () => {
    render(<LessonMediaEmbed src="https://courses.example.org/sandbox" title="Lazy material" frameSx={LESSON_VIDEO_FRAME_SX} loading="lazy" />);
    const iframe = screen.getByTitle('Lazy material');
    await act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId('lesson-media-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.load(iframe);
    expect(screen.queryByTestId('lesson-media-skeleton')).not.toBeInTheDocument();
    fireEvent.error(iframe);
    expect(screen.getByRole('status')).toHaveTextContent(en.lesson.mediaFailedTitle);
    fireEvent.click(screen.getByRole('button', { name: en.common.retry }));
    expect(screen.getByTitle('Lazy material')).not.toBe(iframe);
    await act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not expose a signed embed source as an external recovery link', () => {
    render(<LessonMediaEmbed src="https://courses.example.org/video?token=signed-token" title="Signed video" frameSx={LESSON_VIDEO_FRAME_SX} />);
    fireEvent.error(screen.getByTitle('Signed video'));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('cleans up the pending timer on unmount', () => {
    const view = render(embed());
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['pl', 'en'] as const)('shows an iframe error in %s in both schemes', (locale) => {
    languagePreference.save(locale);
    const messages = locale === 'pl' ? pl : en;
    for (const scheme of ['light', 'dark'] as const) {
      const view = render(<ThemeProvider theme={createThemeForMode('shadcn', undefined, scheme, 'member')}><LanguageProvider>{embed()}</LanguageProvider></ThemeProvider>);
      fireEvent.error(screen.getByTitle('Lesson video'));
      expect(screen.getByRole('status')).toHaveTextContent(messages.lesson.mediaFailedTitle);
      expect(screen.getByRole('button', { name: messages.common.retry })).toBeEnabled();
      view.unmount();
    }
  });
});
