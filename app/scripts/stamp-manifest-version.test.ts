import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stampManifestVersion } from './stamp-manifest-version.js';

const directories: string[] = [];

const manifest = (contents: string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'together-manifest-'));
  directories.push(directory);
  const path = join(directory, 'package.json');
  writeFileSync(path, contents);
  return path;
};

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('manifest version stamping', () => {
  it('writes the derived version and leaves the rest of the manifest untouched', () => {
    const path = manifest('{\n  "name": "together",\n  "version": "0.1.0"\n}\n');

    expect(stampManifestVersion(path, '0.2.7')).toBe('stamped');
    expect(readFileSync(path, 'utf8')).toBe('{\n  "name": "together",\n  "version": "0.2.7"\n}\n');
  });

  it('is a no-op on the second pass of the same deployment', () => {
    const path = manifest('{\n  "version": "0.1.0"\n}\n');
    stampManifestVersion(path, '0.2.7');

    expect(stampManifestVersion(path, '0.2.7')).toBe('unchanged');
    expect(readFileSync(path, 'utf8')).toBe('{\n  "version": "0.2.7"\n}\n');
  });

  it('reports a manifest that carries no version field', () => {
    const path = manifest('{\n  "name": "together"\n}\n');

    expect(stampManifestVersion(path, '0.2.7')).toBe('missing-field');
  });
});
