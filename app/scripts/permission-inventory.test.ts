import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectPermissionInventory,
  renderPermissionTable,
} from './permission-inventory.js';

const root = join(import.meta.dirname, '..');

describe('permission inventory', () => {
  it('covers every runtime route and every exported Ctx use-case', () => {
    const inventory = collectPermissionInventory();
    expect(inventory.routes).toHaveLength(184);
    expect(inventory.useCases).toHaveLength(163);
    expect(inventory.routes.every((row) => row.capability !== null)).toBe(true);
    expect(inventory.useCases.every((row) => row.capability !== null)).toBe(true);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'staff-role').length).toBeGreaterThan(20);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'api-key').length).toBeGreaterThan(5);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'member-scope').length).toBeGreaterThan(10);
  });

  it('machine-checks every derivable before and after principal set', () => {
    const inventory = collectPermissionInventory();
    const changes = [...inventory.routes, ...inventory.useCases]
      .filter((row) => row.derivable)
      .filter((row) => row.before.join(',') !== row.after.join(','));
    expect(changes).toEqual([]);
  });

  it('keeps the known ambiguous behavior visible for owner review', () => {
    const suspicious = collectPermissionInventory().suspicious.map((item) => item.subject);
    expect(suspicious).toEqual(expect.arrayContaining([
      'development-only routes',
      'GET /api/tenant/settings',
      'marketing synthetic identities',
      'tenant creation mode',
    ]));
  });

  it('keeps the generated permission table current', () => {
    expect(readFileSync(join(root, 'docs', 'permission-table.md'), 'utf8')).toBe(
      renderPermissionTable(collectPermissionInventory()),
    );
  });
});
