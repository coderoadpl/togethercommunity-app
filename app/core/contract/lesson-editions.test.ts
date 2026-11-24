import { describe, expect, it } from 'vitest';

import { lessonEditionOutputSchema, lessonEditionsOutputSchema } from './routes.js';

describe('lesson edition response contracts', () => {
  const edition = { versionId: 'internal-version', number: '2.10', note: 'Revised examples', markedAt: '2026-01-01T00:00:00.000Z' };

  it('exposes only reader metadata in the editions list', () => {
    expect(lessonEditionsOutputSchema.parse({ editions: [{ ...edition, matchesLive: true, version: { payload: {} } }], currentEdition: '2.10' })).toEqual({ editions: [{
      number: '2.10', note: 'Revised examples', markedAt: edition.markedAt, matchesLive: true,
    }], currentEdition: '2.10' });
  });

  it('retains the version identifier in staff marking responses', () => {
    expect(lessonEditionOutputSchema.parse({ edition })).toEqual({ edition });
  });
});
