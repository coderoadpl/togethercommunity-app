import { sha256Hex } from './sha256.js';

const ITEMS_DIGEST_LENGTH = 16;

export const changeProposalGroupItemsDigest = (itemIds: readonly string[]): string =>
  sha256Hex(itemIds.join('\n')).slice(0, ITEMS_DIGEST_LENGTH);
