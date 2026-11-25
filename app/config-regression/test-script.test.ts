import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };

const appRoot = join(import.meta.dirname, '..');
const invocations = packageJson.scripts.test.split(' && ').map((command) => command.split(' '));
const flagged = (words: readonly string[], flag: string): string[] =>
  words.flatMap((word, index) => word === flag ? [words[index + 1] ?? ''] : []);
const serialFiles = invocations
  .filter((words) => words.includes('--maxWorkers=1'))
  .flatMap((words) => words.slice(2).filter((word) => !word.startsWith('--')));
const parallel = invocations.filter((words) => !words.includes('--maxWorkers=1'));

describe('test script', () => {
  it('runs every invocation through vitest run', () => {
    expect(invocations.every((words) => words[0] === 'vitest' && words[1] === 'run')).toBe(true);
  });

  it('runs the load-sensitive files one at a time before the parallel suite', () => {
    expect(serialFiles).toEqual(expect.arrayContaining([
      'scripts/cli-parity.test.ts',
      'apps/web/src/features/checkout/CheckoutPage.keys.test.tsx',
    ]));
    expect(serialFiles.filter((file) => !existsSync(join(appRoot, file)))).toEqual([]);
    expect(invocations.at(-1)).toBe(parallel[0]);
    expect(parallel).toHaveLength(1);
  });

  it('excludes exactly the serially run files from the parallel suite', () => {
    const words = parallel[0] ?? [];

    expect(flagged(words, '--exclude').sort()).toEqual([...serialFiles].sort());
    expect(words.filter((word, index) => index > 1 && !word.startsWith('--') && words[index - 1] !== '--exclude'))
      .toEqual([]);
  });
});
