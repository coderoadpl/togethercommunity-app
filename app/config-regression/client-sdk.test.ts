import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import rootPackage from '../package.json' with { type: 'json' };
import sdkPackage from '../packages/client-sdk/package.json' with { type: 'json' };

const appRoot = join(import.meta.dirname, '..');
const sdkRoot = join(appRoot, 'packages', 'client-sdk');
const distRoot = join(sdkRoot, 'dist');

const listFiles = (dir: string, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return listFiles(join(dir, entry.name), rel);
    return [rel];
  });

const exportTargets = Object.values(sdkPackage.exports).flatMap((entry) =>
  typeof entry === 'string' ? [entry] : [entry.types, entry.default],
);

beforeAll(() => {
  rmSync(distRoot, { recursive: true, force: true });
  execFileSync(
    join(appRoot, 'node_modules', '.bin', 'tsc'),
    ['-p', join('packages', 'client-sdk', 'tsconfig.build.json')],
    { cwd: appRoot },
  );
}, 120_000);

describe('client SDK publish contract', () => {
  it('resolves every exports target from the built output', () => {
    for (const target of exportTargets) {
      expect(target.startsWith('./'), target).toBe(true);
      expect(existsSync(join(sdkRoot, target)), target).toBe(true);
    }
  });

  it('resolves the internal imports map from the built output', () => {
    expect(sdkPackage.imports['#core/*']).toBe('./dist/core/*');
    expect(sdkPackage.imports['#adapters/*']).toBe('./dist/adapters/*');
    expect(existsSync(join(distRoot, 'core', 'domain', 'index.js'))).toBe(true);
    expect(existsSync(join(distRoot, 'core', 'contract', 'index.js'))).toBe(true);
  });

  it('ships only the client closure', () => {
    const files = listFiles(distRoot);
    expect(files.some((rel) => rel.startsWith('core/server'))).toBe(false);
    expect(files.some((rel) => rel.includes('.test.'))).toBe(false);
    const adapterFiles = files.filter((rel) => rel.startsWith('adapters/'));
    expect(adapterFiles.sort()).toEqual([
      'adapters/auth/client-adapter.d.ts',
      'adapters/auth/client-adapter.js',
    ]);
  });

  it('stays a publishable ESM manifest', () => {
    expect(sdkPackage.type).toBe('module');
    expect(sdkPackage.sideEffects).toBe(false);
    expect(sdkPackage.files).toEqual(['dist']);
    expect(sdkPackage.license).toBe(rootPackage.license);
    expect(sdkPackage.version).toMatch(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
    expect(Object.keys(sdkPackage).includes('private')).toBe(false);
    expect(Object.keys(sdkPackage).includes('scripts')).toBe(false);
  });

  it('keeps dependency ranges aligned with the application', () => {
    for (const [name, range] of Object.entries(sdkPackage.dependencies)) {
      expect(rootPackage.dependencies).toMatchObject({ [name]: range });
    }
    expect(sdkPackage.peerDependencies['@tanstack/query-core']).toBe(
      rootPackage.dependencies['@tanstack/query-core'],
    );
  });
});
