import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lintLinks } from './link-lint.js';

let base: string;

const plant = (name: string, files: Readonly<Record<string, string>>): string => {
  const root = join(base, name);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
};

const lint = (repoRoot: string, files: readonly string[]): string[] =>
  lintLinks(repoRoot, new Map(files.map((rel) => [rel, readFileSync(join(repoRoot, rel), 'utf8')])));

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'together-link-lint-'));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('local Markdown links', () => {
  it('accepts existing relative targets, anchors, titles, images, and directories', () => {
    const root = plant('relative-ok', {
      'docs/a.md': '[b](./b.md "Title") [up](../README.md#anchor) ![image](./image.png) [dir](../docs/)\n',
      'docs/b.md': '',
      'docs/image.png': 'image',
      'README.md': '',
    });
    expect(lint(root, ['docs/a.md'])).toEqual([]);
  });

  it('rejects a missing relative target with the linking file and target', () => {
    const root = plant('relative-missing', { 'docs/a.md': '[gone](./gone.md#section)\n' });
    expect(lint(root, ['docs/a.md'])).toEqual([
      '[link] docs/a.md: "./gone.md#section" points at a missing file',
    ]);
  });

  it('rejects a filesystem-absolute target even when it exists inside the repository', () => {
    const root = plant('absolute-existing', { 'README.md': '' });
    writeFileSync(join(root, 'docs.md'), `[readme](${join(root, 'README.md')})\n`);
    expect(lint(root, ['docs.md'])).toEqual([
      `[link] docs.md: "${join(root, 'README.md')}" resolves against the filesystem root; use a relative path`,
    ]);
  });

  it('rejects a filesystem-absolute image with no site-static fallback', () => {
    const root = plant('absolute-image', { 'docs/a.md': '![banner](/img/banner.png)\n' });
    expect(lint(root, ['docs/a.md'])).toEqual([
      '[link] docs/a.md: "/img/banner.png" resolves against the filesystem root; use a relative path',
    ]);
  });

  it('rejects traversal to an existing file outside the repository', () => {
    const fixture = plant('outside-existing', {
      'outside.md': '',
      'repo/docs/a.md': '[outside](../../outside.md)\n',
    });
    expect(lint(join(fixture, 'repo'), ['docs/a.md'])).toEqual([
      '[link] docs/a.md: "../../outside.md" resolves outside the repository',
    ]);
  });

  it('rejects traversal to a missing file outside the repository', () => {
    const root = plant('outside-missing', { 'docs/a.md': '[gone](../../gone.md)\n' });
    expect(lint(root, ['docs/a.md'])).toEqual([
      '[link] docs/a.md: "../../gone.md" resolves outside the repository',
    ]);
  });

  it('rejects a link to the repository parent itself', () => {
    const root = plant('outside-parent', { 'README.md': '[parent](..)\n' });
    expect(lint(root, ['README.md'])).toEqual([
      '[link] README.md: ".." resolves outside the repository',
    ]);
  });

  it('does not mistake a sibling sharing the repository name for an in-tree target', () => {
    const fixture = plant('outside-prefix', {
      'repo-sibling/file.md': '',
      'repo/README.md': '[sibling](../repo-sibling/file.md)\n',
    });
    expect(lint(join(fixture, 'repo'), ['README.md'])).toEqual([
      '[link] README.md: "../repo-sibling/file.md" resolves outside the repository',
    ]);
  });

  it('rejects links that reach outside the repository through file or directory symlinks', () => {
    const fixture = plant('outside-symlink', {
      'outside/file.md': '',
      'repo/README.md': '[file](./file-link.md) [dir](./dir-link/file.md)\n',
    });
    const root = join(fixture, 'repo');
    symlinkSync(join(fixture, 'outside', 'file.md'), join(root, 'file-link.md'));
    symlinkSync(join(fixture, 'outside'), join(root, 'dir-link'));
    expect(lint(root, ['README.md'])).toEqual([
      '[link] README.md: "./file-link.md" resolves outside the repository through a symbolic link',
      '[link] README.md: "./dir-link/file.md" resolves outside the repository through a symbolic link',
    ]);
  });

  it('accepts symlinks whose targets stay inside the repository', () => {
    const root = plant('inside-symlink', {
      'docs/real.md': '',
      'README.md': '[linked](./linked/real.md)\n',
    });
    symlinkSync(join(root, 'docs'), join(root, 'linked'));
    expect(lint(root, ['README.md'])).toEqual([]);
  });

  it('checks in-tree names starting with two dots rather than treating them as traversal', () => {
    const root = plant('dot-name', { 'README.md': '[gone](./..missing.md)\n' });
    expect(lint(root, ['README.md'])).toEqual([
      '[link] README.md: "./..missing.md" points at a missing file',
    ]);
  });

  it('ignores network URLs, contact links, pure anchors, fenced code, and inline code', () => {
    const root = plant('skipped', {
      'docs/a.md': [
        '[http](http://example.com/gone.md) [https](https://example.com/gone.md)',
        '[mail](mailto:reader@example.com) [tel](tel:+48123)',
        '[scheme-relative](//example.com/gone.png) [anchor](#section)',
        '`[inline](./gone.md)` and `[absolute](/missing.md)`',
        '```md\n[fenced](../../gone.md)\n```',
        '',
      ].join('\n'),
    });
    expect(lint(root, ['docs/a.md'])).toEqual([]);
  });
});
