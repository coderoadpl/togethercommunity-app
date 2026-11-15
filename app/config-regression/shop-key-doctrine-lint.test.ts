import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectShopKeyDoctrineProblems, shopKeyDoctrineContradictions, shopKeyDoctrineRequirements } from '../scripts/shop-key-doctrine-lint.js';

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

  it.each(shopKeyDoctrineContradictions.map((contradiction) => [contradiction.text, contradiction] as const))(
    'reports a doctrine that says %s',
    (text, contradiction) => {
      const files = readSurfaces();
      files.set(contradiction.file, `${files.get(contradiction.file) ?? ''}\n${text.replaceAll(' ', '\n')}\n`);
      expect(collectShopKeyDoctrineProblems(files)).toEqual([
        `[shop-key-doctrine] ${contradiction.file} ${contradiction.reason} (found "${text}")`,
      ]);
    },
  );

  const sectioned = shopKeyDoctrineRequirements.filter((requirement) => requirement.section !== undefined);
  const sections = [...new Set(sectioned.map((requirement) => requirement.section))];

  it('does not accept the security doctrine described outside its sections', () => {
    const files = readSurfaces();
    const empty = sections.map((section) => `${section ?? ''}\n\nNothing.\n`).join('\n');
    files.set('app/docs/security.md', `${empty}\n## Other\n\n${sectioned.map((requirement) => requirement.text).join('\n')}\n`);
    expect(collectShopKeyDoctrineProblems(files)).toHaveLength(sectioned.length);
  });

  it('accepts the required security doctrine wrapped across lines', () => {
    const files = readSurfaces();
    files.set('app/docs/security.md', sections.map((section) => [
      `${section ?? ''}\n`,
      ...sectioned
        .filter((requirement) => requirement.section === section)
        .map((requirement) => requirement.text.replaceAll(' ', '\n  ')),
    ].join('\n')).join('\n\n'));
    expect(collectShopKeyDoctrineProblems(files)).toEqual([]);
  });

  it('reports a surface that is not tracked markdown', () => {
    expect(collectShopKeyDoctrineProblems(new Map())).toEqual([
      '[shop-key-doctrine] app/CLAUDE.md is not tracked markdown',
      '[shop-key-doctrine] app/docs/security.md is not tracked markdown',
      '[shop-key-doctrine] app/docs/shop-management-keys.md is not tracked markdown',
      '[shop-key-doctrine] app/docs/observability.md is not tracked markdown',
    ]);
  });
});
