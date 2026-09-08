import { describe, expect, it } from 'vitest';

import { linkify } from '../../lib/linkify.js';

describe('linkify', () => {
  it('preserves text, newlines and repeated links', () => {
    const text = 'See https://courses.example.org/a.\nThen https://courses.example.org/a!';
    const segments = linkify(text);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    expect(segments.filter((segment) => segment.href !== null)).toEqual([
      { text: 'https://courses.example.org/a', href: 'https://courses.example.org/a' },
      { text: 'https://courses.example.org/a', href: 'https://courses.example.org/a' },
    ]);
  });

  it.each([
    ['(https://courses.example.org/a).', 'https://courses.example.org/a'],
    ['https://courses.example.org/a_(b)', 'https://courses.example.org/a_(b)'],
    ['[https://courses.example.org/a?q=one&b=two#part]', 'https://courses.example.org/a?q=one&b=two#part'],
    ['http://courses.example.org/a,', 'http://courses.example.org/a'],
    ['www.courses.example.org/a;', 'https://www.courses.example.org/a'],
  ])('links %s without surrounding punctuation', (text, href) => {
    const segments = linkify(text);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    expect(segments.filter((segment) => segment.href !== null).map((segment) => segment.href)).toEqual([href]);
  });

  it.each(['', 'Just text\nwith whitespace.', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://courses.example.org/file', 'https://', 'https://[invalid]'])('leaves unsafe or invalid input as text: %s', (text) => {
    const segments = linkify(text);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    expect(segments.every((segment) => segment.href === null)).toBe(true);
  });
});
