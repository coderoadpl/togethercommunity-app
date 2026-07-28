import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { lintMigrations } from '../scripts/migration-lint.js';

const roots: string[] = [];

const journal = (tags: string[], timestamps = tags.map((_, index) => index + 1)): string =>
  JSON.stringify({
    entries: tags.map((tag, index) => ({
      idx: index,
      tag,
      when: timestamps[index],
    })),
  });

const fixture = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'together-migrations-'));
  roots.push(root);
  mkdirSync(join(root, 'meta'));
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(root, file), content);
  }
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('migration lint', () => {
  it('accepts a contiguous sequence with a matching, strictly increasing journal', () => {
    const root = fixture({
      '0000_first.sql': 'SELECT 1;',
      '0001_second.sql': 'SELECT 2;',
      'meta/_journal.json': journal(['0000_first', '0001_second']),
    });

    expect(lintMigrations(root)).toEqual([]);
  });

  it('rejects duplicate or missing sequence numbers', () => {
    const root = fixture({
      '0000_first.sql': 'SELECT 1;',
      '0002_third.sql': 'SELECT 3;',
      '0002_duplicate.sql': 'SELECT 4;',
      'meta/_journal.json': journal(['0000_first', '0002_third', '0002_duplicate']),
    });

    expect(lintMigrations(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate numeric prefix 0002'),
        expect.stringContaining('expected 0001'),
      ]),
    );
  });

  it('rejects journal drift and non-increasing timestamps', () => {
    const root = fixture({
      '0000_first.sql': 'SELECT 1;',
      '0001_second.sql': 'SELECT 2;',
      'meta/_journal.json': journal(['0000_first', '0001_missing'], [2, 2]),
    });

    expect(lintMigrations(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('0001_missing'),
        expect.stringContaining('0001_second'),
        expect.stringContaining('strictly increasing'),
      ]),
    );
  });

  it('rejects transaction control and concurrent indexes inside migrations', () => {
    const root = fixture({
      '0000_first.sql': 'BEGIN;\nCREATE INDEX CONCURRENTLY sample_idx ON sample (id);\nCOMMIT;',
      'meta/_journal.json': journal(['0000_first']),
    });

    expect(lintMigrations(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('transaction control'),
        expect.stringContaining('CREATE INDEX CONCURRENTLY'),
      ]),
    );
  });
});
