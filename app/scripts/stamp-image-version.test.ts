import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stampImageVersion } from './stamp-image-version.js';

const directories: string[] = [];

const manifest = (contents: string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'together-image-manifest-'));
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

describe('image version stamping', () => {
  it.each(['0.13.5', '0.1.0+unknown', '1.0.0-rc.1'])('stamps the derived release version %s', (version) => {
    const path = manifest('{\n  "name": "together",\n  "version": "0.1.0"\n}\n');

    const stamped = stampImageVersion(path, version);

    expect(stamped.ok).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(`{\n  "name": "together",\n  "version": "${version}"\n}\n`);
  });

  it.each(['', 'latest', '0.13', 'v0.13.5', '0.13.5"; rm -rf /'])('refuses %j and leaves the manifest untouched', (version) => {
    const path = manifest('{\n  "version": "0.1.0"\n}\n');

    expect(stampImageVersion(path, version)).toMatchObject({ ok: false });
    expect(readFileSync(path, 'utf8')).toBe('{\n  "version": "0.1.0"\n}\n');
  });

  it('reports a manifest without a version field', () => {
    const path = manifest('{\n  "name": "together"\n}\n');

    expect(stampImageVersion(path, '0.13.5')).toEqual({ ok: false, message: 'package.json has no version field' });
  });
});
