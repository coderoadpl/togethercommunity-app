import { describe, expect, it } from 'vitest';
import { contrastRatio, deriveDarkAccent, deriveLightAccent, relativeLuminance } from './color.js';

const ACCENTS = ['#F5C842', '#FFC42B', '#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#808080', '#ffffff', '#000000', '#0E7490'];
const BACKGROUNDS = ['#FFFFFF', '#F7F4EF', '#F4F4F2', '#FAFAF9'];

describe('brand colors', () => {
  it('computes WCAG luminance and symmetric contrast', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126);
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#808080', '#808080')).toBe(1);
  });

  it.each(ACCENTS)('derives readable text and controls for %s on every light surface', (accent) => {
    const derived = deriveLightAccent(accent);
    expect(derived).toMatch(/^#[0-9a-fA-F]{6}$/);
    for (const background of BACKGROUNDS) {
      expect(contrastRatio(derived, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(derived, background)).toBeGreaterThanOrEqual(3);
    }
    expect(relativeLuminance(derived)).toBeLessThanOrEqual(relativeLuminance(accent));
    expect(deriveLightAccent(derived)).toBe(derived);
  });

  it('keeps the hue when darkening saturated colors', () => {
    const yellow = deriveLightAccent('#ffff00');
    expect(yellow.slice(1, 3)).toBe(yellow.slice(3, 5));
    expect(yellow.slice(5)).toBe('00');
    expect(deriveLightAccent('#00ff00')).toMatch(/^#00[0-9a-f]{2}00$/);
    expect(deriveLightAccent('#0E7490')).toBe('#0E7490');
  });

  it('accepts the actual theme backgrounds', () => {
    const backgrounds = ['#f6f2ea', '#fdfbf6'];
    const derived = deriveLightAccent('#F5C842', backgrounds);
    for (const background of backgrounds) expect(contrastRatio(derived, background)).toBeGreaterThanOrEqual(4.5);
  });

  describe('deriveDarkAccent', () => {
    it('returns an accent that already passes unchanged', () => {
      expect(deriveDarkAccent('#F5C842')).toBe('#F5C842');
    });

    it('lightens dark accents for every dark surface', () => {
      const accent = '#0E7490';
      const derived = deriveDarkAccent(accent);
      expect(derived).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(relativeLuminance(derived)).toBeGreaterThan(relativeLuminance(accent));
      for (const background of ['#0F1012', '#17181B', '#1B1D20']) {
        expect(contrastRatio(derived, background)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('is idempotent after deriving a readable dark accent', () => {
      const derived = deriveDarkAccent('#0E7490');
      expect(deriveDarkAccent(derived)).toBe(derived);
    });
  });
});
