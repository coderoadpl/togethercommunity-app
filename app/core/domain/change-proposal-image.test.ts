import { describe, expect, it } from 'vitest';

import { sha256HexOfBytes } from './change-proposal-group-digest.js';
import {
  changeProposalImageChanges,
  changeProposalImageMissingNote,
  changeProposalImageReferences,
  changeProposalUnproposableImageChanges,
  isChangeProposalImageMissingNote,
  parseProposalImagePath,
  parseUploadedImagePath,
  proposalImagePublicPath,
  proposalImagePublishedKey,
  proposalImageQuarantineKey,
} from './change-proposal-image.js';
import { changeProposalNotificationFacts, notificationSchema } from './community.js';

const DIGEST = 'ab'.repeat(32);

describe('content-addressed image paths', () => {
  it('parses only a quarantine-shaped path whose extension the kind accepts', () => {
    expect(parseProposalImagePath(`/api/public/assets/logo/${DIGEST}.svg`)).toEqual({ kind: 'logo', digest: DIGEST, extension: 'svg' });
    expect(parseProposalImagePath(`/api/public/assets/share-image/${DIGEST}.svg`)).toBeNull();
    expect(parseProposalImagePath(`/api/public/assets/avatar/${DIGEST}.webp`)).toBeNull();
    expect(parseProposalImagePath(`/api/public/assets/logo/${DIGEST.toUpperCase()}.png`)).toBeNull();
    expect(parseProposalImagePath(`https://cdn.example.test/api/public/assets/logo/${DIGEST}.png`)).toBeNull();
    expect(parseProposalImagePath(`/api/public/assets/logo/${DIGEST}.png?x=1`)).toBeNull();
  });

  it('parses the random-id addresses of the live upload flow separately', () => {
    expect(parseUploadedImagePath('/api/public/assets/product-cover/11111111-1111-4111-8111-111111111111.webp'))
      .toEqual({ kind: 'product-cover', file: '11111111-1111-4111-8111-111111111111.webp' });
    expect(parseUploadedImagePath(`/api/public/assets/product-cover/${DIGEST}.png`)).toBeNull();
  });

  it('keeps the quarantined copy under the key and the published copy under the digest of the bytes', () => {
    const image = { kind: 'product-cover' as const, digest: sha256HexOfBytes(new Uint8Array([1, 2, 3])), extension: 'png' as const };
    expect(image.digest).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    expect(proposalImageQuarantineKey('t1', 'k1', image)).toBe(`image-asset-quarantine/t1/k1/product-cover/${image.digest}.png`);
    expect(proposalImagePublishedKey('t1', image)).toBe(`image-assets/t1/product-cover/${image.digest}.png`);
    expect(proposalImagePublicPath(image)).toBe(`/api/public/assets/product-cover/${image.digest}.png`);
  });
});

describe('the image fields of a proposal', () => {
  it('reads each quarantine-shaped address of an image field of the expected kind once', () => {
    const cover = `/api/public/assets/product-cover/${DIGEST}.png`;
    expect(changeProposalImageReferences('product.update', { id: 'p', coverUrl: cover, description: cover })).toEqual([
      { kind: 'product-cover', digest: DIGEST, extension: 'png' },
    ]);
    expect(changeProposalImageReferences('settings.update', { logoUrl: `/api/public/assets/logo/${DIGEST}.png`, faviconUrl: cover })).toEqual([
      { kind: 'logo', digest: DIGEST, extension: 'png' },
    ]);
    expect(changeProposalImageReferences('sales-link.create', { coverUrl: cover })).toEqual([]);
    expect(changeProposalImageReferences('later.operation', { coverUrl: cover })).toEqual([]);
  });

  it('lists only the image fields whose effect sets a new address', () => {
    expect(changeProposalImageChanges('settings.update', {
      logoUrl: { before: null, after: '/a' },
      faviconUrl: { before: '/b', after: null },
      name: { before: 'A', after: 'B' },
    })).toEqual([{ field: 'logoUrl', kind: 'logo', value: '/a' }]);
  });

  it('lists a nested checkout image set to an address other than the live one, never a cleared, kept or other field', () => {
    const live = { displayName: 'Acme', logoUrl: 'https://cdn.example.test/logo.png', iconUrl: null };
    expect(changeProposalUnproposableImageChanges('settings.update', {
      checkoutAppearance: { before: live, after: { ...live, logoUrl: 'https://cdn.example.test/new.png', iconUrl: 'https://cdn.example.test/icon.png' } },
    })).toEqual([{ field: 'checkoutAppearance', name: 'logoUrl' }, { field: 'checkoutAppearance', name: 'iconUrl' }]);
    expect(changeProposalUnproposableImageChanges('settings.update', { checkoutAppearance: { before: null, after: { iconUrl: 'https://cdn.example.test/icon.png' } } }))
      .toEqual([{ field: 'checkoutAppearance', name: 'iconUrl' }]);
    for (const after of [{ ...live, logoUrl: null }, { ...live, displayName: 'Renamed' }, null, { ...live, logoUrl: '' }]) {
      expect(changeProposalUnproposableImageChanges('settings.update', { checkoutAppearance: { before: live, after } })).toEqual([]);
    }
    expect(changeProposalUnproposableImageChanges('product.update', { checkoutAppearance: { before: null, after: { logoUrl: '/x' } } })).toEqual([]);
  });
});

describe('the stale note of a missing image', () => {
  it('starts with a stable code the panel recognises, and nothing else carries it', () => {
    const note = changeProposalImageMissingNote({ kind: 'logo', digest: DIGEST, extension: 'png' });
    expect(note).toBe(`image_unavailable: The proposed image /api/public/assets/logo/${DIGEST}.png is no longer available, so the proposal cannot be applied; nothing was changed`);
    expect(isChangeProposalImageMissingNote(note)).toBe(true);
    for (const other of [null, 'key_revoked', 'Item 1 of the group did not apply', 'image_unavailable']) {
      expect(isChangeProposalImageMissingNote(other)).toBe(false);
    }
  });
});

describe('the change-proposal notification payload', () => {
  const stored = (payload: Record<string, unknown>) => notificationSchema.parse({
    id: 'n1', tenantId: 't1', recipientUserId: 'u1', kind: 'change-proposal', sourceKey: 'change-proposal:k1',
    readAt: null, createdAt: '2026-03-01T10:00:00.000Z', payload: { contextKind: 'tenant', snippet: '', ...payload },
  });

  it('reads the typed facts', () => {
    expect(changeProposalNotificationFacts(stored({ changeProposal: { keyName: 'Agent', groupId: 'g1', groupTitle: 'Launch' } })))
      .toEqual({ keyName: 'Agent', groupId: 'g1', groupTitle: 'Launch' });
  });

  it('keeps a notification stored before the typed payload readable', () => {
    expect(changeProposalNotificationFacts(stored({ authorDisplay: 'Agent', contextId: 'g1', snippet: 'Launch' })))
      .toEqual({ keyName: 'Agent', groupId: 'g1', groupTitle: 'Launch' });
    expect(changeProposalNotificationFacts(stored({ authorDisplay: 'Agent' }))).toEqual({ keyName: 'Agent', groupId: null, groupTitle: null });
  });

  it('has no facts for another kind of notification', () => {
    expect(changeProposalNotificationFacts({ ...stored({ authorDisplay: 'Someone' }), kind: 'dm-message' })).toBeNull();
  });
});
