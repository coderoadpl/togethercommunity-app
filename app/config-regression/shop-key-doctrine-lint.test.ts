import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectShopKeyDoctrineProblems, shopKeyDoctrineRequirements } from '../scripts/shop-key-doctrine-lint.js';

const repoRoot = join(import.meta.dirname, '..', '..');
const surfaces = [...new Set(shopKeyDoctrineRequirements.map((requirement) => requirement.file))];
const readSurfaces = () => new Map(surfaces.map((rel) => [rel, readFileSync(join(repoRoot, rel), 'utf8')]));

describe('shop management key doctrine lint', () => {
  it('finds the owner decision in CLAUDE.md and the key class in the security doctrine', () => {
    expect(collectShopKeyDoctrineProblems(readSurfaces())).toEqual([]);
  });

  it.each(shopKeyDoctrineRequirements.map((requirement) => [requirement.text, requirement] as const))(
    'reports a doctrine without %s',
    (text, requirement) => {
      const files = readSurfaces();
      const spaced = new RegExp(text.split(/\s+/u).map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+'), 'gu');
      files.set(requirement.file, (files.get(requirement.file) ?? '').replace(spaced, ''));
      expect(collectShopKeyDoctrineProblems(files)).toEqual([
        expect.stringMatching(new RegExp(`^\\[shop-key-doctrine\\] ${requirement.file.replaceAll('.', '\\.')} .*${requirement.reason}`)),
      ]);
    },
  );

  it('does not accept the security doctrine described outside the Tenant API keys section', () => {
    const sectioned = shopKeyDoctrineRequirements.filter((requirement) => requirement.section !== undefined);
    const files = readSurfaces();
    files.set('app/docs/security.md', `## Tenant API keys\n\nNothing.\n\n## Other\n\n${sectioned.map((requirement) => requirement.text).join('\n')}\n`);
    expect(collectShopKeyDoctrineProblems(files)).toHaveLength(sectioned.length);
  });

  it('accepts the required security doctrine wrapped across lines', () => {
    const sectioned = shopKeyDoctrineRequirements.filter((requirement) => requirement.section !== undefined);
    const files = readSurfaces();
    files.set('app/docs/security.md', `## Tenant API keys\n\n${sectioned.map((requirement) => requirement.text.replaceAll(' ', '\n  ')).join('\n')}\n`);
    expect(collectShopKeyDoctrineProblems(files)).toEqual([]);
  });

  it('reports a surface that is not tracked markdown', () => {
    expect(collectShopKeyDoctrineProblems(new Map())).toEqual([
      '[shop-key-doctrine] app/CLAUDE.md is not tracked markdown',
      '[shop-key-doctrine] app/docs/security.md is not tracked markdown',
    ]);
  });
});
