import { describe, expect, it } from 'vitest';

import type { PlayableLessonBlock } from './course.js';
import { groupLessonBlocks, inspectSandboxEmbedUrl } from './lesson-links.js';

const embedUrlOf = (value: string): string | null => {
  const inspection = inspectSandboxEmbedUrl(value);
  return inspection.kind === 'embeddable' ? inspection.embedUrl : null;
};

const canonicalUrlOf = (value: string): string | null => {
  const inspection = inspectSandboxEmbedUrl(value);
  return inspection.kind === 'embeddable' ? inspection.canonicalUrl : null;
};

describe('inspectSandboxEmbedUrl', () => {
  it('keeps a CodeSandbox embed URL with its player options', () => {
    const inspection = inspectSandboxEmbedUrl(
      'https://codesandbox.io/embed/github/coderoadpl/frontend--html-css-flexbox--task-1?autoresize=1&fontsize=14&hidenavigation=1',
    );
    expect(inspection).toEqual({
      kind: 'embeddable',
      provider: 'codesandbox',
      embedUrl:
        'https://codesandbox.io/embed/github/coderoadpl/frontend--html-css-flexbox--task-1?autoresize=1&fontsize=14&hidenavigation=1',
      canonicalUrl:
        'https://codesandbox.io/s/github/coderoadpl/frontend--html-css-flexbox--task-1?autoresize=1&fontsize=14&hidenavigation=1',
    });
  });

  it('points the canonical URL at the editable sandbox rather than the embed', () => {
    expect(canonicalUrlOf('https://codesandbox.io/embed/abc123')).toBe('https://codesandbox.io/s/abc123');
    expect(canonicalUrlOf('https://codesandbox.io/p/sandbox/abc123')).toBe(
      'https://codesandbox.io/p/sandbox/abc123',
    );
    expect(canonicalUrlOf('https://stackblitz.com/edit/vitejs-vite-abcdef?embed=1')).toBe(
      'https://stackblitz.com/edit/vitejs-vite-abcdef',
    );
    expect(canonicalUrlOf('https://codepen.io/coderoad/embed/abcDEF')).toBe(
      'https://codepen.io/coderoad/pen/abcDEF',
    );
  });

  it('normalises the CodeSandbox sandbox page to its embed URL', () => {
    expect(embedUrlOf('https://codesandbox.io/p/sandbox/abc123?file=%2Fsrc%2Findex.js')).toBe(
      'https://codesandbox.io/embed/abc123?file=%2Fsrc%2Findex.js',
    );
    expect(embedUrlOf('https://www.codesandbox.io/p/sandbox/abc123')).toBe(
      'https://codesandbox.io/embed/abc123',
    );
  });

  it('normalises the legacy CodeSandbox share URL to its embed URL', () => {
    expect(embedUrlOf('https://codesandbox.io/s/abc123')).toBe('https://codesandbox.io/embed/abc123');
    expect(embedUrlOf('https://codesandbox.io/s/abc123?file=%2Fsrc%2Findex.js')).toBe(
      'https://codesandbox.io/embed/abc123?file=%2Fsrc%2Findex.js',
    );
    expect(embedUrlOf('https://codesandbox.io/s/github/coderoadpl/task-1')).toBe(
      'https://codesandbox.io/embed/github/coderoadpl/task-1',
    );
    expect(inspectSandboxEmbedUrl('https://codesandbox.io/s/')).toEqual({ kind: 'not-embeddable' });
  });

  it('reads back the canonical URL it hands out as the same embed', () => {
    const sources = [
      'https://codesandbox.io/embed/github/coderoadpl/task-1?autoresize=1',
      'https://codesandbox.io/embed/abc123',
      'https://codesandbox.io/p/sandbox/abc123',
      'https://stackblitz.com/edit/vitejs-vite-abcdef?file=src%2Fmain.ts',
      'https://stackblitz.com/github/coderoadpl/task-1',
      'https://codepen.io/coderoad/pen/abcDEF',
    ];

    expect(sources.map((source) => embedUrlOf(canonicalUrlOf(source) ?? ''))).toEqual(
      sources.map((source) => embedUrlOf(source)),
    );
  });

  it('adds the embed flag to StackBlitz editor and github URLs', () => {
    expect(embedUrlOf('https://stackblitz.com/edit/vitejs-vite-abcdef?file=src%2Fmain.ts')).toBe(
      'https://stackblitz.com/edit/vitejs-vite-abcdef?file=src%2Fmain.ts&embed=1',
    );
    expect(embedUrlOf('https://stackblitz.com/edit/vitejs-vite-abcdef?embed=1')).toBe(
      'https://stackblitz.com/edit/vitejs-vite-abcdef?embed=1',
    );
    expect(embedUrlOf('https://stackblitz.com/github/coderoadpl/task-1')).toBe(
      'https://stackblitz.com/github/coderoadpl/task-1?embed=1',
    );
  });

  it('normalises a CodePen pen URL to its embed URL', () => {
    expect(embedUrlOf('https://codepen.io/coderoad/pen/abcDEF')).toBe(
      'https://codepen.io/coderoad/embed/abcDEF',
    );
    expect(embedUrlOf('https://codepen.io/coderoad/embed/abcDEF?theme-id=dark')).toBe(
      'https://codepen.io/coderoad/embed/abcDEF?theme-id=dark',
    );
  });

  it('rejects hosts outside the allow-list, including look-alikes', () => {
    for (const value of [
      'https://github.com/coderoadpl/frontend--html-css-flexbox--task-1',
      'https://codesandbox.io.evil.example/embed/abc123',
      'https://evil.example/codesandbox.io/embed/abc123',
      'https://sandbox.codesandbox.io/embed/abc123',
      'https://stackblitz.com.evil.example/edit/abc',
    ]) {
      expect(inspectSandboxEmbedUrl(value)).toEqual({ kind: 'not-embeddable' });
    }
  });

  it('rejects allow-listed hosts on paths that are not sandboxes', () => {
    for (const value of [
      'https://codesandbox.io/',
      'https://codesandbox.io/docs/learn',
      'https://codesandbox.io/p/devbox/abc123',
      'https://stackblitz.com/github/coderoadpl',
      'https://codepen.io/coderoad/full/abcDEF',
    ]) {
      expect(inspectSandboxEmbedUrl(value)).toEqual({ kind: 'not-embeddable' });
    }
  });

  it('rejects malformed and non-http URLs', () => {
    for (const value of [
      '',
      '   ',
      'codesandbox.io/embed/abc123',
      'javascript:alert(1)//codesandbox.io/embed/abc123',
      'mailto:teacher@example.com',
      'data:text/html,<script></script>',
    ]) {
      expect(inspectSandboxEmbedUrl(value)).toEqual({ kind: 'not-embeddable' });
    }
  });
});

describe('groupLessonBlocks', () => {
  const video: PlayableLessonBlock = {
    type: 'video',
    storageKey: 'k1',
    streamVideoId: 'v1',
    embedUrl: 'https://iframe.mediadelivery.net/embed/1/v1',
  };

  it('merges consecutive links into one section and keeps other blocks in place', () => {
    const groups = groupLessonBlocks([
      video,
      { type: 'link', url: 'https://github.com/coderoadpl/task-1', description: 'GitHub' },
      { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/HTML' },
      { type: 'html', html: '<p>Notatki</p>' },
      { type: 'link', url: 'https://example.com/later' },
    ]);

    expect(groups.map((group) => group.kind)).toEqual(['block', 'links', 'block', 'links']);
    expect(groups[1]).toEqual({
      kind: 'links',
      links: [
        { url: 'https://github.com/coderoadpl/task-1', label: 'GitHub', host: 'github.com' },
        {
          url: 'https://developer.mozilla.org/pl/docs/Web/HTML',
          label: 'developer.mozilla.org / HTML',
          host: 'developer.mozilla.org',
        },
      ],
    });
  });

  it('renders an embeddable link as a sandbox captioned by the description', () => {
    const groups = groupLessonBlocks([
      {
        type: 'link',
        url: 'https://codesandbox.io/embed/github/coderoadpl/task-1?autoresize=1',
        description: 'CodeSandbox',
      },
      { type: 'embed', embedUrl: 'https://codepen.io/coderoad/pen/abcDEF' },
      { type: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' },
    ]);

    expect(groups).toEqual([
      {
        kind: 'sandbox',
        provider: 'codesandbox',
        providerName: 'CodeSandbox',
        embedUrl: 'https://codesandbox.io/embed/github/coderoadpl/task-1?autoresize=1',
        canonicalUrl: 'https://codesandbox.io/s/github/coderoadpl/task-1?autoresize=1',
        caption: 'CodeSandbox',
      },
      {
        kind: 'sandbox',
        provider: 'codepen',
        providerName: 'CodePen',
        embedUrl: 'https://codepen.io/coderoad/embed/abcDEF',
        canonicalUrl: 'https://codepen.io/coderoad/pen/abcDEF',
        caption: null,
      },
      { kind: 'block', block: { type: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' } },
    ]);
  });

  it('renders one sandbox when the same sandbox arrives in several block forms', () => {
    const groups = groupLessonBlocks([
      { type: 'link', url: 'https://codesandbox.io/embed/abc123', description: 'Zadanie' },
      { type: 'html', html: '<p><a href="https://codesandbox.io/s/abc123">sandbox</a></p>' },
      { type: 'embed', embedUrl: 'https://codesandbox.io/p/sandbox/abc123' },
    ]);

    expect(groups).toEqual([
      {
        kind: 'sandbox',
        provider: 'codesandbox',
        providerName: 'CodeSandbox',
        embedUrl: 'https://codesandbox.io/embed/abc123',
        canonicalUrl: 'https://codesandbox.io/s/abc123',
        caption: 'Zadanie',
      },
    ]);
  });

  it('takes the sandbox caption from a later duplicate when the first has none', () => {
    const groups = groupLessonBlocks([
      { type: 'embed', embedUrl: 'https://codepen.io/coderoad/pen/abcDEF' },
      { type: 'link', url: 'https://codepen.io/coderoad/embed/abcDEF', description: 'Przykład' },
    ]);

    expect(groups.map((group) => (group.kind === 'sandbox' ? group.caption : group.kind))).toEqual(['Przykład']);
  });

  it('keeps different sandboxes on the same provider apart', () => {
    const groups = groupLessonBlocks([
      { type: 'link', url: 'https://codesandbox.io/s/abc123' },
      { type: 'link', url: 'https://codesandbox.io/s/def456' },
    ]);

    expect(groups.map((group) => (group.kind === 'sandbox' ? group.embedUrl : group.kind))).toEqual([
      'https://codesandbox.io/embed/abc123',
      'https://codesandbox.io/embed/def456',
    ]);
  });

  it('folds a single-anchor html block into the links section and drops the duplicate', () => {
    const groups = groupLessonBlocks([
      { type: 'link', url: 'https://github.com/coderoadpl/task-1', description: 'GitHub' },
      { type: 'html', html: '<p><a href="https://github.com/coderoadpl/task-1/">repozytorium</a></p>' },
    ]);

    expect(groups).toEqual([
      {
        kind: 'links',
        links: [{ url: 'https://github.com/coderoadpl/task-1', label: 'GitHub', host: 'github.com' }],
      },
    ]);
  });

  it('falls back to a derived label when the anchor text is the URL itself', () => {
    expect(
      groupLessonBlocks([
        { type: 'html', html: '<p><a href="https://github.com/a/b" target="_blank">https://github.com/a/b</a></p>' },
      ]),
    ).toEqual([
      { kind: 'links', links: [{ url: 'https://github.com/a/b', label: 'github.com / b', host: 'github.com' }] },
    ]);
  });

  it('falls back to a derived label when the anchor text is a schemeless URL', () => {
    const repoUrl = 'https://github.com/coderoadpl/frontend--html-css-flexbox--task-1';
    expect(
      groupLessonBlocks([
        { type: 'html', html: `<p><a href="${repoUrl}">github.com/coderoadpl/frontend--html-css-flexbox--task-1</a></p>` },
        { type: 'html', html: '<p><a href="https://developer.mozilla.org/pl/docs/Web/CSS">developer.mozilla.org</a></p>' },
      ]),
    ).toEqual([
      {
        kind: 'links',
        links: [
          { url: repoUrl, label: 'github.com / frontend--html-css-flexbox--task-1', host: 'github.com' },
          {
            url: 'https://developer.mozilla.org/pl/docs/Web/CSS',
            label: 'developer.mozilla.org / CSS',
            host: 'developer.mozilla.org',
          },
        ],
      },
    ]);
  });

  it('falls back to a derived label when the description repeats the URL', () => {
    expect(
      groupLessonBlocks([
        { type: 'link', url: 'https://github.com/a/b', description: 'https://github.com/a/b' },
      ]),
    ).toEqual([
      { kind: 'links', links: [{ url: 'https://github.com/a/b', label: 'github.com / b', host: 'github.com' }] },
    ]);
  });

  it('keeps description-less links on the same host distinguishable', () => {
    const groups = groupLessonBlocks([
      { type: 'link', url: 'https://github.com/a/one' },
      { type: 'link', url: 'https://github.com/a/two' },
      { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex#syntax' },
      { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex#examples' },
      { type: 'link', url: 'https://example.com' },
    ]);

    expect(groups[0]?.kind === 'links' ? groups[0].links.map((link) => link.label) : []).toEqual([
      'github.com / one',
      'github.com / two',
      'developer.mozilla.org / flex#syntax',
      'developer.mozilla.org / flex#examples',
      'example.com',
    ]);
  });

  it('decodes percent-escapes in a derived label', () => {
    expect(
      groupLessonBlocks([{ type: 'link', url: 'https://example.com/docs/uk%C5%82ad%20flex' }]),
    ).toEqual([
      {
        kind: 'links',
        links: [
          { url: 'https://example.com/docs/uk%C5%82ad%20flex', label: 'example.com / układ flex', host: 'example.com' },
        ],
      },
    ]);
  });

  it('keeps a dotted product name as the label', () => {
    expect(
      groupLessonBlocks([
        { type: 'html', html: '<p><a href="https://nodejs.org/docs/latest/api/">Node.js</a></p>' },
      ]),
    ).toEqual([
      { kind: 'links', links: [{ url: 'https://nodejs.org/docs/latest/api/', label: 'Node.js', host: 'nodejs.org' }] },
    ]);
  });

  it('keeps links that differ only by fragment as separate chips', () => {
    expect(
      groupLessonBlocks([
        { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex#syntax', description: 'Składnia' },
        { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex#examples', description: 'Przykłady' },
      ]),
    ).toEqual([
      {
        kind: 'links',
        links: [
          {
            url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex#syntax',
            label: 'Składnia',
            host: 'developer.mozilla.org',
          },
          {
            url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex#examples',
            label: 'Przykłady',
            host: 'developer.mozilla.org',
          },
        ],
      },
    ]);
  });

  it('prefers a link description over the anchor text of an earlier html duplicate', () => {
    expect(
      groupLessonBlocks([
        { type: 'html', html: '<p><a href="https://github.com/a/b" target="_blank">repozytorium</a></p>' },
        { type: 'link', url: 'https://github.com/a/b', description: 'GitHub' },
      ]),
    ).toEqual([
      { kind: 'links', links: [{ url: 'https://github.com/a/b', label: 'GitHub', host: 'github.com' }] },
    ]);
  });

  it('keeps paths that differ only by case as separate links', () => {
    const groups = groupLessonBlocks([
      { type: 'link', url: 'https://example.com/Case', description: 'Wielka' },
      { type: 'link', url: 'https://example.com/case', description: 'Mala' },
    ]);

    expect(groups).toEqual([
      {
        kind: 'links',
        links: [
          { url: 'https://example.com/Case', label: 'Wielka', host: 'example.com' },
          { url: 'https://example.com/case', label: 'Mala', host: 'example.com' },
        ],
      },
    ]);
  });

  it('takes the label from a later duplicate when the first link has none', () => {
    const groups = groupLessonBlocks([
      { type: 'link', url: 'https://github.com/coderoadpl/task-1' },
      { type: 'link', url: 'https://github.com/coderoadpl/task-1', description: 'Repozytorium zadania' },
    ]);

    expect(groups).toEqual([
      {
        kind: 'links',
        links: [
          { url: 'https://github.com/coderoadpl/task-1', label: 'Repozytorium zadania', host: 'github.com' },
        ],
      },
    ]);
  });

  it('leaves html blocks that hold more than one anchor untouched', () => {
    const blocks: PlayableLessonBlock[] = [
      { type: 'html', html: '<p>Zobacz <a href="https://example.com/a">a</a> i <a href="https://example.com/b">b</a></p>' },
      { type: 'html', html: '<p><a href="javascript:alert(1)">klik</a></p>' },
      { type: 'html', html: '<p><a href="https://example.com/a"><img src="https://example.com/i.png" /></a></p>' },
    ];

    expect(groupLessonBlocks(blocks)).toEqual(blocks.map((block) => ({ kind: 'block', block })));
  });

  it('stays fast on adversarial html and link text', () => {
    const blocks: PlayableLessonBlock[] = [
      { type: 'html', html: `<a ${'href="" '.repeat(6_000)}` },
      { type: 'html', html: `<p><a href="https://example.com/a">${'/'.repeat(50_000)}a</a></p>` },
      { type: 'link', url: 'https://example.com/b', description: `${'/'.repeat(50_000)}a` },
    ];

    const started = performance.now();
    groupLessonBlocks(blocks);

    expect(performance.now() - started).toBeLessThan(100);
  });

  it('keeps a mailto link readable without a description', () => {
    expect(groupLessonBlocks([{ type: 'link', url: 'mailto:teacher@example.com' }])).toEqual([
      {
        kind: 'links',
        links: [
          { url: 'mailto:teacher@example.com', label: 'teacher@example.com', host: 'teacher@example.com' },
        ],
      },
    ]);
  });
});
