const proposer = {
  keyId: 'shop-key-catalogue-agent',
  keyName: 'Catalogue agent',
  keyState: 'active',
  issuerUserId: 'fixture-user-studio-owner',
  issuerEmail: 'creator@together.dev',
  issuerIsVerifiedOwner: true,
  issuerIsFormerTeamMember: false,
} as const;

const undecided = {
  decidedByUserId: null,
  decidedByEmail: null,
  decidedByIsFormerTeamMember: false,
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

const groupItem = <F extends object>(position: number, id: string, createdAt: string, fields: F) => ({
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

const groupItemViews = [
  groupItem(1, 'proposal-field-guide-product', '2026-11-20T09:00:00.000Z', {
    operation: 'product.create',
    target: { kind: 'product' as const, id: null },
    targetLabel: null,
    targetPrice: null,
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
    target: { kind: 'product' as const, id: productReference },
    targetLabel: null,
    targetPrice: null,
    input: { productId: productReference, kind: 'one_time', amountCents: 3900, currency: 'PLN' },
    effect: {
      activePrices: { before: [], after: [{ kind: 'one_time', interval: null, amountCents: 3900, currency: 'PLN' }] },
    },
  }),
  groupItem(3, 'proposal-field-guide-stock', '2026-11-20T09:00:10.000Z', {
    operation: 'stock.enable',
    target: { kind: 'product' as const, id: productReference },
    targetLabel: null,
    targetPrice: null,
    input: { productId: productReference, onHand: 40, lowStockThreshold: 5 },
    effect: {
      tracked: { before: false, after: true },
      onHand: { before: null, after: 40 },
      lowStockThreshold: { before: null, after: 5 },
    },
  }),
  groupItem(4, 'proposal-field-guide-publish', '2026-11-20T09:00:15.000Z', {
    operation: 'product.publish',
    target: { kind: 'product' as const, id: productReference },
    targetLabel: null,
    targetPrice: null,
    input: { id: productReference },
    effect: { published: { before: false, after: true } },
  }),
  groupItem(5, 'proposal-field-guide-link', '2026-11-20T09:00:20.000Z', {
    operation: 'sales-link.create',
    target: { kind: 'sales-link' as const, id: null },
    targetLabel: null,
    targetPrice: null,
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

export const changeProposalGroupItems = groupItemViews.map((item) => ({
  ...item,
  events: [{ sequence: 1, kind: 'proposed' as const, actorUserId: null, apiKeyId: proposer.keyId, note: null, at: item.createdAt }],
}));

export const changeProposalGroup = {
  id: CHANGE_PROPOSAL_GROUP_ID,
  title: 'Launch the printed field guide',
  status: 'open' as const,
  proposedBy: proposer,
  createdAt: '2026-11-20T08:59:00.000Z',
  expiresAt: '2026-12-20T09:00:00.000Z',
  items: changeProposalGroupItems,
};

export const STOCK_PRODUCT_ID = 'product-studio-workbook-print';

export const stockAdjustmentProposal = {
  id: 'proposal-workbook-restock',
  groupId: null,
  groupTitle: null,
  groupPosition: null,
  operation: 'stock.adjust',
  target: { kind: 'product' as const, id: STOCK_PRODUCT_ID },
  targetLabel: 'Creator Workbook (print)',
  targetPrice: null,
  input: { productId: STOCK_PRODUCT_ID, delta: 50, reason: 'New delivery from the printer' },
  effect: { onHand: { delta: 50 } },
  ...pendingBase,
  createdAt: '2026-11-19T15:30:00.000Z',
  expiresAt: '2026-12-19T15:30:00.000Z',
};

export const settingsProposal = {
  id: 'proposal-support-settings',
  groupId: null,
  groupTitle: null,
  groupPosition: null,
  operation: 'settings.update',
  target: { kind: 'settings' as const, id: null },
  targetLabel: null,
  targetPrice: null,
  input: { supportEmail: 'help@studio.example.org', autoIssueInvoices: true },
  effect: {
    supportEmail: { before: null, after: 'help@studio.example.org' },
    autoIssueInvoices: { before: false, after: true },
  },
  ...pendingBase,
  proposedBy: { ...proposer, keyName: 'Settings assistant', keyId: 'shop-key-settings-assistant', keyState: 'expired' as const },
  createdAt: '2026-11-20T10:15:00.000Z',
  expiresAt: '2026-12-20T10:15:00.000Z',
};

export const pendingChangeProposals = [
  settingsProposal,
  ...groupItemViews.toReversed(),
  stockAdjustmentProposal,
];

const decided = {
  decidedByUserId: 'fixture-user-studio-owner',
  decidedByEmail: 'creator@together.dev',
  decidedByIsFormerTeamMember: false,
  appliedResourceId: null,
  failureCode: null,
  failureMessage: null,
  decisionNote: null,
} as const;

export const historyChangeProposals = [
  {
    id: 'proposal-workshop-title',
    groupId: null,
    groupTitle: null,
    groupPosition: null,
    operation: 'product.update',
    target: { kind: 'product' as const, id: 'product-studio-workshop' },
    targetLabel: 'Scenario Workshop',
    targetPrice: null,
    input: { id: 'product-studio-workshop', title: 'Scenario Workshop', priceCents: 52900 },
    effect: { title: { before: 'Scenario workshop', after: 'Scenario Workshop' }, priceCents: { before: 49900, after: 52900 } },
    status: 'applied' as const,
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
    target: { kind: 'product' as const, id: 'product-club' },
    targetLabel: 'Studio Club - subscription',
    targetPrice: null,
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
    status: 'rejected' as const,
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
    target: { kind: 'product' as const, id: STOCK_PRODUCT_ID },
    targetLabel: 'Creator Workbook (print)',
    targetPrice: null,
    input: { productId: STOCK_PRODUCT_ID, delta: -3, reason: 'Damaged copies' },
    effect: { onHand: { delta: -3 } },
    status: 'failed' as const,
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
    target: { kind: 'product' as const, id: 'product-free-preview' },
    targetLabel: 'Free preview',
    targetPrice: null,
    input: { id: 'product-free-preview' },
    effect: { published: { before: true, after: false } },
    status: 'stale' as const,
    proposedBy: { ...proposer, keyState: 'revoked' as const },
    createdAt: '2026-11-15T10:00:00.000Z',
    expiresAt: '2026-12-15T10:00:00.000Z',
    ...decided,
    decidedAt: '2026-11-15T12:00:00.000Z',
  },
];

interface DecidedProposal {
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  proposedBy: { keyId: string };
}

export const historyDetail = <P extends DecidedProposal>(proposal: P) => ({
  ...proposal,
  events: [
    { sequence: 1, kind: 'proposed' as const, actorUserId: null, apiKeyId: proposal.proposedBy.keyId, note: null, at: proposal.createdAt },
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

const FILE_PRODUCT_ID = 'product-studio-field-guide-digital';

const FINGERPRINTS = {
  bonus: '3f6c9a0e12bd7a41c0e95b2d8f6a13c4e7b09d25f8a61c3e4b7d0f92a5c8e1b6',
  copy: '9b2e4d6f8a1c3e5b7d9f0a2c4e6b8d0f1a3c5e7b9d2f4a6c8e0b1d3f5a7c9e2b',
  workbookV2: 'c41a7e09d3b58f26a1e4c7b0d9f3a62e8b5c1d47f0a39e6b2c8d5f14a7e03b9c',
  fieldGuide: '5d8e1a4c7f0b3e6a9d2c5f8b1e4a7d0c3f6b9e2a5d8c1f4b7e0a3d6c9f2b5e8a',
} as const;

type ProposalFileFixture = {
  id: string;
  lineageId: string;
  versionNumber: number;
  latest: boolean;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  fingerprint: string | null;
  versionNote: string | null;
};

type ProposalFileFields = Omit<ProposalFileFixture, 'contentType' | 'fingerprint' | 'versionNote'>
  & Partial<Pick<ProposalFileFixture, 'contentType' | 'fingerprint' | 'versionNote'>>;

const productFile = (fields: ProposalFileFields): ProposalFileFixture => ({
  contentType: 'application/pdf',
  fingerprint: null,
  versionNote: null,
  ...fields,
});

const workbookFirst = productFile({ id: 'file-workbook-1', lineageId: 'file-workbook-1', versionNumber: 1, latest: true, fileName: 'workbook.pdf', sizeBytes: 13_002_342 });

const bonusChapter = productFile({
  id: 'staged-file-bonus-chapter',
  lineageId: 'staged-file-bonus-chapter',
  versionNumber: 1,
  latest: true,
  fileName: 'bonus-chapter.epub',
  contentType: 'application/epub+zip',
  sizeBytes: 2_431_119,
  fingerprint: FINGERPRINTS.bonus,
});

const workbookSecond = productFile({
  id: 'staged-file-workbook-2',
  lineageId: 'file-workbook-1',
  versionNumber: 2,
  latest: true,
  fileName: 'workbook.pdf',
  sizeBytes: 13_731_020,
  fingerprint: FINGERPRINTS.workbookV2,
  versionNote: 'Fixed the exercises of chapter 3',
});

const fileProposal = <F extends object>(id: string, createdAt: string, fields: F) => ({
  id,
  groupId: null,
  groupTitle: null,
  groupPosition: null,
  target: { kind: 'product' as const, id: FILE_PRODUCT_ID },
  targetLabel: 'Field Guide (digital)',
  targetPrice: null,
  ...pendingBase,
  createdAt,
  expiresAt: '2026-12-21T09:00:00.000Z',
  ...fields,
});

export const fileAddProposalOf = (stagedFileId: string, fileName: string) => {
  const added = { ...bonusChapter, id: stagedFileId, lineageId: stagedFileId, fileName };
  return fileProposal(`proposal-${stagedFileId}`, '2026-11-21T09:00:00.000Z', {
    operation: 'download.add',
    input: { productId: FILE_PRODUCT_ID, stagedFileId },
    effect: { files: { before: [workbookFirst], after: [workbookFirst, added] } },
    proposedFiles: [{ id: stagedFileId, available: true, copiedFrom: null }],
  });
};

export const fileAddProposal = fileAddProposalOf(bonusChapter.id, bonusChapter.fileName);

const copiedWorkbook = { ...bonusChapter, id: 'staged-file-workbook-copy', lineageId: 'staged-file-workbook-copy', fileName: 'workbook-print-edition.pdf', contentType: 'application/pdf', sizeBytes: 9_874_002, fingerprint: FINGERPRINTS.copy };

export const fileCopyProposal = fileProposal('proposal-workbook-copy', '2026-11-21T09:05:00.000Z', {
  operation: 'download.add',
  input: { productId: FILE_PRODUCT_ID, stagedFileId: copiedWorkbook.id },
  effect: { files: { before: [workbookFirst], after: [workbookFirst, copiedWorkbook] } },
  proposedFiles: [{ id: copiedWorkbook.id, available: true, copiedFrom: { productId: STOCK_PRODUCT_ID, productTitle: 'Creator Workbook (print)', versionNumber: 2 } }],
});

export const fileReplaceProposal = fileProposal('proposal-workbook-version', '2026-11-21T09:10:00.000Z', {
  operation: 'download.replace',
  input: { productId: FILE_PRODUCT_ID, replacesAssetId: workbookFirst.id, stagedFileId: workbookSecond.id, versionNote: workbookSecond.versionNote },
  effect: { files: { before: [workbookFirst], after: [{ ...workbookFirst, latest: false }, workbookSecond] } },
  proposedFiles: [{ id: workbookSecond.id, available: true, copiedFrom: null }],
});

export const fileRemoveProposal = fileProposal('proposal-workbook-removal', '2026-11-21T09:15:00.000Z', {
  operation: 'download.remove',
  input: { productId: FILE_PRODUCT_ID, assetId: workbookSecond.id },
  effect: { files: { before: [{ ...workbookFirst, latest: false }, workbookSecond], after: [workbookFirst] } },
});

export const FILE_GROUP_ID = 'proposal-group-field-guide-digital';

const fileGroupProduct = '$proposal:proposal-field-guide-digital-product';

const fieldGuideFile = productFile({
  id: 'staged-file-field-guide',
  lineageId: 'staged-file-field-guide',
  versionNumber: 1,
  latest: true,
  fileName: 'field-guide.pdf',
  sizeBytes: 21_504_331,
  fingerprint: FINGERPRINTS.fieldGuide,
});

const fileGroupItem = <F extends object>(position: number, id: string, createdAt: string, fields: F) => ({
  id,
  groupId: FILE_GROUP_ID,
  groupTitle: 'Launch the digital field guide',
  groupPosition: position,
  targetLabel: null,
  targetPrice: null,
  ...pendingBase,
  createdAt,
  expiresAt: '2026-12-21T10:00:00.000Z',
  ...fields,
});

const fileGroupItemViews = [
  fileGroupItem(1, 'proposal-field-guide-digital-product', '2026-11-21T10:00:00.000Z', {
    operation: 'product.create',
    target: { kind: 'product' as const, id: null },
    input: { title: 'Field Guide (digital)', slug: 'field-guide-digital', type: 'digital_download', priceCents: 2900, currency: 'PLN' },
    effect: {
      exists: { before: false, after: true },
      title: { before: null, after: 'Field Guide (digital)' },
      slug: { before: null, after: 'field-guide-digital' },
      type: { before: null, after: 'digital_download' },
      priceCents: { before: null, after: 2900 },
      currency: { before: null, after: 'PLN' },
      published: { before: null, after: false },
    },
  }),
  fileGroupItem(2, 'proposal-field-guide-digital-file', '2026-11-21T10:00:05.000Z', {
    operation: 'download.add',
    target: { kind: 'product' as const, id: fileGroupProduct },
    input: { productId: fileGroupProduct, stagedFileId: fieldGuideFile.id },
    effect: { files: { before: [], after: [fieldGuideFile] } },
    proposedFiles: [{ id: fieldGuideFile.id, available: true, copiedFrom: null }],
  }),
  fileGroupItem(3, 'proposal-field-guide-digital-price', '2026-11-21T10:00:10.000Z', {
    operation: 'price.create',
    target: { kind: 'product' as const, id: fileGroupProduct },
    input: { productId: fileGroupProduct, kind: 'one_time', amountCents: 2900, currency: 'PLN' },
    effect: { activePrices: { before: [], after: [{ kind: 'one_time', interval: null, amountCents: 2900, currency: 'PLN' }] } },
  }),
  fileGroupItem(4, 'proposal-field-guide-digital-publish', '2026-11-21T10:00:15.000Z', {
    operation: 'product.publish',
    target: { kind: 'product' as const, id: fileGroupProduct },
    input: { id: fileGroupProduct },
    effect: { published: { before: false, after: true } },
  }),
];

const fileGroupItems = fileGroupItemViews.map((item) => ({
  ...item,
  events: [{ sequence: 1, kind: 'proposed' as const, actorUserId: null, apiKeyId: proposer.keyId, note: null, at: item.createdAt }],
}));

export const fileChangeProposalGroup = {
  id: FILE_GROUP_ID,
  title: 'Launch the digital field guide',
  status: 'open' as const,
  proposedBy: proposer,
  createdAt: '2026-11-21T09:59:00.000Z',
  expiresAt: '2026-12-21T10:00:00.000Z',
  items: fileGroupItems,
};

export const pendingFileChangeProposals = [...fileGroupItemViews.toReversed(), fileAddProposal];

export const fileUnavailableHistoryProposal = {
  ...fileAddProposal,
  id: 'proposal-bonus-chapter-gone',
  status: 'stale' as const,
  ...decided,
  decidedAt: '2026-11-21T12:00:00.000Z',
  proposedFiles: [{ id: bonusChapter.id, available: false, copiedFrom: null }],
};

export const fileHistoryChangeProposals = [fileUnavailableHistoryProposal, ...historyChangeProposals.slice(0, 1)];

export const fileHistoryDetail = <P extends DecidedProposal & { id: string }>(proposal: P) => {
  const detail = historyDetail(proposal);
  return proposal.id === fileUnavailableHistoryProposal.id
    ? { ...detail, events: detail.events.map((event) => event.kind === 'stale' ? { ...event, note: `file_unavailable: The proposed file ${bonusChapter.id} is no longer available, so the proposal cannot be applied; nothing was changed` } : event) }
    : detail;
};
