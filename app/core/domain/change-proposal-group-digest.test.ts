import { describe, expect, it } from 'vitest';

import { changeProposalGroupItemsDigest } from './change-proposal-group-digest.js';

describe('the items digest of a change proposal group', () => {
  it.each([
    [[], 'e3b0c44298fc1c14'],
    [['abc'], 'ba7816bf8f01cfea'],
    [['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'], '248d6a61d20638b8'],
    [['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'], 'cf5b16a778af8380'],
    [['The quick brown fox jumps over the lazy dog'], 'd7a8fbb307d78094'],
  ])('is the start of the SHA-256 of the ids joined by new lines, for %j', (ids, digest) => {
    expect(changeProposalGroupItemsDigest(ids)).toBe(digest);
  });

  it('changes with the order, the number and every id of the items', () => {
    const digests = [
      changeProposalGroupItemsDigest(['item-1', 'item-2']),
      changeProposalGroupItemsDigest(['item-2', 'item-1']),
      changeProposalGroupItemsDigest(['item-1', 'item-2', 'item-3']),
      changeProposalGroupItemsDigest(['item-1', 'item-3']),
      changeProposalGroupItemsDigest(['item-1item-2']),
    ];
    expect(new Set(digests).size).toBe(digests.length);
    expect(changeProposalGroupItemsDigest(['item-1', 'item-2'])).toBe(digests[0]);
  });
});
