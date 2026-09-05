import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { stylesAt } from '../../lib/stylesheet.js';
import { CoverImage, CoverPlaceholder } from './CoverImage.js';

const DESKTOP_WIDTH = 1440;
const ROOT_FONT_SIZE_PX = 16;
const MEMBER_COURSE_COLUMN_PX = 711;

const stylesOf = (element: Element): Record<string, string> => stylesAt(element, DESKTOP_WIDTH);

const pxOf = (remValue: string | undefined): number =>
  Number.parseFloat(remValue ?? 'NaN') * ROOT_FONT_SIZE_PX;

describe('CoverImage', () => {
  it('crops a cover into the shared aspect ratio instead of stretching it', () => {
    render(<CoverImage src="https://cdn.test/cover.jpg" alt="Okładka kursu" testId="cover" />);

    const image = screen.getByTestId('cover');
    expect(image).toHaveAttribute('src', 'https://cdn.test/cover.jpg');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(stylesOf(image)).toMatchObject({
      'aspect-ratio': '16/9',
      'object-fit': 'cover',
      width: '100%',
    });
    expect(stylesOf(image)['max-height']).toBeUndefined();
  });

  it('gives a missing cover the same box as the cover it replaces', () => {
    render(<CoverPlaceholder title="Kurs JavaScript od podstaw" testId="cover-fallback" />);

    const fallback = screen.getByTestId('cover-fallback');
    expect(stylesOf(fallback)).toMatchObject({
      'aspect-ratio': '16/9',
      width: '100%',
    });
    expect(fallback).toHaveTextContent('KJ');
  });

  it('seams a card cover into the card and rounds a standalone one', () => {
    const card = render(
      <CoverImage src="https://cdn.test/cover.jpg" alt="Okładka" testId="card" />,
    );
    const cardStyles = stylesOf(screen.getByTestId('card'));
    card.unmount();

    render(
      <CoverImage
        src="https://cdn.test/cover.jpg"
        alt="Okładka"
        frame="standalone"
        testId="standalone"
      />,
    );
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

  it('bounds a standalone cover above the member course column instead of shrinking it', () => {
    render(
      <CoverImage
        src="https://cdn.test/cover.jpg"
        alt="Okładka"
        frame="standalone"
        testId="standalone"
      />,
    );
    render(<CoverPlaceholder title="Kurs bez okładki" frame="standalone" testId="fallback" />);

    for (const testId of ['standalone', 'fallback']) {
      const styles = stylesOf(screen.getByTestId(testId));
      expect(styles).toMatchObject({ width: '100%', 'aspect-ratio': '16/9' });
      expect(pxOf(styles['max-width'])).toBeGreaterThanOrEqual(MEMBER_COURSE_COLUMN_PX);
      expect(styles['max-height']).toBeUndefined();
    }
  });
});
