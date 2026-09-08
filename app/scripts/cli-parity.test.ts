import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApiClient } from '#core/client/index.js';

import { collectCliParity, formatCliParity } from './cli-parity.js';

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const inventory = (cli: string) => {
  const root = mkdtempSync(join(import.meta.dirname, '.cli-parity-test-'));
  fixtureRoots.push(root);
  mkdirSync(join(root, 'core/client'), { recursive: true });
  mkdirSync(join(root, 'apps/cli/src'), { recursive: true });
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { noLib: true, types: [], module: 'ESNext', moduleResolution: 'bundler' },
  }));
  writeFileSync(join(root, 'core/client/http.ts'), `
      const API_ROUTES = { lessons: {}, courses: {} };
      export const createApiClient = () => ({
        listLessons: () => API_ROUTES.lessons,
        updateLesson: () => API_ROUTES.lessons,
        listCourses: () => API_ROUTES.courses,
      });
  `);
  writeFileSync(join(root, 'apps/cli/src/main.ts'), cli);
  return collectCliParity(root);
};

describe('CLI parity inventory', () => {
  it('counts typed calls through context, aliases and bracket access', () => {
    const rows = inventory(`
      import { createApiClient } from '../../../core/client/http.js';
      const ctx = { api: createApiClient() };
      ctx.api.listLessons();
      const { updateLesson: update } = ctx.api;
      update();
      ctx.api['listCourses']();
    `);
    expect(rows).toEqual([
      { action: 'listCourses', area: 'courses', cli: true },
      { action: 'listLessons', area: 'lessons', cli: true },
      { action: 'updateLesson', area: 'lessons', cli: true },
    ]);
  });

  it('ignores strings, uncalled references and unrelated methods with matching names', () => {
    const rows = inventory(`
      import { createApiClient } from '../../../core/client/http.js';
      const api = createApiClient();
      const documentation = 'api.updateLesson()';
      const reference = api.listLessons;
      const unrelated = { listCourses: () => 1 };
      unrelated.listCourses();
    `);
    expect(rows.every((row) => !row.cli)).toBe(true);
    expect(formatCliParity(rows)).toBe([
      'CLI parity: 0/3 client actions called; 3 missing (report only)', '',
      'Area\tClient action\tCLI call',
      'courses\tlistCourses\tmissing',
      'lessons\tlistLessons\tmissing',
      'lessons\tupdateLesson\tmissing', '',
      'Missing by area:', 'courses (1):\n  listCourses', 'lessons (2):\n  listLessons\n  updateLesson',
    ].join('\n'));
  });

  it('inventories the complete runtime client table and existing CLI calls', () => {
    const rows = collectCliParity();
    const methods = Object.keys(createApiClient({ baseUrl: 'http://localhost' })).sort();
    expect(rows.map((row) => row.action).sort()).toEqual(methods);
    expect(rows.find((row) => row.action === 'updateLesson')).toEqual({ action: 'updateLesson', area: 'lessons', cli: true });
    expect(rows.find((row) => row.action === 'm2mEnroll')?.cli).toBe(true);
    expect(rows.find((row) => row.action === 'studentLessonPlayback')?.cli).toBe(false);
    expect(rows.every((row) => row.area !== 'other')).toBe(true);
  }, 20_000);
});
