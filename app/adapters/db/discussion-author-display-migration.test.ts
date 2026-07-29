import { describe, expect, it } from 'vitest';

import { repairDiscussionAuthorDisplay } from './discussion-author-display-migration.js';

describe('0018 discussion author repair', () => {
  it('keeps an existing non-empty display name', () => {
    expect(repairDiscussionAuthorDisplay('  Ada Lovelace  ', 'ignored@example.com')).toBe(
      'Ada Lovelace',
    );
  });

  it('repairs a blank display from a cleaned e-mail local-part', () => {
    expect(repairDiscussionAuthorDisplay('', 'member-lensb+abtw53@example.com')).toBe(
      'Member Lensb',
    );
  });

  it('repairs a blank display without a joined auth e-mail to the Polish fallback', () => {
    expect(repairDiscussionAuthorDisplay('   ', null)).toBe('Uczestnik');
  });
});
