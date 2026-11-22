import { describe, expect, it } from 'vitest';

import { htmlToPlainText, markdownToPlainText, plainTextExcerpt } from './plain-text.js';

describe('htmlToPlainText', () => {
  it('drops tags, decodes entities and separates blocks with one space', () => {
    expect(htmlToPlainText('<p>Learn <strong>fast</strong> &amp; well.</p><ul><li>One</li><li>Two</li></ul>')).toBe(
      'Learn fast & well. One Two',
    );
  });

  it('never keeps script or style content and never runs markup', () => {
    expect(htmlToPlainText('<p>Safe</p><script>window.hacked = true</script><style>p{}</style><img src=x onerror="window.hacked = true">')).toBe('Safe');
    expect(Reflect.get(window, 'hacked')).toBeUndefined();
  });

  it('returns an empty string for empty or whitespace-only markup', () => {
    expect(htmlToPlainText('')).toBe('');
    expect(htmlToPlainText('<p> </p>')).toBe('');
  });
});

describe('markdownToPlainText', () => {
  it('renders the Markdown and keeps only its text', () => {
    expect(markdownToPlainText('## Bundle\n\nEvery **course** in [one pack](https://togethercommunity.app).\n\n- A\n- B')).toBe(
      'Bundle Every course in one pack. A B',
    );
  });
});

describe('plainTextExcerpt', () => {
  it('cuts long text and marks the cut', () => {
    expect(plainTextExcerpt('abcdef ghij', 7)).toBe('abcdef…');
    expect(plainTextExcerpt('short', 7)).toBe('short');
  });
});
