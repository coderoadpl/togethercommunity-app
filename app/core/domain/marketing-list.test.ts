import { expect, it } from 'vitest';

import { marketingListRuleSchema, marketingListKeySchema } from './marketing-list.js';

it('accepts only bounded non-recursive list rules and immutable key syntax', () => {
  expect(marketingListRuleSchema.safeParse({ kind: 'tag', tags: ['launch'], match: 'all' }).success).toBe(true);
  expect(marketingListRuleSchema.safeParse({ kind: 'tag', tags: [], match: 'all' }).success).toBe(false);
  expect(marketingListRuleSchema.safeParse({ kind: 'sql', query: 'SELECT *' }).success).toBe(false);
  expect(marketingListKeySchema.safeParse('newsletter-2026').success).toBe(true);
  expect(marketingListKeySchema.safeParse('Newsletter|launch').success).toBe(false);
});
