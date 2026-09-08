import { describe, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, DELETED_POST_PLACEHOLDER } from '#core/domain/index.js';

import { translateDeletedContent } from './deleted-content.js';
import { en } from './en.js';
import { pl } from './pl.js';

describe('deleted content rendering', () => {
  it.each([en, pl])('uses the active dictionary without changing ordinary content', (t) => {
    expect(translateDeletedContent(DELETED_MEMBER_DISPLAY, t)).toBe(t.deletedContent.member);
    expect(translateDeletedContent(DELETED_POST_PLACEHOLDER, t)).toBe(t.deletedContent.post);
    expect(translateDeletedContent('Ada', t)).toBe('Ada');
  });
});
