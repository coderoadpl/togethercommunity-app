import { describe, expect, it } from 'vitest';

import { createHtmlToText } from './html-to-text.js';

describe('HTML to plaintext', () => {
  it('preserves Unicode, link destinations, paragraphs, lists and tables', () => {
    const text = createHtmlToText().convert('<html><head><title>Hidden</title><style>hidden</style></head><body><p>Hello &amp; world &#128512;</p><p><a href="https://courses.example.org/?a=1&amp;b=2">Learn</a><br>Next</p><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table><script>hidden()</script></body></html>');
    expect(text).toContain('Hello & world 😀\n\nLearn (https://courses.example.org/?a=1&b=2)\nNext');
    expect(text).toContain('- One');
    expect(text).toContain('- Two');
    expect(text).toContain('A\tB');
    expect(text).not.toMatch(/hidden/iu);
  });
  it('does not duplicate a URL used as its label', () => {
    expect(createHtmlToText().convert('<a href="https://courses.example.org/">https://courses.example.org/</a>')).toBe('https://courses.example.org/');
  });
  it('preserves relative links and telephone URLs', () => {
    expect(createHtmlToText().convert('<a href="/course">Course</a> <a href="tel:+123456789">Call</a>')).toBe('Course (/course) Call (tel:+123456789)');
  });
  it('enforces its input limit', () => {
    expect(() => createHtmlToText().convert('a'.repeat(1_000_001))).toThrow('limit');
  });
});
