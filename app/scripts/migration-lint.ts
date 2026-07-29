import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationFilePattern = /^(\d{4})_[a-z0-9_]+\.sql$/;
const transactionControlPattern = /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/gim;
const concurrentIndexPattern = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi;

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

const parseJournal = (raw: string): JournalEntry[] => {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('entries' in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error('journal has no entries array');
  }
  return parsed.entries.map((value: unknown) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('idx' in value) ||
      typeof value.idx !== 'number' ||
      !('tag' in value) ||
      typeof value.tag !== 'string' ||
      !('when' in value) ||
      typeof value.when !== 'number'
    ) {
      throw new Error('journal entry has an invalid shape');
    }
    return { idx: value.idx, tag: value.tag, when: value.when };
  });
};

export const lintMigrations = (drizzleDir: string): string[] => {
  if (!existsSync(drizzleDir)) {
    return [`[migration] directory "${drizzleDir}" does not exist`];
  }

  const problems: string[] = [];
  const sqlFiles = readdirSync(drizzleDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const filesByPrefix = new Map<number, string>();

  for (const file of sqlFiles) {
    const match = migrationFilePattern.exec(file);
    if (match?.[1] === undefined) {
      problems.push(`[migration] "${file}" must match <NNNN>_<name>.sql`);
      continue;
    }
    const prefix = Number(match[1]);
    const existing = filesByPrefix.get(prefix);
    if (existing !== undefined) {
      problems.push(
        `[migration] duplicate numeric prefix ${match[1]} in "${existing}" and "${file}"`,
      );
    } else {
      filesByPrefix.set(prefix, file);
    }

    const sql = readFileSync(join(drizzleDir, file), 'utf8');
    if (transactionControlPattern.test(sql)) {
      problems.push(
        `[migration] "${file}" contains transaction control; the migrator owns the transaction`,
      );
    }
    transactionControlPattern.lastIndex = 0;
    if (concurrentIndexPattern.test(sql)) {
      problems.push(
        `[migration] "${file}" contains CREATE INDEX CONCURRENTLY, which cannot run in the migration transaction`,
      );
    }
    concurrentIndexPattern.lastIndex = 0;
  }

  const orderedPrefixes = [...filesByPrefix.keys()].sort((left, right) => left - right);
  for (let index = 0; index < orderedPrefixes.length; index += 1) {
    if (orderedPrefixes[index] !== index) {
      problems.push(
        `[migration] expected ${String(index).padStart(4, '0')} at sequence position ${String(index)}`,
      );
      break;
    }
  }

  const journalPath = join(drizzleDir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    problems.push('[migration] meta/_journal.json is missing');
    return problems;
  }

  let entries: JournalEntry[];
  try {
    entries = parseJournal(readFileSync(journalPath, 'utf8'));
  } catch (error) {
    problems.push(`[migration] cannot parse meta/_journal.json: ${String(error)}`);
    return problems;
  }

  const fileTags = new Set(sqlFiles.map((file) => file.replace(/\.sql$/, '')));
  const journalTags = new Set(entries.map((entry) => entry.tag));
  for (const tag of journalTags) {
    if (!fileTags.has(tag)) {
      problems.push(`[migration] journal references "${tag}" but ${tag}.sql is missing`);
    }
  }
  for (const tag of fileTags) {
    if (!journalTags.has(tag)) {
      problems.push(`[migration] ${tag}.sql is missing from the journal`);
    }
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.idx !== index) {
      problems.push(
        `[migration] journal idx ${String(entry.idx)} must equal sequence position ${String(index)}`,
      );
    }
    if (index > 0 && entry.when <= (entries[index - 1]?.when ?? 0)) {
      problems.push(`[migration] journal timestamps must be strictly increasing at "${entry.tag}"`);
    }
    const prefix = /^(\d{4})_/.exec(entry.tag)?.[1];
    if (prefix === undefined || Number(prefix) !== entry.idx) {
      problems.push(`[migration] journal tag "${entry.tag}" does not match idx ${String(entry.idx)}`);
    }
  }

  return problems;
};

const problems = lintMigrations(join(import.meta.dirname, '..', 'drizzle'));
if (problems.length > 0) {
  process.stderr.write(`migration-lint: ${String(problems.length)} issue(s)\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}
process.stdout.write('migration-lint: OK\n');
