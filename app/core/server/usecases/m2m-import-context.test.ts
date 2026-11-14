import { describe, expect, it, vi } from 'vitest';

import {
  emptyImportReferenceMaps,
  rememberImportReference,
  resolveImportReference,
} from './m2m-import-context.js';

describe('import reference cache', () => {
  it.each([true, false])('memoizes audit and resource hits and misses: exists=%s', async (exists) => {
    const references = emptyImportReferenceMaps();
    const audit = vi.fn(async () => ({ resourceId: 'resource' }));
    const target = vi.fn(async () => exists ? { id: 'resource' } : null);
    for (let call = 0; call < 3; call += 1) {
      expect(await resolveImportReference('tenant', 'lesson', 'key', references, audit, target))
        .toMatchObject({ ok: exists });
    }
    expect(audit).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('separates tenant and kind cache entries and starts fresh for every call', async () => {
    const references = emptyImportReferenceMaps();
    const audit = vi.fn(async () => null);
    const target = vi.fn(async () => null);
    await resolveImportReference('tenant-a', 'course', 'key', references, audit, target);
    await resolveImportReference('tenant-b', 'course', 'key', references, audit, target);
    await resolveImportReference('tenant-a', 'lesson', 'key', references, audit, target);
    await resolveImportReference('tenant-a', 'course', 'key', emptyImportReferenceMaps(), audit, target);
    expect(audit).toHaveBeenCalledTimes(4);
    expect(target).not.toHaveBeenCalled();
  });

  it('lets forward references replace a cached miss and refreshes them after successful writes', async () => {
    const references = emptyImportReferenceMaps();
    const audit = vi.fn(async () => null);
    const target = vi.fn(async () => null);
    expect(await resolveImportReference('tenant', 'course', 'key', references, audit, target)).toMatchObject({ ok: false });
    references.course.set('key', 'planned');
    expect(await resolveImportReference('tenant', 'course', 'key', references, audit, target)).toEqual({ ok: true, value: 'planned' });
    rememberImportReference('tenant', 'course', 'key', 'saved', references);
    expect(await resolveImportReference('tenant', 'course', 'key', references, audit, target)).toEqual({ ok: true, value: 'saved' });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledTimes(2);
    expect(target).toHaveBeenLastCalledWith('saved');
  });

  it('retains archive refusal for forward references and memoizes the refusal', async () => {
    const references = emptyImportReferenceMaps();
    references.course.set('key', 'archived');
    const audit = vi.fn(async () => null);
    const target = vi.fn(async () => ({ id: 'archived', archivedAt: '1998-01-01T00:00:00Z' }));
    for (let call = 0; call < 3; call += 1) {
      expect(await resolveImportReference('tenant', 'course', 'key', references, audit, target))
        .toMatchObject({ ok: false, error: { code: 'conflict', message: 'Referenced course "key" is archived' } });
    }
    expect(audit).not.toHaveBeenCalled();
    expect(target).toHaveBeenCalledTimes(1);
  });
});
