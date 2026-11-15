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
      files.set(requirement.file, (files.get(requirement.file) ?? '').replaceAll(text, ''));
      expect(collectShopKeyDoctrineProblems(files)).toEqual([
        expect.stringMatching(new RegExp(`^\\[shop-key-doctrine\\] ${requirement.file.replaceAll('.', '\\.')} .*${requirement.reason}`)),
      ]);
    },
  );

  it('does not accept the key class or the keyed ShipX routes described outside their sections', () => {
    const everything = shopKeyDoctrineRequirements
      .filter((requirement) => requirement.file === 'app/docs/security.md')
      .map((requirement) => requirement.text)
      .join(' ');
    const files = new Map([
      ['app/CLAUDE.md', 'Shop management keys (owner decision 2026-11-14): text'],
      ['app/docs/security.md', `## Tenant API keys\n\nNothing.\n\n## InPost ShipX credentials\n\nNothing.\n\n## Other\n\n${everything}\n`],
    ]);
    expect(collectShopKeyDoctrineProblems(files)).toHaveLength(shopKeyDoctrineRequirements.length - 1);
  });

  it('requires the keyed ShipX routes in the carrier credentials section', () => {
    expect(shopKeyDoctrineRequirements
      .filter((requirement) => requirement.section === '## InPost ShipX credentials')
      .map((requirement) => requirement.text)).toEqual([
      '`POST /api/m2m/shop/integrations/shipx/configure`',
      '`/api/m2m/shop/orders/<orderId>/shipx`',
      'classified `api-key`',
      "act as the key's issuer",
    ]);
  });

  it('reports a surface that is not tracked markdown', () => {
    expect(collectShopKeyDoctrineProblems(new Map())).toEqual([
      '[shop-key-doctrine] app/CLAUDE.md is not tracked markdown',
      '[shop-key-doctrine] app/docs/security.md is not tracked markdown',
    ]);
  });
});
