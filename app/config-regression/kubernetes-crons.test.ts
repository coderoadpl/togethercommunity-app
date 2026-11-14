import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const appRoot = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(appRoot, path), 'utf8');

const vercelCrons = z.object({
  crons: z.array(z.object({ path: z.string(), schedule: z.string() }).strict()),
}).parse(JSON.parse(read('vercel.json'))).crons;

const documentedCrons = (markdown: string): Array<{ path: string; schedule: string }> => {
  const table = /<!-- scheduled-endpoints:start -->\n(?<table>[\s\S]*?)<!-- scheduled-endpoints:end -->/u
    .exec(markdown)?.groups?.['table'] ?? '';
  return [...table.matchAll(/^\| `(?<path>\/[^`]+)` \| `(?<schedule>[^`]+)` \|/gmu)].map((match) => ({
    path: match.groups?.['path'] ?? '',
    schedule: match.groups?.['schedule'] ?? '',
  }));
};

const byPath = (crons: Array<{ path: string; schedule: string }>) =>
  [...crons].sort((left, right) => left.path.localeCompare(right.path));

describe('Kubernetes scheduled calls', () => {
  it('lists every platform cron with the same path and schedule', () => {
    expect(vercelCrons.length).toBeGreaterThan(0);
    expect(byPath(documentedCrons(read('docs/kubernetes.md')))).toEqual(byPath(vercelCrons));
  });

  it('catches a cron that is added, dropped or rescheduled on one side only', () => {
    const documented = read('docs/kubernetes.md');
    const rescheduled = documented.replace('| `/api/internal/dispatch-ksef` | `0 * * * *` |', '| `/api/internal/dispatch-ksef` | `*/5 * * * *` |');
    const dropped = documented.replace(/^\| `\/api\/internal\/domain-check` .*\n/mu, '');

    expect(rescheduled).not.toBe(documented);
    expect(dropped).not.toBe(documented);
    expect(byPath(documentedCrons(rescheduled))).not.toEqual(byPath(vercelCrons));
    expect(byPath(documentedCrons(dropped))).not.toEqual(byPath(vercelCrons));
    expect(byPath(documentedCrons(documented))).not.toEqual(byPath([
      ...vercelCrons,
      { path: '/api/internal/added', schedule: '* * * * *' },
    ]));
  });
});
