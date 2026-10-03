import { describe, expect, it } from 'vitest';

import { headingIds } from '#core/domain/index.js';

import { lessonHeadingDocument } from '../../components/ui/lesson-heading-document.js';

describe('lesson heading document', () => {
  it('derives an HTML-safe id from hostile heading text', () => {
    const result = lessonHeadingDocument([
      '<h2>&quot; autofocus onfocus=alert(1) x=&quot;</h2>',
    ], headingIds);
    const root = document.createElement('template');
    root.innerHTML = result.htmlBlocks[0] ?? '';
    const heading = root.content.querySelector('h2');

    expect(result.headings).toEqual([{
      id: 'autofocus-onfocus-alert-1-x',
      text: '" autofocus onfocus=alert(1) x="',
    }]);
    expect(heading?.getAttributeNames()).toEqual(['id']);
    expect(heading?.id).toBe('autofocus-onfocus-alert-1-x');
  });
});
