import { z } from 'zod';

import {
  CHANGE_PROPOSAL_LIMITS,
  changeProposalDisplayStatus,
  changeProposalExpiresAt,
  changeProposalIdentifierSchema,
  changeProposalKeyReceiptSchema,
  changeProposalKeyStateSchema,
  changeProposalOperationSchema,
  changeProposalOwnerDetailSchema,
  changeProposalTimestampSchema,
  knownChangeProposalOperation,
  type ChangeProposal,
  type ChangeProposalInput,
  type ChangeProposalKeyReceipt,
  type ChangeProposalOperation,
  type ChangeProposalOwnerDetail,
} from './change-proposal.js';
import { appError, validation, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';

export const CHANGE_PROPOSAL_GROUP_LIMITS = {
  itemsPerGroup: 50,
  openGroupsPerKey: 20,
} as const;

export type ChangeProposalGroupCap = 'group_items' | 'key_open_groups';

const groupCapMessages: Record<ChangeProposalGroupCap, string> = {
  group_items: `This group already holds ${String(CHANGE_PROPOSAL_GROUP_LIMITS.itemsPerGroup)} proposals`,
  key_open_groups: `This key already has ${String(CHANGE_PROPOSAL_GROUP_LIMITS.openGroupsPerKey)} open groups`,
};

export const changeProposalGroupCapExceeded = (cap: ChangeProposalGroupCap): AppError =>
  appError('conflict', groupCapMessages[cap], { changeProposalCap: cap });

export const changeProposalGroupSchema = z.object({
  id: changeProposalIdentifierSchema,
  tenantId: z.string().min(1),
  title: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.groupTitleMaxLength),
  proposedByKeyId: changeProposalIdentifierSchema,
  createdAt: changeProposalTimestampSchema,
}).strict();

export type ChangeProposalGroup = z.output<typeof changeProposalGroupSchema>;

export const createChangeProposalGroupInputSchema = z.object({
  title: z.string().trim().min(1).max(CHANGE_PROPOSAL_LIMITS.groupTitleMaxLength),
}).strict();

export type CreateChangeProposalGroupInput = z.input<typeof createChangeProposalGroupInputSchema>;

export const submitGroupedChangeProposalInputSchema = z.object({
  groupId: changeProposalIdentifierSchema,
  operation: changeProposalOperationSchema,
  input: z.unknown(),
}).strict();

export type SubmitGroupedChangeProposalInput = z.input<typeof submitGroupedChangeProposalInputSchema>;

export const approveChangeProposalGroupInputSchema = z.object({
  id: changeProposalIdentifierSchema,
  itemIds: z.array(changeProposalIdentifierSchema).min(1).max(CHANGE_PROPOSAL_GROUP_LIMITS.itemsPerGroup),
}).strict();

export type ApproveChangeProposalGroupInput = z.input<typeof approveChangeProposalGroupInputSchema>;

const changeProposalGroupStatusSchema = z.enum(['open', 'expired', 'applied', 'rejected', 'withdrawn', 'stale', 'failed']);

export type ChangeProposalGroupStatus = z.output<typeof changeProposalGroupStatusSchema>;

export const changeProposalGroupExpiresAt = (
  group: Pick<ChangeProposalGroup, 'createdAt'>,
  items: readonly Pick<ChangeProposal, 'expiresAt'>[],
): string => items[0]?.expiresAt ?? changeProposalExpiresAt(group.createdAt);

export const changeProposalGroupStatus = (
  group: Pick<ChangeProposalGroup, 'createdAt'>,
  items: readonly Pick<ChangeProposal, 'status' | 'expiresAt'>[],
  now: string,
): ChangeProposalGroupStatus => {
  const settled = items.filter((item) => item.status !== 'pending');
  if (settled.length === 0) {
    return Date.parse(changeProposalGroupExpiresAt(group, items)) <= Date.parse(now) ? 'expired' : 'open';
  }
  if (settled.some((item) => item.status === 'failed')) return 'failed';
  const [first] = settled;
  return first === undefined || first.status === 'pending' ? 'stale' : first.status;
};

export const changeProposalGroupOpen = (
  group: Pick<ChangeProposalGroup, 'createdAt'>,
  items: readonly Pick<ChangeProposal, 'status' | 'expiresAt'>[],
  now: string,
): boolean => changeProposalGroupStatus(group, items, now) === 'open';

export const changeProposalGroupConflict = (
  group: Pick<ChangeProposalGroup, 'id' | 'createdAt'>,
  items: readonly Pick<ChangeProposal, 'id' | 'status' | 'expiresAt'>[],
  now: string,
  message = 'This change proposal group is no longer open',
): AppError => appError('conflict', message, {
  changeProposalGroupStatus: changeProposalGroupStatus(group, items, now),
  changeProposalStatuses: items.map((item) => ({ id: item.id, status: changeProposalDisplayStatus(item, now) })),
});

export const groupedChangeProposalDecisionRefused = (proposal: Pick<ChangeProposal, 'groupId'>): AppError =>
  appError(
    'conflict',
    'This change proposal belongs to a group; approve, reject or withdraw it with the whole group',
    { changeProposalGroupId: proposal.groupId },
  );

export const changeProposalGroupItemNote = (offending: Pick<ChangeProposal, 'id' | 'groupPosition'>): string =>
  `Not applied: item ${String(offending.groupPosition ?? 0)} (${offending.id}) of this group could not be applied, so nothing in the group was changed`;

export type ChangeProposalReferenceKind = 'product' | 'price' | 'sales-link';

const CHANGE_PROPOSAL_REFERENCE_PREFIX = '$proposal:';

const REFERENCE_LIKE_PREFIX = '$proposal';

const referenceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export const changeProposalReference = (proposalId: string): string => `${CHANGE_PROPOSAL_REFERENCE_PREFIX}${proposalId}`;

export const isChangeProposalReference = (value: string): boolean => value.startsWith(CHANGE_PROPOSAL_REFERENCE_PREFIX);

const referencedProposalId = (value: string): string | null => {
  if (!value.startsWith(CHANGE_PROPOSAL_REFERENCE_PREFIX)) return null;
  const id = value.slice(CHANGE_PROPOSAL_REFERENCE_PREFIX.length);
  return referenceIdPattern.test(id) ? id : null;
};

interface ReferencePosition {
  field: string;
  list: boolean;
  kind: ChangeProposalReferenceKind;
}

const productId = (field: string): ReferencePosition => ({ field, list: false, kind: 'product' });

const REFERENCE_POSITIONS: Readonly<Record<ChangeProposalOperation, readonly ReferencePosition[]>> = {
  'product.create': [],
  'product.update': [productId('id')],
  'product.publish': [productId('id')],
  'product.unpublish': [productId('id')],
  'product.delete-draft': [productId('productId')],
  'price.create': [productId('productId')],
  'price.deactivate': [{ field: 'id', list: false, kind: 'price' }],
  'stock.enable': [productId('productId')],
  'stock.adjust': [productId('productId')],
  'stock.set-threshold': [productId('productId')],
  'sales-link.create': [{ field: 'productIds', list: true, kind: 'product' }],
  'sales-link.update': [{ field: 'id', list: false, kind: 'sales-link' }, { field: 'productIds', list: true, kind: 'product' }],
  'sales-link.delete': [{ field: 'id', list: false, kind: 'sales-link' }],
  'settings.update': [],
};

const CREATED_KIND: Readonly<Partial<Record<ChangeProposalOperation, ChangeProposalReferenceKind>>> = {
  'product.create': 'product',
  'price.create': 'price',
  'sales-link.create': 'sales-link',
};

export const changeProposalCreatedKind = (operation: string): ChangeProposalReferenceKind | null => {
  const known = knownChangeProposalOperation(operation);
  return known === null ? null : CREATED_KIND[known] ?? null;
};

interface ReferenceUse {
  proposalId: string;
  kind: ChangeProposalReferenceKind;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type InputPath = ReadonlyArray<string | number>;

const pathKey = (path: InputPath): string => JSON.stringify(path);

const pathLabel = (path: InputPath): string => path.map(String).join('.');

const positionPaths = (operation: ChangeProposalOperation, input: Record<string, unknown>): Map<string, ChangeProposalReferenceKind> => {
  const paths = new Map<string, ChangeProposalReferenceKind>();
  for (const position of REFERENCE_POSITIONS[operation]) {
    const value = input[position.field];
    if (!position.list) {
      paths.set(pathKey([position.field]), position.kind);
      continue;
    }
    if (Array.isArray(value)) value.forEach((_entry, index) => paths.set(pathKey([position.field, index]), position.kind));
  }
  return paths;
};

const referenceLikeStrings = (value: unknown, path: InputPath, found: Array<{ path: InputPath; value: string }>): void => {
  if (typeof value === 'string') {
    if (value.startsWith(REFERENCE_LIKE_PREFIX)) found.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => referenceLikeStrings(entry, [...path, index], found));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) referenceLikeStrings(entry, [...path, key], found);
  }
};

const referenceRefused = (message: string): Result<never, AppError> => err(validation(message));

const referenceUses = (operation: ChangeProposalOperation, input: unknown): Result<ReferenceUse[], AppError> => {
  if (!isRecord(input)) return ok([]);
  const positions = positionPaths(operation, input);
  const found: Array<{ path: InputPath; value: string }> = [];
  referenceLikeStrings(input, [], found);
  const uses: ReferenceUse[] = [];
  for (const { path, value } of found) {
    const kind = positions.get(pathKey(path));
    if (kind === undefined) {
      return referenceRefused(`"${pathLabel(path)}" cannot hold a proposal reference; a reference stands only where ${operation} takes the id of a product, price or sales link`);
    }
    const proposalId = referencedProposalId(value);
    if (proposalId === null) return referenceRefused(`"${pathLabel(path)}" is not a valid proposal reference; write ${CHANGE_PROPOSAL_REFERENCE_PREFIX}<proposal id>`);
    uses.push({ proposalId, kind });
  }
  return ok(uses);
};

export const checkChangeProposalReferences = (
  operation: ChangeProposalOperation,
  input: unknown,
  earlierItems: readonly Pick<ChangeProposal, 'id' | 'operation'>[],
): Result<void, AppError> => {
  const uses = referenceUses(operation, input);
  if (!uses.ok) return uses;
  for (const use of uses.value) {
    const earlier = earlierItems.find((item) => item.id === use.proposalId);
    if (earlier === undefined) {
      return referenceRefused(`${changeProposalReference(use.proposalId)} names no earlier proposal of this group`);
    }
    const created = changeProposalCreatedKind(earlier.operation);
    if (created !== use.kind) {
      return referenceRefused(`${changeProposalReference(use.proposalId)} does not create a ${use.kind}, so it cannot stand where a ${use.kind} id is expected`);
    }
  }
  return ok(undefined);
};

export const resolveChangeProposalReferences = (
  operation: ChangeProposalOperation,
  input: ChangeProposalInput,
  createdIdOf: (proposalId: string) => string | null,
): ChangeProposalInput | null => {
  let unresolved = false;
  const resolve = (value: string): string => {
    const proposalId = referencedProposalId(value);
    if (proposalId === null) return value;
    const resolved = createdIdOf(proposalId);
    if (resolved === null) unresolved = true;
    return resolved ?? value;
  };
  const resolved: ChangeProposalInput = { ...input };
  for (const position of REFERENCE_POSITIONS[operation]) {
    const value = input[position.field];
    if (typeof value === 'string' && !position.list) resolved[position.field] = resolve(value);
    if (Array.isArray(value) && position.list) resolved[position.field] = value.map((entry) => typeof entry === 'string' ? resolve(entry) : entry);
  }
  return unresolved ? null : resolved;
};

type JsonValue = ChangeProposalInput[string];

const mapJsonStrings = (value: JsonValue, replace: (text: string) => string): JsonValue => {
  if (typeof value === 'string') return replace(value);
  if (Array.isArray(value)) return value.map((entry) => mapJsonStrings(entry, replace));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapJsonStrings(entry, replace)]));
  }
  return value;
};

export const mapChangeProposalSnapshotStrings = (
  snapshot: ChangeProposalInput,
  replace: (text: string) => string,
): ChangeProposalInput =>
  Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, mapJsonStrings(value, replace)]));

const groupProposerSchema = z.object({
  keyId: z.string(),
  keyName: z.string().nullable(),
  issuerUserId: z.string().nullable(),
  issuerEmail: z.string().nullable(),
  issuerIsVerifiedOwner: z.boolean(),
  keyState: changeProposalKeyStateSchema,
}).strict();

export type ChangeProposalGroupProposer = Omit<z.output<typeof groupProposerSchema>, 'keyId'>;

export const changeProposalGroupOwnerViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: changeProposalGroupStatusSchema,
  proposedBy: groupProposerSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  items: z.array(changeProposalOwnerDetailSchema),
}).strict();

export type ChangeProposalGroupOwnerView = z.output<typeof changeProposalGroupOwnerViewSchema>;

export const changeProposalGroupKeyReceiptSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: changeProposalGroupStatusSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  items: z.array(changeProposalKeyReceiptSchema),
}).strict();

export type ChangeProposalGroupKeyReceipt = z.output<typeof changeProposalGroupKeyReceiptSchema>;

export const toChangeProposalGroupKeyReceipt = (
  group: ChangeProposalGroup,
  items: readonly ChangeProposal[],
  receipts: readonly ChangeProposalKeyReceipt[],
  now: string,
): ChangeProposalGroupKeyReceipt => ({
  id: group.id,
  title: group.title,
  status: changeProposalGroupStatus(group, items, now),
  createdAt: group.createdAt,
  expiresAt: changeProposalGroupExpiresAt(group, items),
  items: [...receipts],
});

export const toChangeProposalGroupOwnerView = (
  group: ChangeProposalGroup,
  items: readonly ChangeProposal[],
  proposer: ChangeProposalGroupProposer,
  details: readonly ChangeProposalOwnerDetail[],
  now: string,
): ChangeProposalGroupOwnerView => ({
  id: group.id,
  title: group.title,
  status: changeProposalGroupStatus(group, items, now),
  proposedBy: { keyId: group.proposedByKeyId, ...proposer },
  createdAt: group.createdAt,
  expiresAt: changeProposalGroupExpiresAt(group, items),
  items: [...details],
});
