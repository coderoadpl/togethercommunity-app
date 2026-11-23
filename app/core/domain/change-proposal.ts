import { z } from 'zod';

import type { Capability } from './authorization.js';
import { priceIntervalSchema, priceKindSchema } from './commerce.js';
import { appError, type AppError } from './errors.js';
import type { ShopManagementKey } from './shop-management-key.js';

const changeProposalTargetKindSchema = z.enum(['product', 'price', 'sales-link', 'settings']);

export type ChangeProposalTargetKind = z.output<typeof changeProposalTargetKindSchema>;

export type ChangeProposalFamily = 'catalog' | 'settings';

interface ChangeProposalOperationDefinition {
  operation: string;
  family: ChangeProposalFamily;
  targetKind: ChangeProposalTargetKind;
}

const CHANGE_PROPOSAL_OPERATION_DEFINITIONS = [
  { operation: 'product.create', family: 'catalog', targetKind: 'product' },
  { operation: 'product.update', family: 'catalog', targetKind: 'product' },
  { operation: 'product.publish', family: 'catalog', targetKind: 'product' },
  { operation: 'product.unpublish', family: 'catalog', targetKind: 'product' },
  { operation: 'product.delete-draft', family: 'catalog', targetKind: 'product' },
  { operation: 'price.create', family: 'catalog', targetKind: 'product' },
  { operation: 'price.deactivate', family: 'catalog', targetKind: 'price' },
  { operation: 'stock.enable', family: 'catalog', targetKind: 'product' },
  { operation: 'stock.adjust', family: 'catalog', targetKind: 'product' },
  { operation: 'stock.set-threshold', family: 'catalog', targetKind: 'product' },
  { operation: 'sales-link.create', family: 'catalog', targetKind: 'sales-link' },
  { operation: 'sales-link.update', family: 'catalog', targetKind: 'sales-link' },
  { operation: 'sales-link.delete', family: 'catalog', targetKind: 'sales-link' },
  { operation: 'settings.update', family: 'settings', targetKind: 'settings' },
  { operation: 'product.set-access', family: 'catalog', targetKind: 'product' },
] as const satisfies readonly ChangeProposalOperationDefinition[];

const CHANGE_PROPOSAL_FILE_OPERATION_DEFINITIONS = [
  { operation: 'download.add', family: 'catalog', targetKind: 'product' },
  { operation: 'download.replace', family: 'catalog', targetKind: 'product' },
  { operation: 'download.remove', family: 'catalog', targetKind: 'product' },
] as const satisfies readonly ChangeProposalOperationDefinition[];

const REGISTERED_OPERATION_DEFINITIONS: readonly ChangeProposalOperationDefinition[] = [
  ...CHANGE_PROPOSAL_OPERATION_DEFINITIONS,
  ...CHANGE_PROPOSAL_FILE_OPERATION_DEFINITIONS,
];

type ChangeProposalOperationName = (typeof CHANGE_PROPOSAL_OPERATION_DEFINITIONS)[number]['operation'];

type ChangeProposalFileOperationName = (typeof CHANGE_PROPOSAL_FILE_OPERATION_DEFINITIONS)[number]['operation'];

const nonEmpty = <T extends string>(values: readonly T[]): [T, ...T[]] => {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error('A change proposal enumeration needs at least one value');
  return [first, ...rest];
};

export const changeProposalOperationSchema = z.enum(
  nonEmpty<ChangeProposalOperationName>(CHANGE_PROPOSAL_OPERATION_DEFINITIONS.map((definition) => definition.operation)),
);

export type ChangeProposalOperation = z.output<typeof changeProposalOperationSchema>;

const changeProposalFileOperationSchema = z.enum(
  nonEmpty<ChangeProposalFileOperationName>(CHANGE_PROPOSAL_FILE_OPERATION_DEFINITIONS.map((definition) => definition.operation)),
);

/**
 * Every operation the registry of this release applies, which the owner panel and the CLI display and approve.
 * `changeProposalOperationSchema` leaves out the three file operations: each needs a staged file or a ready product
 * file before it can be proposed, so a table that proposes every operation of that list runs without one.
 */
export const registeredChangeProposalOperationSchema = z.enum([
  ...changeProposalOperationSchema.options,
  ...changeProposalFileOperationSchema.options,
]);

export type RegisteredChangeProposalOperation = z.output<typeof registeredChangeProposalOperationSchema>;

const CHANGE_PROPOSAL_STORED_OPERATION_MAX_LENGTH = 64;

// The database holds any operation of this shape, so a row written by a later release still reads; only the registry decides what applies.
const changeProposalStoredOperationSchema = z.string()
  .max(CHANGE_PROPOSAL_STORED_OPERATION_MAX_LENGTH)
  .regex(/^[a-z]+(-[a-z]+)*[.][a-z]+(-[a-z]+)*$/);

export const registeredChangeProposalOperation = (operation: string): RegisteredChangeProposalOperation | null => {
  const known = registeredChangeProposalOperationSchema.safeParse(operation);
  return known.success ? known.data : null;
};

export const unknownChangeProposalOperationNote = (operation: string): string =>
  `This release does not know the operation "${operation}", so the proposal cannot be applied; nothing was changed`;

const operationDefinition = (operation: RegisteredChangeProposalOperation): ChangeProposalOperationDefinition => {
  const found = REGISTERED_OPERATION_DEFINITIONS.find((definition) => definition.operation === operation);
  if (found === undefined) throw new Error(`Unknown change proposal operation "${operation}"`);
  return found;
};

const submitCapabilityByFamily: Record<ChangeProposalFamily, Capability> = {
  catalog: 'proposal:submit:catalog',
  settings: 'proposal:submit:settings',
};

export const changeProposalFamily = (operation: RegisteredChangeProposalOperation): ChangeProposalFamily =>
  operationDefinition(operation).family;

export const changeProposalTargetKind = (operation: RegisteredChangeProposalOperation): ChangeProposalTargetKind =>
  operationDefinition(operation).targetKind;

export const changeProposalSubmitCapability = (operation: RegisteredChangeProposalOperation): Capability =>
  submitCapabilityByFamily[changeProposalFamily(operation)];

export const changeProposalStatusSchema = z.enum(['pending', 'applied', 'rejected', 'stale', 'withdrawn', 'failed']);

export type ChangeProposalStatus = z.output<typeof changeProposalStatusSchema>;

export type ChangeProposalTerminalStatus = Exclude<ChangeProposalStatus, 'pending'>;

const changeProposalDisplayStatusSchema = z.enum([...changeProposalStatusSchema.options, 'expired']);

export type ChangeProposalDisplayStatus = z.output<typeof changeProposalDisplayStatusSchema>;

export const CHANGE_PROPOSAL_DECIDED_FILTER = 'decided';

export const changeProposalListStatusSchema = z.enum([...changeProposalDisplayStatusSchema.options, CHANGE_PROPOSAL_DECIDED_FILTER]);

export type ChangeProposalListStatus = z.output<typeof changeProposalListStatusSchema>;

const changeProposalEventKindSchema = z.enum([
  'proposed',
  'applied',
  'rejected',
  'stale',
  'withdrawn',
  'expired',
  'apply_failed',
]);

export type ChangeProposalEventKind = z.output<typeof changeProposalEventKindSchema>;

export const CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS: Record<ChangeProposalTerminalStatus, ChangeProposalEventKind> = {
  applied: 'applied',
  rejected: 'rejected',
  stale: 'stale',
  withdrawn: 'withdrawn',
  failed: 'apply_failed',
};

const CHANGE_PROPOSAL_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export const CHANGE_PROPOSAL_LIMITS = {
  pendingPerKey: 200,
  pendingPerWorkspace: 1_000,
  createdPerKeyPerWindow: 500,
  creationWindowMs: 24 * 60 * 60 * 1000,
  effectMaxBytes: 1_280 * 1024,
  decisionNoteMaxLength: 500,
  groupTitleMaxLength: 500,
  eventNoteMaxLength: 500,
  keyNameMaxLength: 120,
  identifierMaxLength: 200,
  failureCodeMaxLength: 64,
  failureMessageMaxLength: 2_000,
} as const;

export const CHANGE_PROPOSAL_WITHDRAWAL_NOTES = {
  keyRevoked: 'key_revoked',
  keyPurged: 'key_purged',
} as const;

export type ChangeProposalCap = 'key_pending' | 'workspace_pending' | 'key_daily' | 'effect_size';

export type ChangeProposalCountCap = Exclude<ChangeProposalCap, 'effect_size'>;

const capMessages: Record<ChangeProposalCap, string> = {
  key_pending: `This key already has ${String(CHANGE_PROPOSAL_LIMITS.pendingPerKey)} pending proposals`,
  workspace_pending: `This workspace already has ${String(CHANGE_PROPOSAL_LIMITS.pendingPerWorkspace)} pending proposals`,
  key_daily: `This key created ${String(CHANGE_PROPOSAL_LIMITS.createdPerKeyPerWindow)} proposals in the last 24 hours`,
  effect_size: `The proposed change is larger than ${String(CHANGE_PROPOSAL_LIMITS.effectMaxBytes)} bytes`,
};

export const changeProposalCapExceeded = (cap: ChangeProposalCap): AppError =>
  appError('conflict', capMessages[cap], { changeProposalCap: cap });

const CHANGE_PROPOSALS_BUSY_RETRY_AFTER_SECONDS = 5;

export const changeProposalsBusy = (): AppError =>
  appError('unavailable', 'Change proposals of this workspace are busy; nothing was changed, retry the request', {
    retryAfterSeconds: CHANGE_PROPOSALS_BUSY_RETRY_AFTER_SECONDS,
  });

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

export const changeProposalInputSchema = z.record(z.string(), jsonValueSchema);

export type ChangeProposalInput = z.output<typeof changeProposalInputSchema>;

const changeProposalFieldChangeSchema = z.object({ before: jsonValueSchema, after: jsonValueSchema }).strict();

const changeProposalDeltaChangeSchema = z.object({ delta: z.number().int() }).strict();

const changeProposalEffectSchema = z.record(
  z.string().min(1),
  z.union([changeProposalFieldChangeSchema, changeProposalDeltaChangeSchema]),
);

export type ChangeProposalEffect = z.output<typeof changeProposalEffectSchema>;

const changeProposalEffectBytes = (effect: ChangeProposalEffect): number =>
  new TextEncoder().encode(JSON.stringify(effect)).length;

export const changeProposalEffectWithinLimit = (effect: ChangeProposalEffect): boolean =>
  changeProposalEffectBytes(effect) <= CHANGE_PROPOSAL_LIMITS.effectMaxBytes;

export const changeProposalTimestampSchema = z.string().datetime({ precision: 3 });

export const changeProposalIdentifierSchema = z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.identifierMaxLength);

const changeProposalTargetSchema = z.object({
  kind: changeProposalTargetKindSchema,
  id: changeProposalIdentifierSchema.nullable(),
}).strict();

export type ChangeProposalTarget = z.output<typeof changeProposalTargetSchema>;

export const changeProposalSchema = z.object({
  id: changeProposalIdentifierSchema,
  tenantId: z.string().min(1),
  groupId: changeProposalIdentifierSchema.nullable(),
  groupPosition: z.number().int().min(1).nullable(),
  operation: changeProposalStoredOperationSchema,
  input: changeProposalInputSchema,
  effect: changeProposalEffectSchema,
  target: changeProposalTargetSchema,
  status: changeProposalStatusSchema,
  proposedByKeyId: changeProposalIdentifierSchema,
  proposedByKeyName: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.keyNameMaxLength),
  proposedByIssuerUserId: z.string().min(1),
  createdAt: changeProposalTimestampSchema,
  expiresAt: changeProposalTimestampSchema,
  decidedByUserId: z.string().min(1).nullable(),
  decidedAt: changeProposalTimestampSchema.nullable(),
  decisionNote: z.string().max(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength).nullable(),
  appliedResourceId: changeProposalIdentifierSchema.nullable(),
  failureCode: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.failureCodeMaxLength).nullable(),
  failureMessage: z.string().max(CHANGE_PROPOSAL_LIMITS.failureMessageMaxLength).nullable(),
}).strict().superRefine((proposal, context) => {
  if ((proposal.groupId === null) !== (proposal.groupPosition === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['groupPosition'], message: 'A group position needs a group and a group needs a position' });
  }
  const expectedKind = REGISTERED_OPERATION_DEFINITIONS.find((definition) => definition.operation === proposal.operation)?.targetKind;
  if (expectedKind !== undefined && proposal.target.kind !== expectedKind) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['target', 'kind'], message: `${proposal.operation} targets a ${String(expectedKind)}` });
  }
});

export type ChangeProposal = z.output<typeof changeProposalSchema>;

export const changeProposalEventSchema = z.object({
  id: changeProposalIdentifierSchema,
  tenantId: z.string().min(1),
  proposalId: changeProposalIdentifierSchema,
  sequence: z.number().int().min(1),
  kind: changeProposalEventKindSchema,
  actorUserId: z.string().min(1).nullable(),
  apiKeyId: changeProposalIdentifierSchema.nullable(),
  note: z.string().max(CHANGE_PROPOSAL_LIMITS.eventNoteMaxLength).nullable(),
  at: changeProposalTimestampSchema,
}).strict().refine(
  (event) => event.actorUserId !== null || event.apiKeyId !== null,
  { message: 'A change proposal event needs an acting account or key', path: ['actorUserId'] },
);

export type ChangeProposalEvent = z.output<typeof changeProposalEventSchema>;

export const changeProposalExpired = (proposal: Pick<ChangeProposal, 'status' | 'expiresAt'>, now: string): boolean =>
  proposal.status === 'pending' && Date.parse(proposal.expiresAt) <= Date.parse(now);

export const changeProposalDisplayStatus = (
  proposal: Pick<ChangeProposal, 'status' | 'expiresAt'>,
  now: string,
): ChangeProposalDisplayStatus => changeProposalExpired(proposal, now) ? 'expired' : proposal.status;

export const changeProposalExpiresAt = (createdAt: string): string =>
  new Date(Date.parse(createdAt) + CHANGE_PROPOSAL_LIFETIME_MS).toISOString();

export const changeProposalLifetimeStart = (now: string): string =>
  new Date(Date.parse(now) - CHANGE_PROPOSAL_LIFETIME_MS).toISOString();

export const changeProposalKeyStateSchema = z.enum(['active', 'expired', 'revoked', 'purged']);

export type ChangeProposalKeyState = z.output<typeof changeProposalKeyStateSchema>;

export const changeProposalKeyState = (
  key: Pick<ShopManagementKey, 'revokedAt' | 'expiresAt'> | null,
  now: string,
): ChangeProposalKeyState => {
  if (key === null) return 'purged';
  if (key.revokedAt !== null) return 'revoked';
  return Date.parse(key.expiresAt) <= Date.parse(now) ? 'expired' : 'active';
};

const changeProposalEventViewSchema = z.object({
  sequence: z.number().int().min(1),
  kind: changeProposalEventKindSchema,
  actorUserId: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  note: z.string().nullable(),
  at: z.string(),
}).strict();

export type ChangeProposalEventView = z.output<typeof changeProposalEventViewSchema>;

const changeProposalIssuerSchema = z.object({
  issuerUserId: z.string(),
  issuerEmail: z.string().nullable(),
  issuerIsVerifiedOwner: z.boolean(),
  issuerIsFormerTeamMember: z.boolean(),
}).strict();

export const changeProposalTargetPriceSchema = z.object({
  kind: priceKindSchema,
  interval: priceIntervalSchema.nullable(),
  intervalCount: z.number().int().min(1),
  amountCents: z.number().int().min(0),
  currency: z.string(),
}).strict();

export type ChangeProposalTargetPrice = z.output<typeof changeProposalTargetPriceSchema>;

type ChangeProposalIssuer = z.output<typeof changeProposalIssuerSchema>;

const changeProposalProposedFileSchema = z.object({
  id: z.string(),
  available: z.boolean(),
  copiedFrom: z.object({
    productId: z.string(),
    productTitle: z.string().nullable(),
    versionNumber: z.number().int(),
  }).strict().nullable(),
}).strict();

export type ChangeProposalProposedFile = z.output<typeof changeProposalProposedFileSchema>;

/** A null title marks an id that no longer names a course, module or lesson of the workspace. */
const changeProposalAccessLabelSchema = z.object({ id: z.string(), title: z.string().nullable() }).strict();

const changeProposalAccessLabelsSchema = z.object({
  courses: z.array(changeProposalAccessLabelSchema),
  modules: z.array(changeProposalAccessLabelSchema),
  lessons: z.array(changeProposalAccessLabelSchema),
}).strict();

export type ChangeProposalAccessLabels = z.output<typeof changeProposalAccessLabelsSchema>;

export const changeProposalOwnerViewSchema = z.object({
  id: z.string(),
  groupId: z.string().nullable(),
  groupTitle: z.string().nullable(),
  groupPosition: z.number().int().nullable(),
  operation: changeProposalStoredOperationSchema,
  target: changeProposalTargetSchema,
  targetLabel: z.string().nullable(),
  targetPrice: changeProposalTargetPriceSchema.nullable(),
  input: changeProposalInputSchema,
  effect: changeProposalEffectSchema,
  status: changeProposalDisplayStatusSchema,
  proposedBy: z.object({
    keyId: z.string(),
    keyName: z.string(),
    keyState: changeProposalKeyStateSchema,
  }).merge(changeProposalIssuerSchema).strict(),
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedByUserId: z.string().nullable(),
  decidedByEmail: z.string().nullable(),
  decidedByIsFormerTeamMember: z.boolean(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  appliedResourceId: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  proposedFiles: z.array(changeProposalProposedFileSchema).optional(),
  accessLabels: changeProposalAccessLabelsSchema.optional(),
}).strict();

export type ChangeProposalOwnerView = z.output<typeof changeProposalOwnerViewSchema>;

export const changeProposalOwnerDetailSchema = changeProposalOwnerViewSchema.extend({
  events: z.array(changeProposalEventViewSchema),
}).strict();

export type ChangeProposalOwnerDetail = z.output<typeof changeProposalOwnerDetailSchema>;

export const changeProposalKeyReceiptSchema = z.object({
  id: z.string(),
  status: changeProposalDisplayStatusSchema,
  operation: changeProposalStoredOperationSchema,
  target: changeProposalTargetSchema,
  groupId: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  input: changeProposalInputSchema,
  decisionNote: z.string().nullable(),
  appliedResourceId: z.string().nullable(),
  failureCode: z.string().nullable(),
}).strict();

export type ChangeProposalKeyReceipt = z.output<typeof changeProposalKeyReceiptSchema>;

export const changeProposalOwnerPageSchema = z.object({
  proposals: z.array(changeProposalOwnerViewSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
}).strict();

export type ChangeProposalOwnerPage = z.output<typeof changeProposalOwnerPageSchema>;

export const changeProposalSummarySchema = z.object({
  pending: z.number().int().min(0),
  pendingGroups: z.number().int().min(0),
  hasProposals: z.boolean(),
}).strict();

export type ChangeProposalSummary = z.output<typeof changeProposalSummarySchema>;

export const changeProposalKeyReceiptPageSchema = z.object({
  proposals: z.array(changeProposalKeyReceiptSchema),
  nextCursor: z.string().nullable(),
}).strict();

export type ChangeProposalKeyReceiptPage = z.output<typeof changeProposalKeyReceiptPageSchema>;

const CHANGE_PROPOSAL_PAGE_SIZE = { default: 50, max: 100 } as const;

export const changeProposalListInputSchema = z.object({
  status: changeProposalListStatusSchema.optional(),
  cursor: changeProposalIdentifierSchema.optional(),
  groupId: changeProposalIdentifierSchema.optional(),
  limit: z.number().int().min(1).max(CHANGE_PROPOSAL_PAGE_SIZE.max).default(CHANGE_PROPOSAL_PAGE_SIZE.default),
}).strict();

export type ChangeProposalListInput = z.input<typeof changeProposalListInputSchema>;

export const changeProposalIdInputSchema = z.object({ id: changeProposalIdentifierSchema }).strict();

export type ChangeProposalIdInput = z.input<typeof changeProposalIdInputSchema>;

export const changeProposalProductIdInputSchema = z.object({ productId: changeProposalIdentifierSchema }).strict();

export const rejectChangeProposalInputSchema = z.object({
  id: changeProposalIdentifierSchema,
  note: z.string().trim().max(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength).nullable().optional()
    .transform((note) => note === undefined || note === null || note.length === 0 ? null : note),
}).strict();

export type RejectChangeProposalInput = z.input<typeof rejectChangeProposalInputSchema>;

export const submitChangeProposalInputSchema = z.object({
  operation: registeredChangeProposalOperationSchema,
  input: z.unknown(),
}).strict();

export type SubmitChangeProposalInput = z.input<typeof submitChangeProposalInputSchema>;

const toChangeProposalEventView = (event: ChangeProposalEvent): ChangeProposalEventView => ({
  sequence: event.sequence,
  kind: event.kind,
  actorUserId: event.actorUserId,
  apiKeyId: event.apiKeyId,
  note: event.note,
  at: event.at,
});

/** Read at view time: the live label and price are for display only and never take part in a decision. */
export interface ChangeProposalOwnerFacts {
  keyState: ChangeProposalKeyState;
  groupTitle: string | null;
  issuer: Omit<ChangeProposalIssuer, 'issuerUserId'>;
  decidedBy: { email: string | null; formerTeamMember: boolean };
  targetLabel: string | null;
  targetPrice: ChangeProposalTargetPrice | null;
  proposedFiles: ChangeProposalProposedFile[];
  accessLabels: ChangeProposalAccessLabels | null;
}

export const toChangeProposalOwnerView = (
  proposal: ChangeProposal,
  facts: ChangeProposalOwnerFacts,
  now: string,
): ChangeProposalOwnerView => ({
  id: proposal.id,
  groupId: proposal.groupId,
  groupTitle: proposal.groupId === null ? null : facts.groupTitle,
  groupPosition: proposal.groupPosition,
  operation: proposal.operation,
  target: proposal.target,
  targetLabel: facts.targetLabel,
  targetPrice: facts.targetPrice,
  input: proposal.input,
  effect: proposal.effect,
  status: changeProposalDisplayStatus(proposal, now),
  proposedBy: {
    keyId: proposal.proposedByKeyId,
    keyName: proposal.proposedByKeyName,
    keyState: facts.keyState,
    issuerUserId: proposal.proposedByIssuerUserId,
    ...facts.issuer,
  },
  createdAt: proposal.createdAt,
  expiresAt: proposal.expiresAt,
  decidedByUserId: proposal.decidedByUserId,
  decidedByEmail: proposal.decidedByUserId === null ? null : facts.decidedBy.email,
  decidedByIsFormerTeamMember: proposal.decidedByUserId !== null && facts.decidedBy.formerTeamMember,
  decidedAt: proposal.decidedAt,
  decisionNote: proposal.decisionNote,
  appliedResourceId: proposal.appliedResourceId,
  failureCode: proposal.failureCode,
  failureMessage: proposal.failureMessage,
  ...(facts.proposedFiles.length === 0 ? {} : { proposedFiles: facts.proposedFiles }),
  ...(facts.accessLabels === null ? {} : { accessLabels: facts.accessLabels }),
});

export const toChangeProposalOwnerDetail = (
  proposal: ChangeProposal,
  facts: ChangeProposalOwnerFacts,
  events: readonly ChangeProposalEvent[],
  now: string,
): ChangeProposalOwnerDetail => ({
  ...toChangeProposalOwnerView(proposal, facts, now),
  events: events.map(toChangeProposalEventView),
});

export const toChangeProposalKeyReceipt = (proposal: ChangeProposal, now: string): ChangeProposalKeyReceipt => ({
  id: proposal.id,
  status: changeProposalDisplayStatus(proposal, now),
  operation: proposal.operation,
  target: proposal.target,
  groupId: proposal.groupId,
  createdAt: proposal.createdAt,
  expiresAt: proposal.expiresAt,
  input: proposal.input,
  decisionNote: proposal.decisionNote,
  appliedResourceId: proposal.appliedResourceId,
  failureCode: proposal.failureCode,
});
