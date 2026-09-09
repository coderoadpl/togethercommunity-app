import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { stylesAt } from '../../lib/stylesheet.js';
import { accentGradient, deterministicAccent } from '../../theme-branding.js';
import { Cover } from './Cover.js';

const DESKTOP_WIDTH = 1440;
const COVER_SRC = 'https://cdn.test/cover.jpg';

const stylesOf = (element: Element): Record<string, string> => stylesAt(element, DESKTOP_WIDTH);

const rgbOf = (hex: string): string =>
  `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;

describe('Cover', () => {
  it('crops a cover into the shared aspect ratio instead of stretching it', () => {
    render(<Cover src={COVER_SRC} title="Course" alt="Course cover" testId="cover" />);

    const image = screen.getByTestId('cover');
    expect(image).toHaveAttribute('src', COVER_SRC);
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(stylesOf(image)).toMatchObject({
      'aspect-ratio': '16/9',
      'object-fit': 'cover',
      width: '100%',
    });
    expect(stylesOf(image)['max-height']).toBeUndefined();
  });

  it('gives a missing cover the same box as the cover it replaces', () => {
    render(<Cover src={null} title="JavaScript from scratch" alt="" fallbackTestId="cover-fallback" />);

    const fallback = screen.getByTestId('cover-fallback');
    expect(stylesOf(fallback)).toMatchObject({
      'aspect-ratio': '16/9',
      width: '100%',
    });
    expect(fallback).toHaveTextContent('JF');
    expect(fallback).toHaveTextContent('JavaScript from scratch');
  });

  it('paints the fallback as an accent gradient, deterministic from the title', () => {
    render(<Cover src={null} title="JavaScript Course" alt="" fallbackTestId="fallback" />);

    const { from, to, ink } = accentGradient(deterministicAccent('JavaScript Course'));
    const styles = stylesOf(screen.getByTestId('fallback'));
    expect(styles.background).toBe(`linear-gradient(135deg, ${rgbOf(from)} 0%, ${rgbOf(to)} 100%)`);
    expect(styles.color).toBe(rgbOf(ink));
  });

  it('renders no block at all where the cover is decoration', () => {
    const { container } = render(
      <Cover src={null} title="Course" alt="" whenMissing="omit" fallbackTestId="fallback" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('still falls back on a broken cover where a missing one renders nothing', () => {
    render(
      <Cover
        src={COVER_SRC}
        title="Course without a cover"
        alt="Cover"
        whenMissing="omit"
        testId="cover"
        fallbackTestId="fallback"
      />,
    );

    fireEvent.error(screen.getByTestId('cover'));

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('falls back when the cover fails to load', () => {
    render(
      <Cover src={COVER_SRC} title="Course without a cover" alt="Cover" testId="cover" fallbackTestId="fallback" />,
    );

    fireEvent.error(screen.getByTestId('cover'));

    expect(screen.queryByTestId('cover')).toBeNull();
    expect(screen.getByTestId('fallback')).toHaveTextContent('CW');
  });

  it('seams a card cover into the card and rounds a standalone one', () => {
    const card = render(<Cover src={COVER_SRC} title="Course" alt="Cover" testId="card" />);
    const cardStyles = stylesOf(screen.getByTestId('card'));
    card.unmount();

    render(<Cover src={COVER_SRC} title="Course" alt="Cover" frame="standalone" testId="standalone" />);
    const standalone = screen.getByTestId('standalone');
    const standaloneStyles = stylesOf(standalone);

    expect(cardStyles['border-radius']).toBeUndefined();
    expect(cardStyles['max-width']).toBeUndefined();
    expect(cardStyles['border-bottom']).toBeDefined();
    expect(standaloneStyles['border-radius']).toBeDefined();
    expect(standaloneStyles['aspect-ratio']).toBe(cardStyles['aspect-ratio']);
    expect(standaloneStyles['object-fit']).toBe(cardStyles['object-fit']);
    expect(standalone).toHaveAttribute('loading', 'eager');
  });

  it('lets a standalone cover fill the member course column', () => {
    render(<Cover src={COVER_SRC} title="Course" alt="Cover" frame="standalone" testId="standalone" />);
    render(<Cover src={null} title="Course without a cover" alt="" frame="standalone" fallbackTestId="fallback" />);

    for (const testId of ['standalone', 'fallback']) {
      const styles = stylesOf(screen.getByTestId(testId));
      expect(styles).toMatchObject({ width: '100%', 'aspect-ratio': '16/9' });
      expect(styles['max-width']).toBeUndefined();
      expect(styles['max-height']).toBeUndefined();
    }
  });
});
