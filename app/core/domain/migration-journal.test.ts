import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type JournalEntry = { idx: number; when: number; tag: string };

describe('drizzle migration journal', () => {
  it('keeps when timestamps strictly increasing so existing databases never skip a migration', () => {
    const raw = readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8');
    const journal: { entries: JournalEntry[] } = JSON.parse(raw);
    const violations = journal.entries
      .filter((entry, i) => i > 0 && entry.when <= (journal.entries[i - 1]?.when ?? 0))
      .map((entry) => entry.tag);
    expect(violations).toEqual([]);
  });
});
