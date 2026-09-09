import { describe, expect, it } from 'vitest';

import { renderPostContent } from './post-content.js';

const REQUIRED_LINK_ATTRIBUTES = 'target="_blank" rel="noopener noreferrer nofollow ugc"';

describe('renderPostContent', () => {
  it('escapes plain text, preserves line breaks and linkifies supported destinations', () => {
    const rendered = renderPostContent(
      'Generic<T> & notes\nhttps://example.com/a?b=1&c=2, www.zażółć.pl/ścieżka). mailto:ola@example.com!',
      'plain',
    );

    expect(rendered.html).toBe(
      `Generic&lt;T&gt; &amp; notes<br><a href="https://example.com/a?b=1&amp;c=2" ${REQUIRED_LINK_ATTRIBUTES}>https://example.com/a?b=1&amp;c=2</a>, <a href="https://www.xn--za-6ja4f8n1l.pl/%C5%9Bcie%C5%BCka" ${REQUIRED_LINK_ATTRIBUTES}>www.zażółć.pl/ścieżka</a>). <a href="mailto:ola@example.com" ${REQUIRED_LINK_ATTRIBUTES}>mailto:ola@example.com</a>!`,
    );
    expect(rendered.plainText).toBe(
      'Generic<T> & notes\nhttps://example.com/a?b=1&c=2, www.zażółć.pl/ścieżka). mailto:ola@example.com!',
    );
  });

  it('renders the narrow Markdown dialect and derives semantic plain text', () => {
    const rendered = renderPostContent([
      '### Plan',
      '',
      'First **bold** and *italic* line  ',
      'second [link](https://example.com/docs).',
      '',
      '- one',
      '- two',
      '',
      '> quoted',
      '',
      '`inline`',
      '',
      '```ts',
      'const answer = 42;',
      '```',
    ].join('\n'), 'markdown');

    expect(rendered.html).toContain('<h3>Plan</h3>');
    expect(rendered.html).toContain('<strong>bold</strong>');
    expect(rendered.html).toContain('<em>italic</em>');
    expect(rendered.html).toContain('<br>second');
    expect(rendered.html).toContain('<ul>');
    expect(rendered.html).toContain('<blockquote>');
    expect(rendered.html).toContain('<code>inline</code>');
    expect(rendered.html).toContain('<pre><code>const answer = 42;\n</code></pre>');
    expect(rendered.plainText).toBe(
      'Plan\n\nFirst bold and italic line\nsecond link.\n\none\ntwo\n\nquoted\n\ninline\n\nconst answer = 42;',
    );
  });

  it('disables unsupported Markdown features', () => {
    const rendered = renderPostContent([
      '#### Too deep',
      '',
      '![tracking](https://example.com/pixel.png)',
      '',
      '| A | B |',
      '| - | - |',
      '| one | two |',
    ].join('\n'), 'markdown');

    expect(rendered.html).not.toMatch(/<h4|<img|<table/u);
    expect(rendered.html).toContain('<p>Too deep</p>');
    expect(rendered.html).toContain('tracking');
    expect(rendered.html).toContain('| A | B |');
  });

  it.each([
    '<script>alert(1)</script>',
    '[click](javascript:alert(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
    '<svg/onload=alert(1)>',
    '[outer [safe](https://safe.example)](javascript:alert(1))',
    '[click](јavascript:alert(1))',
  ])('neutralizes the pinned XSS payload %s', (payload) => {
    const rendered = renderPostContent(payload, 'markdown');

    expect(rendered.html).not.toMatch(/<(?:script|svg)\b|\son\w+=|(?:javascript|data):/iu);
  });

  it('returns only normalized destinations that survived rendering', () => {
    expect(renderPostContent(
      '[one](HTTPS://Example.COM:443/a) [two](https://example.com/a) [bad](javascript:alert(1))',
      'markdown',
    ).linkDestinations).toEqual(['https://example.com/a', 'https://example.com/a']);
  });
});
