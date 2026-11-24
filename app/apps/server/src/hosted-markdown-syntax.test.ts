import { describe, expect, it } from 'vitest';

import { headingPattern, inlineLinks, listItemPattern } from './hosted-markdown-syntax.js';

const previousHeadingPattern = /^(#{1,6})\s+(.+)$/;
const previousListItemPattern = /^(\s*)(?:[-*+]|(\d{1,9})[.)])\s+(.*)$/;

const previousInlineLinks = (source: string) => [...source.matchAll(/(!?)\[([^\]]+)]\(([^)\s]+)\)/g)].map((match) => ({
  index: match.index,
  length: match[0].length,
  image: match[1] === '!',
  label: match[2],
  target: match[3],
}));

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
    const length = Math.floor(random() * 14);
    for (let position = 0; position < length; position += 1) value += alphabet[Math.floor(random() * alphabet.length)] ?? '';
    return value;
  });
};

describe('hosted markdown syntax', () => {
  it('parses headings and list items as the previous expressions on seeded random lines', () => {
    for (const line of randomStrings(3, ['#', '-', '*', '1', '.', ')', ' ', '\t', 'a', '\u00a0', '\u2028', '\u2029', '\r', '\n'], 20_000)) {
      expect(headingPattern.exec(line)?.slice(), JSON.stringify(line)).toEqual(previousHeadingPattern.exec(line)?.slice());
      expect(listItemPattern.exec(line)?.slice(), JSON.stringify(line)).toEqual(previousListItemPattern.exec(line)?.slice());
    }
  });

  it('finds the same inline links as the previous expression on seeded random text', () => {
    for (const source of randomStrings(5, ['!', '[', ']', '(', ')', ' ', 'a', 'h', '\n', '\u00a0', '[a]', '](x)'], 20_000)) {
      expect(inlineLinks(source), JSON.stringify(source)).toEqual(previousInlineLinks(source));
    }
  });
});
