import { describe, expect, it } from 'vitest';

import { capabilitiesForPrincipal, PRINCIPALS, requiresVerifiedEmail } from './authorization.js';
import {
  CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS,
  CHANGE_PROPOSAL_LIMITS,
  changeProposalCapExceeded,
  changeProposalDisplayStatus,
  changeProposalEffectWithinLimit,
  changeProposalEventSchema,
  changeProposalExpiresAt,
  changeProposalFamily,
  changeProposalKeyReceiptSchema,
  changeProposalKeyState,
  changeProposalOperationSchema,
  changeProposalSchema,
  changeProposalStatusSchema,
  changeProposalSubmitCapability,
  changeProposalTargetKind,
  toChangeProposalKeyReceipt,
  toChangeProposalOwnerDetail,
  type ChangeProposal,
} from './change-proposal.js';

const CREATED = '2026-01-01T00:00:00.000Z';
const NOW = '2026-01-02T00:00:00.000Z';

const proposal = (overrides: Partial<ChangeProposal> = {}): ChangeProposal => changeProposalSchema.parse({
  id: 'proposal-1',
  tenantId: 'tenant-1',
  groupId: null,
  groupPosition: null,
  operation: 'product.update',
  input: { id: 'product-1', title: 'After' },
  effect: { title: { before: 'Before', after: 'After' } },
  target: { kind: 'product', id: 'product-1' },
  status: 'pending',
  proposedByKeyId: 'key-1',
  proposedByKeyName: 'Catalogue agent',
  proposedByIssuerUserId: 'owner-1',
  createdAt: CREATED,
  expiresAt: changeProposalExpiresAt(CREATED),
  decidedByUserId: null,
  decidedAt: null,
  decisionNote: null,
  appliedResourceId: null,
  failureCode: null,
  failureMessage: null,
  ...overrides,
});

describe('change proposal operations', () => {
  it('lists the catalogue, sales-link and settings operations', () => {
    expect(changeProposalOperationSchema.options).toEqual([
      'product.create',
      'product.update',
      'product.publish',
      'product.unpublish',
      'product.delete-draft',
      'price.create',
      'price.deactivate',
      'stock.enable',
      'stock.adjust',
      'stock.set-threshold',
      'sales-link.create',
      'sales-link.update',
      'sales-link.delete',
      'settings.update',
    ]);
  });

  it('submits every operation under its family\'s proposal capability', () => {
    for (const operation of changeProposalOperationSchema.options) {
      const family = operation === 'settings.update' ? 'settings' : 'catalog';
      expect(changeProposalFamily(operation)).toBe(family);
      expect(changeProposalSubmitCapability(operation)).toBe(`proposal:submit:${family}`);
    }
  });

  it('targets the price only when deactivating it, and the sales link or the settings for their operations', () => {
    expect(changeProposalTargetKind('price.deactivate')).toBe('price');
    expect(changeProposalTargetKind('price.create')).toBe('product');
    expect(changeProposalTargetKind('stock.adjust')).toBe('product');
    expect(changeProposalTargetKind('sales-link.delete')).toBe('sales-link');
    expect(changeProposalTargetKind('settings.update')).toBe('settings');
  });

  it('rejects an operation outside the release', () => {
    expect(changeProposalOperationSchema.safeParse('settings.secret.update').success).toBe(false);
    expect(changeProposalOperationSchema.safeParse('image.upload').success).toBe(false);
  });
});

describe('change proposal capabilities', () => {
  const holders = (capability: Parameters<typeof requiresVerifiedEmail>[0]) =>
    PRINCIPALS.filter((principal) => capabilitiesForPrincipal(principal).includes(capability));

  it('keeps reading and deciding proposals with the owner alone', () => {
    expect(holders('proposal:read')).toEqual(['owner']);
    expect(holders('proposal:decide')).toEqual(['owner']);
  });

  it('holds the submission capabilities only on the owner, so a key intersection can keep them', () => {
    expect(holders('proposal:submit:catalog')).toEqual(['owner']);
    expect(holders('proposal:submit:settings')).toEqual(['owner']);
    expect(holders('proposal:asset:upload')).toEqual(['owner']);
  });

  it('requires a verified e-mail address to decide', () => {
    expect(requiresVerifiedEmail('proposal:decide')).toBe(true);
    expect(requiresVerifiedEmail('proposal:read')).toBe(false);
  });
});

describe('change proposal statuses', () => {
  it('stores six statuses and derives expiry', () => {
    expect(changeProposalStatusSchema.options).toEqual(['pending', 'applied', 'rejected', 'stale', 'withdrawn', 'failed']);
    expect(changeProposalDisplayStatus(proposal(), NOW)).toBe('pending');
    expect(changeProposalDisplayStatus(proposal(), proposal().expiresAt)).toBe('expired');
    expect(changeProposalDisplayStatus(proposal({ status: 'rejected', decidedAt: NOW, decidedByUserId: 'owner-1' }), '2027-01-01T00:00:00.000Z')).toBe('rejected');
  });

  it('expires thirty days after creation', () => {
    expect(changeProposalExpiresAt(CREATED)).toBe('2026-01-31T00:00:00.000Z');
  });

  it('records a failed apply as an apply_failed event', () => {
    expect(CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS.failed).toBe('apply_failed');
    expect(CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS.withdrawn).toBe('withdrawn');
  });
});

describe('change proposal shape', () => {
  it('rejects a target kind the operation does not change', () => {
    expect(changeProposalSchema.safeParse({ ...proposal(), target: { kind: 'price', id: 'price-1' } }).success).toBe(false);
  });

  it('rejects a group without a position', () => {
    expect(changeProposalSchema.safeParse({ ...proposal(), groupId: 'group-1' }).success).toBe(false);
    expect(changeProposalSchema.safeParse({ ...proposal(), groupId: 'group-1', groupPosition: 1 }).success).toBe(true);
  });

  it('accepts a delta effect for a stock adjustment', () => {
    expect(changeProposalSchema.safeParse({
      ...proposal(),
      operation: 'stock.adjust',
      input: { productId: 'product-1', delta: 5, reason: 'restock' },
      effect: { onHand: { delta: 5 } },
    }).success).toBe(true);
  });

  it('rejects a decision note over the limit', () => {
    expect(changeProposalSchema.safeParse({
      ...proposal(),
      status: 'rejected',
      decidedAt: NOW,
      decidedByUserId: 'owner-1',
      decisionNote: 'x'.repeat(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength + 1),
    }).success).toBe(false);
  });

  it('requires an acting account or key on every event', () => {
    const event = { id: 'event-1', tenantId: 'tenant-1', proposalId: 'proposal-1', sequence: 1, kind: 'proposed', note: null, at: NOW };
    expect(changeProposalEventSchema.safeParse({ ...event, actorUserId: null, apiKeyId: null }).success).toBe(false);
    expect(changeProposalEventSchema.safeParse({ ...event, actorUserId: null, apiKeyId: 'key-1' }).success).toBe(true);
    expect(changeProposalEventSchema.safeParse({ ...event, sequence: 0, actorUserId: null, apiKeyId: 'key-1' }).success).toBe(false);
  });
});

describe('change proposal limits', () => {
  it('caps the stored effect at 64 KiB', () => {
    expect(changeProposalEffectWithinLimit({ description: { before: '', after: 'x'.repeat(60_000) } })).toBe(true);
    expect(changeProposalEffectWithinLimit({ description: { before: '', after: 'x'.repeat(CHANGE_PROPOSAL_LIMITS.effectMaxBytes) } })).toBe(false);
  });

  it('answers a cap with a conflict that names the cap', () => {
    expect(changeProposalCapExceeded('key_pending')).toMatchObject({ code: 'conflict', details: { changeProposalCap: 'key_pending' } });
    expect(CHANGE_PROPOSAL_LIMITS).toMatchObject({
      pendingPerKey: 200,
      pendingPerWorkspace: 1_000,
      createdPerKeyPerWindow: 500,
      creationWindowMs: 86_400_000,
      effectMaxBytes: 1_310_720,
      decisionNoteMaxLength: 500,
      groupTitleMaxLength: 500,
    });
  });
});

describe('change proposal views', () => {
  it('gives a key a receipt without the effect, before values or the deciding account', () => {
    const decided = proposal({ status: 'rejected', decidedAt: NOW, decidedByUserId: 'owner-1', decisionNote: 'Not now' });
    const receipt = toChangeProposalKeyReceipt(decided, NOW);

    expect(Object.keys(receipt).toSorted()).toEqual([
      'createdAt', 'decisionNote', 'expiresAt', 'failureCode', 'groupId', 'id', 'input', 'operation', 'status', 'target',
    ]);
    expect(JSON.stringify(receipt)).not.toContain('Before');
    expect(JSON.stringify(receipt)).not.toContain('owner-1');
    expect(changeProposalKeyReceiptSchema.safeParse(receipt).success).toBe(true);
  });

  it('gives the owner the full effect, the key state and the ordered events', () => {
    const detail = toChangeProposalOwnerDetail(proposal(), 'revoked', [
      { id: 'event-1', tenantId: 'tenant-1', proposalId: 'proposal-1', sequence: 1, kind: 'proposed', actorUserId: null, apiKeyId: 'key-1', note: null, at: CREATED },
    ], NOW);

    expect(detail.effect).toEqual({ title: { before: 'Before', after: 'After' } });
    expect(detail.proposedBy).toEqual({ keyId: 'key-1', keyName: 'Catalogue agent', issuerUserId: 'owner-1', keyState: 'revoked' });
    expect(detail.events).toEqual([{ sequence: 1, kind: 'proposed', actorUserId: null, apiKeyId: 'key-1', note: null, at: CREATED }]);
  });

  it('derives the key state from the stored key', () => {
    expect(changeProposalKeyState(null, NOW)).toBe('purged');
    expect(changeProposalKeyState({ revokedAt: CREATED, expiresAt: '2027-01-01T00:00:00.000Z' }, NOW)).toBe('revoked');
    expect(changeProposalKeyState({ revokedAt: null, expiresAt: CREATED }, NOW)).toBe('expired');
    expect(changeProposalKeyState({ revokedAt: null, expiresAt: '2027-01-01T00:00:00.000Z' }, NOW)).toBe('active');
  });
});
