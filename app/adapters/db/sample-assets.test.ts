import { describe, expect, it } from 'vitest';

import { lessonBlockSchema } from '@core/domain/index.js';

import { SAMPLE_LESSON_PDF_URL } from './sample-assets.js';

describe('SAMPLE_LESSON_PDF_URL', () => {
  it('is a same-origin path, not a cross-origin URL that could block framing', () => {
    expect(SAMPLE_LESSON_PDF_URL.startsWith('/')).toBe(true);
    const resolved = new URL(SAMPLE_LESSON_PDF_URL, 'http://studio.localhost:48730');
    expect(resolved.origin).toBe('http://studio.localhost:48730');
  });

  it('is accepted as a pdf lesson block', () => {
    const parsed = lessonBlockSchema.safeParse({
      type: 'pdf',
      pdfUrl: SAMPLE_LESSON_PDF_URL,
      name: 'Ściąga',
    });
    expect(parsed.success).toBe(true);
  });
});
