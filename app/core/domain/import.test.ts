import { describe, expect, it } from 'vitest';

import { importLessonRecordSchema, importRecordSchemaFor } from './import.js';

const lessonRecord = (embed: Record<string, unknown>) => ({
  importKey: 'lesson-l1',
  legacyId: 'l1',
  name: 'Dialogs in JavaScript',
  isPreview: false,
  contents: [embed],
});

const collapsedEmbed = {
  type: 'embed',
  embedUrl: 'https://codesandbox.io/s/alert-demo-abc123',
  collapsed: true,
};

describe('lesson import records', () => {
  it('accepts an embed block marked as collapsed', () => {
    const parsed = importLessonRecordSchema.safeParse(lessonRecord(collapsedEmbed));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.contents).toEqual([collapsedEmbed]);
  });

  it('accepts the collapsed flag through the m2m record schema for lessons', () => {
    expect(importRecordSchemaFor('lesson').safeParse(lessonRecord(collapsedEmbed)).success).toBe(true);
  });

  it('leaves collapsed absent when the record omits it', () => {
    const parsed = importLessonRecordSchema.safeParse(
      lessonRecord({ type: 'embed', embedUrl: 'https://codesandbox.io/s/alert-demo-abc123' }),
    );

    expect(parsed.success && parsed.data.contents).toEqual([
      { type: 'embed', embedUrl: 'https://codesandbox.io/s/alert-demo-abc123' },
    ]);
  });

  it('rejects a non-boolean collapsed value', () => {
    const parsed = importLessonRecordSchema.safeParse(
      lessonRecord({ ...collapsedEmbed, collapsed: 'true' }),
    );

    expect(parsed.success).toBe(false);
  });
});
