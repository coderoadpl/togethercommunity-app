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

  const labelsOf = (blocks: PlayableLessonBlock[]): string[] => {
    const groups = groupLessonBlocks(blocks);
    return groups.flatMap((group) => (group.kind === 'links' ? group.links.map((link) => link.label) : []));
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
          label: 'developer.mozilla.org',
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
        collapsed: false,
      },
      {
        kind: 'sandbox',
        provider: 'codepen',
        providerName: 'CodePen',
        embedUrl: 'https://codepen.io/coderoad/embed/abcDEF',
        canonicalUrl: 'https://codepen.io/coderoad/pen/abcDEF',
        caption: null,
        collapsed: false,
      },
      { kind: 'block', block: { type: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' } },
    ]);
  });

  it('renders one sandbox per block when several blocks point at the same sandbox', () => {
    const groups = groupLessonBlocks([
      { type: 'link', url: 'https://codesandbox.io/embed/abc123', description: 'Zadanie' },
      { type: 'embed', embedUrl: 'https://codesandbox.io/p/sandbox/abc123' },
    ]);

    expect(groups.map((group) => (group.kind === 'sandbox' ? group.caption : group.kind))).toEqual([
      'Zadanie',
      null,
    ]);
  });

  it('carries the collapsed flag from the embed block onto its sandbox group', () => {
    const groups = groupLessonBlocks([
      { type: 'embed', embedUrl: 'https://codesandbox.io/s/abc123', collapsed: true },
      { type: 'embed', embedUrl: 'https://codesandbox.io/s/def456' },
      { type: 'link', url: 'https://codesandbox.io/s/ghi789' },
    ]);

    expect(groups.map((group) => (group.kind === 'sandbox' ? group.collapsed : group.kind))).toEqual([
      true,
      false,
      false,
    ]);
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

  it('renders a repeated link target once per block the author placed', () => {
    const groups = groupLessonBlocks([
      { type: 'link', url: 'https://github.com/coderoadpl/task-1', description: 'GitHub' },
      { type: 'link', url: 'https://github.com/coderoadpl/task-1', description: 'Repozytorium zadania' },
      { type: 'link', url: 'https://github.com/coderoadpl/task-1' },
    ]);

    expect(groups).toEqual([
      {
        kind: 'links',
        links: [
          { url: 'https://github.com/coderoadpl/task-1', label: 'GitHub', host: 'github.com' },
          { url: 'https://github.com/coderoadpl/task-1', label: 'Repozytorium zadania', host: 'github.com' },
          { url: 'https://github.com/coderoadpl/task-1', label: 'github.com', host: 'github.com' },
        ],
      },
    ]);
  });

  it('leaves an html block in place even when it holds a single anchor', () => {
    const blocks: PlayableLessonBlock[] = [
      { type: 'html', html: '<p><a href="https://github.com/coderoadpl/task-1">repozytorium</a></p>' },
      { type: 'html', html: '<p><a href="https://codesandbox.io/s/abc123">zadanie</a></p>' },
      { type: 'html', html: '<p>Zobacz <a href="https://example.com/a">a</a> i <a href="https://example.com/b">b</a></p>' },
    ];

    expect(groupLessonBlocks(blocks)).toEqual(blocks.map((block) => ({ kind: 'block', block })));
  });

  it('keeps a link section around an html block that repeats the same target', () => {
    const repoUrl = 'https://github.com/coderoadpl/task-1';
    const htmlBlock: PlayableLessonBlock = {
      type: 'html',
      html: `<p><a href="${repoUrl}">repozytorium</a></p>`,
    };

    expect(groupLessonBlocks([{ type: 'link', url: repoUrl, description: 'GitHub' }, htmlBlock])).toEqual([
      { kind: 'links', links: [{ url: repoUrl, label: 'GitHub', host: 'github.com' }] },
      { kind: 'block', block: htmlBlock },
    ]);
  });

  it('labels a description-less link with its host alone', () => {
    expect(
      labelsOf([
        { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex' },
        { type: 'html', html: '<p>Notatki</p>' },
        { type: 'link', url: 'https://www.github.com/coderoadpl/task-1/' },
      ]),
    ).toEqual(['developer.mozilla.org', 'github.com']);
  });

  it('appends the last path segment when two chips in one section would collide', () => {
    expect(
      labelsOf([
        { type: 'link', url: 'https://github.com/a/one' },
        { type: 'link', url: 'https://github.com/a/two' },
        { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex#syntax' },
        { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex#examples' },
        { type: 'link', url: 'https://example.com' },
      ]),
    ).toEqual([
      'github.com / one',
      'github.com / two',
      'developer.mozilla.org / flex#syntax',
      'developer.mozilla.org / flex#examples',
      'example.com',
    ]);
  });

  it('keeps a repeated target on its host when the path cannot tell the chips apart', () => {
    expect(
      labelsOf([
        { type: 'link', url: 'https://github.com/coderoadpl/task-1' },
        { type: 'link', url: 'https://github.com/coderoadpl/task-1' },
        { type: 'link', url: 'https://example.com/a' },
        { type: 'link', url: 'https://example.com/b' },
      ]),
    ).toEqual(['github.com', 'github.com', 'example.com / a', 'example.com / b']);
  });

  it('leaves chips on one host short when they sit in different sections', () => {
    expect(
      labelsOf([
        { type: 'link', url: 'https://github.com/a/one' },
        { type: 'html', html: '<p>Notatki</p>' },
        { type: 'link', url: 'https://github.com/a/two' },
      ]),
    ).toEqual(['github.com', 'github.com']);
  });

  it('appends the last path segment when a derived chip repeats a description', () => {
    expect(
      labelsOf([
        { type: 'link', url: 'https://example.com/a', description: 'developer.mozilla.org' },
        { type: 'link', url: 'https://developer.mozilla.org/pl/docs/Web/CSS/flex' },
      ]),
    ).toEqual(['developer.mozilla.org', 'developer.mozilla.org / flex']);
  });

  it('decodes percent-escapes in the appended path segment', () => {
    expect(
      labelsOf([
        { type: 'link', url: 'https://example.com/docs/uk%C5%82ad%20flex' },
        { type: 'link', url: 'https://example.com/docs/siatka' },
      ]),
    ).toEqual(['example.com / układ flex', 'example.com / siatka']);
  });

  it('falls back to a derived label when the description repeats the URL', () => {
    expect(
      labelsOf([
        { type: 'link', url: 'https://github.com/a/b', description: 'https://github.com/a/b' },
        { type: 'link', url: 'https://example.com/docs', description: 'example.com/docs' },
        { type: 'link', url: 'https://other.example.com:8080/x', description: 'other.example.com:8080/y' },
        { type: 'link', url: 'https://www.wikipedia.org/wiki/Flex', description: 'wikipedia.org' },
      ]),
    ).toEqual(['github.com', 'example.com', 'other.example.com', 'wikipedia.org']);
  });

  it('keeps a dotted product name as the description it was given', () => {
    expect(
      labelsOf([
        { type: 'link', url: 'https://nodejs.org/docs/latest/api/', description: 'Node.js' },
        { type: 'link', url: 'https://expressjs.com/en/starter/hello-world.html', description: 'Node.js/Express' },
      ]),
    ).toEqual(['Node.js', 'Node.js/Express']);
  });

  it('keeps a mailto link readable without a description', () => {
    expect(
      groupLessonBlocks([
        { type: 'link', url: 'mailto:teacher@example.com' },
        { type: 'link', url: 'mailto:teacher@example.com?subject=Zadanie%201', description: 'Zadanie 1' },
      ]),
    ).toEqual([
      {
        kind: 'links',
        links: [
          { url: 'mailto:teacher@example.com', label: 'teacher@example.com', host: 'teacher@example.com' },
          {
            url: 'mailto:teacher@example.com?subject=Zadanie%201',
            label: 'Zadanie 1',
            host: 'teacher@example.com',
          },
        ],
      },
    ]);
  });

  it('stays bounded on a description that mimics a schemeless URL at length', () => {
    const longText = `${'host.'.repeat(50_000)}pl/a`;
    const started = performance.now();

    expect(labelsOf([{ type: 'link', url: 'https://example.com/b', description: longText }])).toEqual([longText]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
