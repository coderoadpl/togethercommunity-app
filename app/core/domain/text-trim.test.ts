import { describe, expect, it } from 'vitest';

import { trimSpacesBeforeLineBreaks, trimTrailing } from './text-trim.js';

const seededRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const randomStrings = (seed: number, alphabet: readonly string[], count: number): string[] => {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => {
    let value = '';
    const length = Math.floor(random() * 16);
    for (let position = 0; position < length; position += 1) value += alphabet[Math.floor(random() * alphabet.length)] ?? '';
    return value;
  });
};

describe('trimTrailing', () => {
  it.each([
    ['example.test.', '.', 'example.test'],
    ['example.test...', '.', 'example.test'],
    ['...', '.', ''],
    ['', '.', ''],
    ['a.b', '.', 'a.b'],
    ['https://studio.test/path!?;', '.,!?;:', 'https://studio.test/path'],
    ['/hook///', '/', '/hook'],
  ])('trims %j of %j', (value, characters, expected) => {
    expect(trimTrailing(value, characters)).toBe(expected);
  });

  it('matches the trailing-run expressions it replaces on seeded random input', () => {
    for (const value of randomStrings(7, ['.', '/', ',', '!', '?', ';', ':', 'a', ' '], 3_000)) {
      expect(trimTrailing(value, '.'), JSON.stringify(value)).toBe(value.replace(/\.+$/, ''));
      expect(trimTrailing(value, '/'), JSON.stringify(value)).toBe(value.replace(/\/+$/, ''));
      expect(trimTrailing(value, '.,!?;:'), JSON.stringify(value)).toBe(value.replace(/[.,!?;:]+$/u, ''));
    }
  });
});

describe('trimSpacesBeforeLineBreaks', () => {
  it.each([
    ['a  \nb', 'a\nb'],
    ['a \t \n\t\nb  ', 'a\n\nb  '],
    ['\n', '\n'],
    ['', ''],
    ['a\u00a0\nb', 'a\u00a0\nb'],
  ])('trims %j', (value, expected) => {
    expect(trimSpacesBeforeLineBreaks(value)).toBe(expected);
  });

  it('matches the expression it replaces on seeded random input', () => {
    for (const value of randomStrings(11, [' ', '\t', '\n', 'a', '\r', '\u00a0'], 3_000)) {
      expect(trimSpacesBeforeLineBreaks(value), JSON.stringify(value)).toBe(value.replace(/[ \t]+\n/gu, '\n'));
    }
  });
});
