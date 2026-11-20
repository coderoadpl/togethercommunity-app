import { z } from 'zod';

import type { Capability } from './authorization.js';
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
] as const satisfies readonly ChangeProposalOperationDefinition[];

type ChangeProposalOperationName = (typeof CHANGE_PROPOSAL_OPERATION_DEFINITIONS)[number]['operation'];

const nonEmpty = <T extends string>(values: readonly T[]): [T, ...T[]] => {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error('A change proposal enumeration needs at least one value');
  return [first, ...rest];
};

export const changeProposalOperationSchema = z.enum(
  nonEmpty<ChangeProposalOperationName>(CHANGE_PROPOSAL_OPERATION_DEFINITIONS.map((definition) => definition.operation)),
);

export type ChangeProposalOperation = z.output<typeof changeProposalOperationSchema>;

const operationDefinition = (operation: ChangeProposalOperation): ChangeProposalOperationDefinition => {
  const found = CHANGE_PROPOSAL_OPERATION_DEFINITIONS.find((definition) => definition.operation === operation);
  if (found === undefined) throw new Error(`Unknown change proposal operation "${operation}"`);
  return found;
};

const submitCapabilityByFamily: Record<ChangeProposalFamily, Capability> = {
  catalog: 'proposal:submit:catalog',
  settings: 'proposal:submit:settings',
};

export const changeProposalFamily = (operation: ChangeProposalOperation): ChangeProposalFamily =>
  operationDefinition(operation).family;

export const changeProposalTargetKind = (operation: ChangeProposalOperation): ChangeProposalTargetKind =>
  operationDefinition(operation).targetKind;

export const changeProposalSubmitCapability = (operation: ChangeProposalOperation): Capability =>
  submitCapabilityByFamily[changeProposalFamily(operation)];

export const changeProposalStatusSchema = z.enum(['pending', 'applied', 'rejected', 'stale', 'withdrawn', 'failed']);

export type ChangeProposalStatus = z.output<typeof changeProposalStatusSchema>;

export type ChangeProposalTerminalStatus = Exclude<ChangeProposalStatus, 'pending'>;

export const changeProposalDisplayStatusSchema = z.enum([...changeProposalStatusSchema.options, 'expired']);

export type ChangeProposalDisplayStatus = z.output<typeof changeProposalDisplayStatusSchema>;

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

const timestampSchema = z.string().datetime({ precision: 3 });

const identifierSchema = z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.identifierMaxLength);

const changeProposalTargetSchema = z.object({
  kind: changeProposalTargetKindSchema,
  id: identifierSchema.nullable(),
}).strict();

export type ChangeProposalTarget = z.output<typeof changeProposalTargetSchema>;

export const changeProposalSchema = z.object({
  id: identifierSchema,
  tenantId: z.string().min(1),
  groupId: identifierSchema.nullable(),
  groupPosition: z.number().int().min(1).nullable(),
  operation: changeProposalOperationSchema,
  input: changeProposalInputSchema,
  effect: changeProposalEffectSchema,
  target: changeProposalTargetSchema,
  status: changeProposalStatusSchema,
  proposedByKeyId: identifierSchema,
  proposedByKeyName: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.keyNameMaxLength),
  proposedByIssuerUserId: z.string().min(1),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  decidedByUserId: z.string().min(1).nullable(),
  decidedAt: timestampSchema.nullable(),
  decisionNote: z.string().max(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength).nullable(),
  appliedResourceId: identifierSchema.nullable(),
  failureCode: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.failureCodeMaxLength).nullable(),
  failureMessage: z.string().max(CHANGE_PROPOSAL_LIMITS.failureMessageMaxLength).nullable(),
}).strict().superRefine((proposal, context) => {
  if ((proposal.groupId === null) !== (proposal.groupPosition === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['groupPosition'], message: 'A group position needs a group and a group needs a position' });
  }
  const expectedKind = CHANGE_PROPOSAL_OPERATION_DEFINITIONS.find((definition) => definition.operation === proposal.operation)?.targetKind;
  if (proposal.target.kind !== expectedKind) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['target', 'kind'], message: `${proposal.operation} targets a ${String(expectedKind)}` });
  }
});

export type ChangeProposal = z.output<typeof changeProposalSchema>;

export const changeProposalEventSchema = z.object({
  id: identifierSchema,
  tenantId: z.string().min(1),
  proposalId: identifierSchema,
  sequence: z.number().int().min(1),
  kind: changeProposalEventKindSchema,
  actorUserId: z.string().min(1).nullable(),
  apiKeyId: identifierSchema.nullable(),
  note: z.string().max(CHANGE_PROPOSAL_LIMITS.eventNoteMaxLength).nullable(),
  at: timestampSchema,
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

const changeProposalKeyStateSchema = z.enum(['active', 'expired', 'revoked', 'purged']);

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

export const changeProposalOwnerViewSchema = z.object({
  id: z.string(),
  groupId: z.string().nullable(),
  groupPosition: z.number().int().nullable(),
  operation: changeProposalOperationSchema,
  target: changeProposalTargetSchema,
  input: changeProposalInputSchema,
  effect: changeProposalEffectSchema,
  status: changeProposalDisplayStatusSchema,
  proposedBy: z.object({
    keyId: z.string(),
    keyName: z.string(),
    issuerUserId: z.string(),
    keyState: changeProposalKeyStateSchema,
  }).strict(),
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedByUserId: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  appliedResourceId: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
}).strict();

export type ChangeProposalOwnerView = z.output<typeof changeProposalOwnerViewSchema>;

export const changeProposalOwnerDetailSchema = changeProposalOwnerViewSchema.extend({
  events: z.array(changeProposalEventViewSchema),
}).strict();

export type ChangeProposalOwnerDetail = z.output<typeof changeProposalOwnerDetailSchema>;

export const changeProposalKeyReceiptSchema = z.object({
  id: z.string(),
  status: changeProposalDisplayStatusSchema,
  operation: changeProposalOperationSchema,
  target: changeProposalTargetSchema,
  groupId: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  input: changeProposalInputSchema,
  decisionNote: z.string().nullable(),
  failureCode: z.string().nullable(),
}).strict();

export type ChangeProposalKeyReceipt = z.output<typeof changeProposalKeyReceiptSchema>;

export const changeProposalOwnerPageSchema = z.object({
  proposals: z.array(changeProposalOwnerViewSchema),
  nextCursor: z.string().nullable(),
}).strict();

export type ChangeProposalOwnerPage = z.output<typeof changeProposalOwnerPageSchema>;

export const changeProposalKeyReceiptPageSchema = z.object({
  proposals: z.array(changeProposalKeyReceiptSchema),
  nextCursor: z.string().nullable(),
}).strict();

export type ChangeProposalKeyReceiptPage = z.output<typeof changeProposalKeyReceiptPageSchema>;

const CHANGE_PROPOSAL_PAGE_SIZE = { default: 50, max: 100 } as const;

export const changeProposalListInputSchema = z.object({
  status: changeProposalDisplayStatusSchema.optional(),
  cursor: identifierSchema.optional(),
  limit: z.number().int().min(1).max(CHANGE_PROPOSAL_PAGE_SIZE.max).default(CHANGE_PROPOSAL_PAGE_SIZE.default),
}).strict();

export type ChangeProposalListInput = z.input<typeof changeProposalListInputSchema>;

export const changeProposalIdInputSchema = z.object({ id: identifierSchema }).strict();

export type ChangeProposalIdInput = z.input<typeof changeProposalIdInputSchema>;

export const changeProposalProductIdInputSchema = z.object({ productId: identifierSchema }).strict();

export const rejectChangeProposalInputSchema = z.object({
  id: identifierSchema,
  note: z.string().trim().max(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength).nullable().optional()
    .transform((note) => note === undefined || note === null || note.length === 0 ? null : note),
}).strict();

export type RejectChangeProposalInput = z.input<typeof rejectChangeProposalInputSchema>;

export const submitChangeProposalInputSchema = z.object({
  operation: changeProposalOperationSchema,
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

export const toChangeProposalOwnerView = (
  proposal: ChangeProposal,
  keyState: ChangeProposalKeyState,
  now: string,
): ChangeProposalOwnerView => ({
  id: proposal.id,
  groupId: proposal.groupId,
  groupPosition: proposal.groupPosition,
  operation: proposal.operation,
  target: proposal.target,
  input: proposal.input,
  effect: proposal.effect,
  status: changeProposalDisplayStatus(proposal, now),
  proposedBy: {
    keyId: proposal.proposedByKeyId,
    keyName: proposal.proposedByKeyName,
    issuerUserId: proposal.proposedByIssuerUserId,
    keyState,
  },
  createdAt: proposal.createdAt,
  expiresAt: proposal.expiresAt,
  decidedByUserId: proposal.decidedByUserId,
  decidedAt: proposal.decidedAt,
  decisionNote: proposal.decisionNote,
  appliedResourceId: proposal.appliedResourceId,
  failureCode: proposal.failureCode,
  failureMessage: proposal.failureMessage,
});

export const toChangeProposalOwnerDetail = (
  proposal: ChangeProposal,
  keyState: ChangeProposalKeyState,
  events: readonly ChangeProposalEvent[],
  now: string,
): ChangeProposalOwnerDetail => ({
  ...toChangeProposalOwnerView(proposal, keyState, now),
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
  failureCode: proposal.failureCode,
});
