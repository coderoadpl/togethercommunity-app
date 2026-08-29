import { describe, expect, it } from 'vitest';

import { storageFileName } from './storage-assets.js';

describe('storageFileName', () => {
  it.each(['.', '..', '...', '', '   ', '///', '-'])(
    'falls back for a name that sanitizes to nothing usable: %s',
    (fileName) => {
      expect(storageFileName(fileName, 'attachment')).toBe('attachment');
    },
  );

  it('sanitizes a usable name and keeps the object key inside its own prefix', () => {
    expect(storageFileName('Zadanie 1.pdf', 'attachment')).toBe('Zadanie-1.pdf');

    const key = `lesson-attachments/l1/a1/${storageFileName('..', 'attachment')}`;
    expect(new URL(key, 'https://cdn.test/').pathname).toBe('/lesson-attachments/l1/a1/attachment');
  });
});
