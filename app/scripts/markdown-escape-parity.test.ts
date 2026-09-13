import { describe, expect, it } from 'vitest';

import { renderPostContent } from '#core/server/post-content.js';

import { escapePlainTextForMarkdown } from '../apps/web/src/lib/markdown.js';

const cases: ReadonlyArray<readonly [string, string, string]> = [
  ['inline emphasis markers', '*literal* _underline_ `code`', '\\*literal\\* \\_underline\\_ \\`code\\`'],
  ['leading block markers', '# Heading\n> quote\n- item\n1) ordered', '\\# Heading\n\\> quote\n\\- item\n1\\) ordered'],
  ['setext underlines', 'Para\n---\nUnder\n===', 'Para\n\\---\nUnder\n\\==='],
  ['thematic breaks with trailing spaces', '--- \n====', '\\--- \n\\===='],
  ['indented code', 'Para\n\n    indented', 'Para\n\n\u00a0   indented'],
  ['shallow indentation', '  kept', '  kept'],
  ['blank whitespace lines', 'a\n    \nb', 'a\n    \nb'],
  ['bare urls', 'See https://example.com/a_b_c and https://ex.com/x*y', 'See https://example.com/a_b_c and https://ex.com/x*y'],
  ['text around a bare url', '*see* https://example.com/a_b now', '\\*see\\* https://example.com/a_b now'],
  ['www urls', 'www.example.com/a_b done.', '[www.example.com/a\\_b](https://www.example.com/a_b) done.'],
  ['backslashes', 'a \\ b', 'a \\\\ b'],
  ['pipes and tildes', 'a | b ~ c', 'a \\| b \\~ c'],
  ['angle brackets', '<b>bold</b>', '\\<b\\>bold\\</b\\>'],
  ['html entities', 'a &amp; b &copy; c', 'a &amp;amp; b &amp;copy; c'],
  ['marker-only lines', 'Para\n-\nPara\n+\nPara\n#\n1.', 'Para\n\\-\nPara\n\\+\nPara\n\\#\n1\\.'],
  ['single-character setext underlines', 'Para\n-\nUnder\n=', 'Para\n\\-\nUnder\n\\='],
];

const normalizePlain = (value: string): string =>
  value.replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();

const asSpaces = (value: string): string => value.replaceAll('\u00a0', ' ');

describe('escapePlainTextForMarkdown', () => {
  it.each(cases)('escapes %s', (_name, plain, expected) => {
    expect(escapePlainTextForMarkdown(plain)).toBe(expected);
  });

  it.each(cases)('keeps the rendered text of %s unchanged', (_name, plain) => {
    const escaped = renderPostContent(escapePlainTextForMarkdown(plain), 'markdown');
    expect(asSpaces(escaped.plainText)).toBe(normalizePlain(plain));
    expect(escaped.linkDestinations).toEqual(renderPostContent(plain, 'plain').linkDestinations);
  });

  it('keeps a tab-indented line out of a code block', () => {
    const escaped = escapePlainTextForMarkdown('Para\n\n\ttabbed');
    expect(escaped).toBe('Para\n\n\u00a0tabbed');
    expect(renderPostContent(escaped, 'markdown').html).not.toContain('<pre>');
  });

  it('keeps a url destination intact instead of splitting it on backslashes', () => {
    const escaped = escapePlainTextForMarkdown('See https://example.com/a_b_c');
    expect(renderPostContent(escaped, 'markdown').html).toContain('href="https://example.com/a_b_c"');
  });

  it('renders no heading, code block or list for a legacy plain body', () => {
    const plain = '# Heading\nPara 2\n---\nUnder\n===\n\n    indented\n- item';
    const { html } = renderPostContent(escapePlainTextForMarkdown(plain), 'markdown');
    expect(html).not.toMatch(/<h[1-6]>|<pre>|<ul>|<hr>/u);
  });
});
