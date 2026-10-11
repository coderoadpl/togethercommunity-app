import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../../i18n/en.js';
import { stylesAt } from '../../lib/stylesheet.js';
import { LESSON_TEXT_REVEAL_EVENT, LessonReadingContent } from './LessonReadingContent.js';
import { writeLessonTextAutoExpand } from './lesson-reading-preference.js';

describe('LessonReadingContent', () => {
  let contentHeight = 100;
  let resize: (() => void) | undefined;
  const disconnect = vi.fn();

  beforeEach(() => {
    disconnect.mockClear();
    contentHeight = 100;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    disconnect.mockClear();
    resize = undefined;
  });

  it('centres the reading column while keeping text left aligned and short blocks fully visible', () => {
    render(<LessonReadingContent html="<h2>Introduction</h2><p>Short lesson.</p>" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('lesson-reading-preview')).toHaveAttribute('data-collapsed', 'false');
    expect(stylesAt(screen.getByTestId('lesson-html'), 1440)).toMatchObject({
      'max-width': '44rem', 'margin-inline': 'auto', 'text-align': 'left',
    });
    expect(stylesAt(screen.getByTestId('lesson-html'), 375)).toMatchObject({
      'max-width': '44rem', 'margin-inline': 'auto', 'text-align': 'left',
    });
  });

  it('collapses long text to 60vh and toggles without changing its HTML or selection', async () => {
    contentHeight = 1200;
    const user = userEvent.setup();
    render(<LessonReadingContent html="<h2>Introduction</h2><figure><p>Diagram</p><figcaption>Complete caption.</figcaption></figure><p>Selected text.</p>" />);

    const preview = screen.getByTestId('lesson-reading-preview');
    const content = screen.getByTestId('lesson-html');
    const originalHtml = content.innerHTML;
    const show = screen.getByRole('button', { name: en.lesson.showAll });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveAttribute('aria-controls', preview.id);
    expect(stylesAt(preview, 1440)).toMatchObject({ 'max-height': '540px', overflow: 'hidden' });
    expect(stylesAt(preview, 1440)['mask-image']).toContain('transparent 540px');

    await user.click(show);
    const collapse = screen.getByRole('button', { name: en.lesson.collapseText });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(preview).toHaveAttribute('data-collapsed', 'false');
    expect(stylesAt(preview, 1440)['max-height']).toBeUndefined();
    expect(content.innerHTML).toBe(originalHtml);
    expect(content.querySelector('figcaption')).toHaveTextContent('Complete caption.');
    const paragraph = content.querySelector('p:last-child');
    if (paragraph === null) throw new Error('Expected selectable paragraph');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toBe('Selected text.');

    await user.click(collapse);
    expect(preview).toHaveAttribute('data-collapsed', 'true');
    expect(content.innerHTML).toBe(originalHtml);
  });

  it('uses a minimum of 24rem and adapts to viewport and content size changes', () => {
    contentHeight = 1200;
    vi.stubGlobal('innerHeight', 500);
    const view = render(<LessonReadingContent html="<p>Long text.</p>" />);
    const preview = screen.getByTestId('lesson-reading-preview');
    expect(stylesAt(preview, 375)['max-height']).toBe('384px');
    vi.stubGlobal('innerHeight', 1000);
    fireEvent(window, new Event('resize'));
    expect(stylesAt(preview, 1440)['max-height']).toBe('600px');
    contentHeight = 100;
    act(() => resize?.());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(preview).toHaveAttribute('data-collapsed', 'false');
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('reads the saved preference on the next mount and still offers collapse', async () => {
    contentHeight = 1200;
    const first = render(<LessonReadingContent html="<p>Long text.</p>" />);
    expect(screen.getByRole('button', { name: en.lesson.showAll })).toBeInTheDocument();
    writeLessonTextAutoExpand(true);
    first.unmount();
    render(<LessonReadingContent html="<p>Long text.</p>" />);
    const collapse = screen.getByRole('button', { name: en.lesson.collapseText });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await userEvent.setup().click(collapse);
    expect(screen.getByTestId('lesson-reading-preview')).toHaveAttribute('data-collapsed', 'true');
  });

  it('finishes the visual fade before a caption crossing the preview boundary', () => {
    contentHeight = 1200;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.tagName === 'FIGCAPTION'
        ? new DOMRect(0, 500, 300, 120)
        : new DOMRect(0, 0, 300, 1200);
    });
    render(<LessonReadingContent html="<figure><p>Diagram</p><figcaption>A complete caption that crosses the boundary.</figcaption></figure>" />);
    const preview = screen.getByTestId('lesson-reading-preview');
    expect(stylesAt(preview, 1440)['max-height']).toBe('540px');
    expect(stylesAt(preview, 1440)['mask-image']).toContain('transparent 500px');
    expect(screen.getByTestId('lesson-html').querySelector('figcaption')).toHaveTextContent('A complete caption that crosses the boundary.');
  });

  it('reveals a heading target and reveals text when a link receives keyboard focus', () => {
    contentHeight = 1200;
    render(<LessonReadingContent html="<h2 id='section'>Section</h2><a href='#section'>Reference</a>" />);
    const heading = document.getElementById('section');
    const link = screen.getByTestId('lesson-html').querySelector('a');
    if (heading === null || link === null) throw new Error('Expected heading and reference link');
    fireEvent(heading, new Event(LESSON_TEXT_REVEAL_EVENT, { bubbles: true }));
    expect(screen.getByRole('button', { name: en.lesson.collapseText })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.lesson.collapseText }));
    fireEvent.focus(link);
    expect(screen.getByTestId('lesson-reading-preview')).toHaveAttribute('data-collapsed', 'false');
  });

  it('keeps the collapsed body searchable and expands synchronously before native Find scrolling', () => {
    contentHeight = 1200;
    render(<LessonReadingContent html="<h2 id='section'>Section</h2><p>A match below the preview.</p>" />);
    const body = screen.getByTestId('lesson-html');
    const searchable = body.parentElement;
    if (searchable === null) throw new Error('Expected searchable body');
    const heading = document.getElementById('section');
    expect(searchable).toHaveAttribute('hidden', 'until-found');
    expect(stylesAt(searchable, 1440)['contain-intrinsic-block-size']).toBe('1200px');
    expect(document.querySelectorAll('#section')).toHaveLength(1);
    const visualCopy = screen.getByTestId('lesson-reading-preview').querySelector('[inert]');
    expect(visualCopy).toHaveAttribute('aria-hidden', 'true');
    expect(visualCopy).toHaveTextContent('A match below the preview.');
    let expandedBeforeScroll = false;
    searchable.addEventListener('beforematch', () => {
      expandedBeforeScroll = !searchable.hasAttribute('hidden')
        && stylesAt(screen.getByTestId('lesson-reading-preview'), 1440)['max-height'] === undefined;
    }, { once: true });

    fireEvent(searchable, new Event('beforematch', { bubbles: true }));

    expect(expandedBeforeScroll).toBe(true);
    expect(screen.getByRole('button', { name: en.lesson.collapseText })).toBeInTheDocument();
    expect(document.getElementById('section')).toBe(heading);
    expect(screen.getByTestId('lesson-reading-preview').querySelector('[inert]')).toBeNull();
  });
});
