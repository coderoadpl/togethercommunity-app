import { readdirSync } from 'node:fs';

import type { ImportGlobFunction } from 'vite';
import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    glob: ImportGlobFunction;
  }
}

const modules = import.meta.glob('./*.stories.tsx', { eager: true });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

describe('Storybook stories', () => {
  it('loads every story module and validates its CSF exports', () => {
    const storyFiles = readdirSync(import.meta.dirname)
      .filter((file) => file.endsWith('.stories.tsx'));
    expect(Object.keys(modules).length).toBeGreaterThan(0);
    expect(Object.keys(modules)).toHaveLength(storyFiles.length);

    for (const [file, moduleValue] of Object.entries(modules)) {
      expect(isRecord(moduleValue), `${file} must export a module object`).toBe(true);
      if (!isRecord(moduleValue)) continue;
      const defaultExport = moduleValue.default;
      expect(isRecord(defaultExport), `${file} must have a default CSF export`).toBe(true);
      if (!isRecord(defaultExport)) continue;
      expect(
        'title' in defaultExport || 'component' in defaultExport,
        `${file} default export must declare title or component`,
      ).toBe(true);

      for (const [name, story] of Object.entries(moduleValue)) {
        if (name === 'default') continue;
        expect(isRecord(story), `${file}#${name} must be a CSF story object`).toBe(true);
      }
    }
  });
});
