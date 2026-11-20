import type {
  ChangeProposalGroupOwnerView,
  ChangeProposalOwnerDetail,
  ChangeProposalOwnerView,
} from '#core/domain/index.js';

const proposer = {
  keyId: 'shop-key-catalogue-agent',
  keyName: 'Catalogue agent',
  keyState: 'active',
  issuerUserId: 'fixture-user-studio-owner',
  issuerEmail: 'creator@together.dev',
  issuerIsVerifiedOwner: true,
} as const;

const undecided = {
  decidedByUserId: null,
  decidedByEmail: null,
  decidedAt: null,
  decisionNote: null,
  appliedResourceId: null,
  failureCode: null,
  failureMessage: null,
} as const;

const pendingBase = {
  status: 'pending',
  proposedBy: proposer,
  ...undecided,
} as const;

export const CHANGE_PROPOSAL_GROUP_ID = 'proposal-group-field-guide';

const groupItem = (
  position: number,
  id: string,
  createdAt: string,
  fields: Pick<ChangeProposalOwnerView, 'operation' | 'target' | 'targetLabel' | 'input' | 'effect'>,
): ChangeProposalOwnerView => ({
  id,
  groupId: CHANGE_PROPOSAL_GROUP_ID,
  groupTitle: 'Launch the printed field guide',
  groupPosition: position,
  ...fields,
  ...pendingBase,
  createdAt,
  expiresAt: '2026-12-20T09:00:00.000Z',
});

const productReference = '$proposal:proposal-field-guide-product';

const groupItemViews: ChangeProposalOwnerView[] = [
  groupItem(1, 'proposal-field-guide-product', '2026-11-20T09:00:00.000Z', {
    operation: 'product.create',
    target: { kind: 'product', id: null },
    targetLabel: null,
    input: { title: 'Field Guide (print)', slug: 'field-guide-print', type: 'physical', priceCents: 3900, currency: 'PLN' },
    effect: {
      exists: { before: false, after: true },
      title: { before: null, after: 'Field Guide (print)' },
      slug: { before: null, after: 'field-guide-print' },
      type: { before: null, after: 'physical' },
      description: {
        before: null,
        after: 'A printed companion to the course with exercises for every module, room for your own notes and a checklist for each lesson. '
          + 'It is shipped in a padded envelope and arrives within three working days. Every copy is checked by hand before it leaves the studio, '
          + 'and the last pages list the online resources that come with the course.',
      },
      priceCents: { before: null, after: 3900 },
      currency: { before: null, after: 'PLN' },
      published: { before: null, after: false },
      coverUrl: { before: null, after: '/api/public/assets/product-cover/field-guide.webp' },
    },
  }),
  groupItem(2, 'proposal-field-guide-price', '2026-11-20T09:00:05.000Z', {
    operation: 'price.create',
    target: { kind: 'product', id: productReference },
    targetLabel: null,
    input: { productId: productReference, kind: 'one_time', amountCents: 3900, currency: 'PLN' },
    effect: {
      activePrices: { before: [], after: [{ kind: 'one_time', interval: null, amountCents: 3900, currency: 'PLN' }] },
    },
  }),
  groupItem(3, 'proposal-field-guide-stock', '2026-11-20T09:00:10.000Z', {
    operation: 'stock.enable',
    target: { kind: 'product', id: productReference },
    targetLabel: null,
    input: { productId: productReference, onHand: 40, lowStockThreshold: 5 },
    effect: {
      tracked: { before: false, after: true },
      onHand: { before: null, after: 40 },
      lowStockThreshold: { before: null, after: 5 },
    },
  }),
  groupItem(4, 'proposal-field-guide-publish', '2026-11-20T09:00:15.000Z', {
    operation: 'product.publish',
    target: { kind: 'product', id: productReference },
    targetLabel: null,
    input: { id: productReference },
    effect: { published: { before: false, after: true } },
  }),
  groupItem(5, 'proposal-field-guide-link', '2026-11-20T09:00:20.000Z', {
    operation: 'sales-link.create',
    target: { kind: 'sales-link', id: null },
    targetLabel: null,
    input: { slug: 'field-guide-offer', title: 'Field guide offer', heading: 'The printed field guide', productIds: [productReference] },
    effect: {
      exists: { before: false, after: true },
      title: { before: null, after: 'Field guide offer' },
      heading: { before: null, after: 'The printed field guide' },
      slug: { before: null, after: 'field-guide-offer' },
      productIds: { before: null, after: [productReference] },
      active: { before: null, after: true },
      listed: { before: null, after: false },
    },
  }),
];

export const changeProposalGroupItems: ChangeProposalOwnerDetail[] = groupItemViews.map((item) => ({
  ...item,
  events: [{ sequence: 1, kind: 'proposed', actorUserId: null, apiKeyId: proposer.keyId, note: null, at: item.createdAt }],
}));

export const changeProposalGroup: ChangeProposalGroupOwnerView = {
  id: CHANGE_PROPOSAL_GROUP_ID,
  title: 'Launch the printed field guide',
  status: 'open',
  proposedBy: proposer,
  createdAt: '2026-11-20T08:59:00.000Z',
  expiresAt: '2026-12-20T09:00:00.000Z',
  items: changeProposalGroupItems,
};

export const STOCK_PRODUCT_ID = 'product-studio-workbook-print';

export const stockAdjustmentProposal: ChangeProposalOwnerView = {
  id: 'proposal-workbook-restock',
  groupId: null,
  groupTitle: null,
  groupPosition: null,
  operation: 'stock.adjust',
  target: { kind: 'product', id: STOCK_PRODUCT_ID },
  targetLabel: 'Creator Workbook (print)',
  input: { productId: STOCK_PRODUCT_ID, delta: 50, reason: 'New delivery from the printer' },
  effect: { onHand: { delta: 50 } },
  ...pendingBase,
  createdAt: '2026-11-19T15:30:00.000Z',
  expiresAt: '2026-12-19T15:30:00.000Z',
};

export const settingsProposal: ChangeProposalOwnerView = {
  id: 'proposal-support-settings',
  groupId: null,
  groupTitle: null,
  groupPosition: null,
  operation: 'settings.update',
  target: { kind: 'settings', id: null },
  targetLabel: 'Shop settings',
  input: { supportEmail: 'help@studio.example.org', autoIssueInvoices: true },
  effect: {
    supportEmail: { before: null, after: 'help@studio.example.org' },
    autoIssueInvoices: { before: false, after: true },
  },
  ...pendingBase,
  proposedBy: { ...proposer, keyName: 'Settings assistant', keyId: 'shop-key-settings-assistant', keyState: 'expired' },
  createdAt: '2026-11-20T10:15:00.000Z',
  expiresAt: '2026-12-20T10:15:00.000Z',
};

export const pendingChangeProposals: ChangeProposalOwnerView[] = [
  settingsProposal,
  ...groupItemViews.toReversed(),
  stockAdjustmentProposal,
];

const decided = {
  decidedByUserId: 'fixture-user-studio-owner',
  decidedByEmail: 'creator@together.dev',
  appliedResourceId: null,
  failureCode: null,
  failureMessage: null,
  decisionNote: null,
} as const;

export const historyChangeProposals: ChangeProposalOwnerView[] = [
  {
    id: 'proposal-workshop-title',
    groupId: null,
    groupTitle: null,
    groupPosition: null,
    operation: 'product.update',
    target: { kind: 'product', id: 'product-studio-workshop' },
    targetLabel: 'Scenario Workshop',
    input: { id: 'product-studio-workshop', title: 'Scenario Workshop', priceCents: 52900 },
    effect: { title: { before: 'Scenario workshop', after: 'Scenario Workshop' }, priceCents: { before: 49900, after: 52900 } },
    status: 'applied',
    proposedBy: proposer,
    createdAt: '2026-11-18T08:00:00.000Z',
    expiresAt: '2026-12-18T08:00:00.000Z',
    ...decided,
    decidedAt: '2026-11-18T09:12:00.000Z',
    appliedResourceId: 'product-studio-workshop',
  },
  {
    id: 'proposal-club-price',
    groupId: null,
    groupTitle: null,
    groupPosition: null,
    operation: 'price.create',
    target: { kind: 'product', id: 'product-club' },
    targetLabel: 'Studio Club - subscription',
    input: { productId: 'product-club', kind: 'recurring', interval: 'year', amountCents: 49000, currency: 'PLN' },
    effect: {
      activePrices: {
        before: [{ kind: 'recurring', interval: 'month', amountCents: 4900, currency: 'PLN' }],
        after: [
          { kind: 'recurring', interval: 'month', amountCents: 4900, currency: 'PLN' },
          { kind: 'recurring', interval: 'year', amountCents: 49000, currency: 'PLN' },
        ],
      },
    },
    status: 'rejected',
    proposedBy: proposer,
    createdAt: '2026-11-17T12:00:00.000Z',
    expiresAt: '2026-12-17T12:00:00.000Z',
    ...decided,
    decidedAt: '2026-11-17T16:40:00.000Z',
    decisionNote: 'We keep the yearly plan for the spring launch.',
  },
  {
    id: 'proposal-workbook-stock-down',
    groupId: null,
    groupTitle: null,
    groupPosition: null,
    operation: 'stock.adjust',
    target: { kind: 'product', id: STOCK_PRODUCT_ID },
    targetLabel: 'Creator Workbook (print)',
    input: { productId: STOCK_PRODUCT_ID, delta: -3, reason: 'Damaged copies' },
    effect: { onHand: { delta: -3 } },
    status: 'failed',
    proposedBy: proposer,
    createdAt: '2026-11-16T10:00:00.000Z',
    expiresAt: '2026-12-16T10:00:00.000Z',
    ...decided,
    decidedAt: '2026-11-16T11:00:00.000Z',
    failureCode: 'conflict',
    failureMessage: 'Stock cannot go below zero',
  },
  {
    id: 'proposal-free-preview-unpublish',
    groupId: null,
    groupTitle: null,
    groupPosition: null,
    operation: 'product.unpublish',
    target: { kind: 'product', id: 'product-free-preview' },
    targetLabel: 'Free preview',
    input: { id: 'product-free-preview' },
    effect: { published: { before: true, after: false } },
    status: 'stale',
    proposedBy: { ...proposer, keyState: 'revoked' },
    createdAt: '2026-11-15T10:00:00.000Z',
    expiresAt: '2026-12-15T10:00:00.000Z',
    ...decided,
    decidedAt: '2026-11-15T12:00:00.000Z',
  },
];

export const historyDetail = (proposal: ChangeProposalOwnerView): ChangeProposalOwnerDetail => ({
  ...proposal,
  events: [
    { sequence: 1, kind: 'proposed', actorUserId: null, apiKeyId: proposal.proposedBy.keyId, note: null, at: proposal.createdAt },
    ...(proposal.decidedAt === null ? [] : [{
      sequence: 2,
      kind: proposal.status === 'failed' ? 'apply_failed' as const : proposal.status === 'applied' ? 'applied' as const : proposal.status === 'rejected' ? 'rejected' as const : 'stale' as const,
      actorUserId: proposal.decidedByUserId,
      apiKeyId: null,
      note: proposal.decisionNote,
      at: proposal.decidedAt,
    }]),
  ],
});
