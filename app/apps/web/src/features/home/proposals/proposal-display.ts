import {
  changeProposalCreatedKind,
  isChangeProposalReference,
  type ChangeProposalOwnerView,
  type ChangeProposalReferenceKind,
} from '#core/domain/index.js';

type JsonValue = ChangeProposalOwnerView['input'][string];

type Side = 'before' | 'after';

export type DisplayValue =
  | { kind: 'empty' }
  | { kind: 'text'; text: string; long: boolean; breakAnywhere: boolean }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'money'; amountCents: number; currency: string | null }
  | { kind: 'enum'; field: string; value: string | number }
  | {
    kind: 'price';
    amountCents: number;
    currency: string;
    interval: PriceInterval | null;
    intervalCount: number;
    active: boolean | null;
  }
  | { kind: 'date'; iso: string }
  | { kind: 'image'; path: string }
  | { kind: 'reference'; thing: ChangeProposalReferenceKind | 'item'; position: number; label: string | null }
  | { kind: 'file'; fileName: string; sizeBytes: number | null }
  | { kind: 'list'; items: DisplayValue[] }
  | { kind: 'record'; entries: DisplayEntry[] };

interface DisplayEntry {
  field: string;
  value: DisplayValue;
}

export type PriceInterval = 'day' | 'week' | 'month' | 'year';

export type DisplayRow =
  | { kind: 'change'; field: string; before: DisplayValue | null; after: DisplayValue | null }
  | { kind: 'delta'; field: string; delta: number };

export interface GroupItemReference {
  thing: ChangeProposalReferenceKind | 'item';
  position: number;
  label: string | null;
}

export type GroupReferences = ReadonlyMap<string, GroupItemReference>;

const NO_REFERENCES: GroupReferences = new Map();

const LONG_TEXT_LENGTH = 280;

const REFERENCE_PREFIX_LENGTH = '$proposal:'.length;

const HIDDEN_FIELDS = new Set(['exists', 'revision']);

const MONEY_FIELDS = new Set(['priceCents', 'amountCents']);

const IMAGE_FIELDS = new Set(['coverUrl', 'logoUrl', 'logoDarkUrl', 'faviconUrl', 'ogImageUrl']);

const ENUM_FIELDS = new Set([
  'type', 'visibility', 'salesChannel', 'deliveryMethod', 'parcelTemplate', 'kind', 'interval', 'vatRate',
  'invoiceVatMode', 'invoiceVatRatePercent', 'invoiceExemptionBasisKind', 'invoicingProvider', 'ksefSubmissionMode',
  'autoIssueInvoiceScope', 'defaultLanguage',
]);

const FIELD_ORDER = [
  'title', 'name', 'heading', 'type', 'description', 'slug', 'priceCents', 'amountCents', 'currency', 'kind', 'interval',
  'activePrices', 'prices', 'published', 'active', 'listed', 'visibility', 'productIds', 'validFrom', 'validTo',
  'tracked', 'onHand', 'reserved', 'lowStockThreshold', 'coverUrl',
];

const PUBLIC_ASSET_PATH = /^\/api\/public\/assets(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const isSameOriginPublicAssetPath = (value: string): boolean => PUBLIC_ASSET_PATH.test(value);

const stringField = (record: { [key: string]: JsonValue }, field: string): string | null => {
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const numberField = (record: { [key: string]: JsonValue }, field: string): number | null => {
  const value = record[field];
  return typeof value === 'number' ? value : null;
};

const intervalOf = (value: JsonValue | undefined): PriceInterval | null =>
  value === 'day' || value === 'week' || value === 'month' || value === 'year' ? value : null;

interface ValueContext {
  references: GroupReferences;
  currency: string | null;
}

export type PriceDisplay = Extract<DisplayValue, { kind: 'price' }>;

export const priceOf = (record: { [key: string]: JsonValue }): PriceDisplay | null => {
  const amountCents = numberField(record, 'amountCents');
  const currency = stringField(record, 'currency');
  if (amountCents === null || currency === null) return null;
  const active = record['active'];
  return {
    kind: 'price',
    amountCents,
    currency,
    interval: record['kind'] === 'recurring' ? intervalOf(record['interval']) : null,
    intervalCount: numberField(record, 'intervalCount') ?? 1,
    active: typeof active === 'boolean' ? active : null,
  };
};

const fileOf = (record: { [key: string]: JsonValue }): DisplayValue | null => {
  const fileName = stringField(record, 'fileName');
  return fileName === null ? null : { kind: 'file', fileName, sizeBytes: numberField(record, 'sizeBytes') };
};

const referenceOf = (value: string, references: GroupReferences): DisplayValue | null => {
  if (!isChangeProposalReference(value)) return null;
  const item = references.get(value.slice(REFERENCE_PREFIX_LENGTH));
  return item === undefined ? null : { kind: 'reference', ...item };
};

const stringValue = (field: string, value: string, context: ValueContext): DisplayValue => {
  if (value.length === 0) return { kind: 'empty' };
  const reference = referenceOf(value, context.references);
  if (reference !== null) return reference;
  if (IMAGE_FIELDS.has(field) && isSameOriginPublicAssetPath(value)) return { kind: 'image', path: value };
  if (ENUM_FIELDS.has(field)) return { kind: 'enum', field, value };
  if (ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))) return { kind: 'date', iso: value };
  const breakAnywhere = !/\s/.test(value);
  return { kind: 'text', text: value, long: value.length > LONG_TEXT_LENGTH || value.includes('\n'), breakAnywhere };
};

const displayValue = (field: string, value: JsonValue | undefined, context: ValueContext): DisplayValue => {
  if (value === undefined || value === null) return { kind: 'empty' };
  if (typeof value === 'string') return stringValue(field, value, context);
  if (typeof value === 'number') {
    if (MONEY_FIELDS.has(field)) return { kind: 'money', amountCents: value, currency: context.currency };
    return ENUM_FIELDS.has(field) ? { kind: 'enum', field, value } : { kind: 'number', value };
  }
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (Array.isArray(value)) {
    return value.length === 0 ? { kind: 'empty' } : { kind: 'list', items: value.map((entry) => displayValue(field, entry, context)) };
  }
  const special = priceOf(value) ?? fileOf(value);
  if (special !== null) return special;
  const keys = Object.keys(value);
  const shown = keys.length > 1 ? keys.filter((key) => key !== 'id') : keys;
  if (shown.length === 0) return { kind: 'empty' };
  return {
    kind: 'record',
    entries: shown.map((key) => ({
      field: key,
      value: displayValue(key, value[key], { ...context, currency: stringField(value, 'currency') ?? context.currency }),
    })),
  };
};

const fieldRank = (field: string): number => {
  const rank = FIELD_ORDER.indexOf(field);
  return rank === -1 ? FIELD_ORDER.length : rank;
};

const currencyOn = (proposal: Pick<ChangeProposalOwnerView, 'effect' | 'input'>, side: Side): string | null => {
  const change = proposal.effect['currency'];
  if (change !== undefined && 'before' in change && typeof change[side] === 'string') return change[side];
  const input = proposal.input['currency'];
  return typeof input === 'string' ? input : null;
};

const existenceChange = (proposal: Pick<ChangeProposalOwnerView, 'effect'>): 'created' | 'removed' | null => {
  const change = proposal.effect['exists'];
  if (change === undefined || !('before' in change)) return null;
  if (change.before === false && change.after === true) return 'created';
  if (change.before === true && change.after === false) return 'removed';
  return null;
};

export const proposalRemovesRecord = (proposal: Pick<ChangeProposalOwnerView, 'effect'>): boolean =>
  existenceChange(proposal) === 'removed';

export const proposalCreatesRecord = (proposal: Pick<ChangeProposalOwnerView, 'effect'>): boolean =>
  existenceChange(proposal) === 'created';

export const proposalRows = (
  proposal: Pick<ChangeProposalOwnerView, 'effect' | 'input'>,
  references: GroupReferences = NO_REFERENCES,
): DisplayRow[] => {
  const existence = existenceChange(proposal);
  const contextOn = (side: Side): ValueContext => ({ references, currency: currencyOn(proposal, side) });
  return Object.entries(proposal.effect)
    .filter(([field]) => !HIDDEN_FIELDS.has(field))
    .sort(([left], [right]) => fieldRank(left) - fieldRank(right))
    .map(([field, change]): DisplayRow => 'delta' in change
      ? { kind: 'delta', field, delta: change.delta }
      : {
          kind: 'change',
          field,
          before: existence === 'created' ? null : displayValue(field, change.before, contextOn('before')),
          after: existence === 'removed' ? null : displayValue(field, change.after, contextOn('after')),
        });
};

export const stockAdjustmentReason = (proposal: Pick<ChangeProposalOwnerView, 'input'>): string | null =>
  stringField(proposal.input, 'reason');

const itemLabel = (item: Pick<ChangeProposalOwnerView, 'input' | 'targetLabel'>): string | null =>
  stringField(item.input, 'title') ?? stringField(item.input, 'heading') ?? item.targetLabel;

export const groupReferences = (
  items: readonly Pick<ChangeProposalOwnerView, 'id' | 'operation' | 'input' | 'targetLabel' | 'groupPosition'>[],
): GroupReferences => new Map(items.map((item, index) => [item.id, {
  thing: changeProposalCreatedKind(item.operation) ?? 'item',
  position: item.groupPosition ?? index + 1,
  label: itemLabel(item),
}]));

export type TargetDisplay =
  | { kind: 'reference'; reference: GroupItemReference }
  | { kind: 'label'; label: string }
  | { kind: 'pending'; label: string | null }
  | { kind: 'gone' };

export type TargetFacts = Pick<ChangeProposalOwnerView, 'target' | 'targetLabel' | 'input' | 'appliedResourceId'>;

export const proposalTarget = (proposal: TargetFacts, references: GroupReferences = NO_REFERENCES): TargetDisplay => {
  const { id } = proposal.target;
  const reference = id !== null && isChangeProposalReference(id);
  if (reference) {
    const item = references.get(id.slice(REFERENCE_PREFIX_LENGTH));
    if (item !== undefined) return { kind: 'reference', reference: item };
  }
  if (proposal.targetLabel !== null) return { kind: 'label', label: proposal.targetLabel };
  const created = id === null && proposal.appliedResourceId !== null;
  if ((id !== null && !reference) || created) return { kind: 'gone' };
  return { kind: 'pending', label: itemLabel({ input: proposal.input, targetLabel: null }) };
};

const isStockAdjustment = (proposal: Pick<ChangeProposalOwnerView, 'operation'>): boolean =>
  proposal.operation === 'stock.adjust';

export const stockAdjustmentProductId = (proposal: Pick<ChangeProposalOwnerView, 'operation' | 'input'>): string | null => {
  if (!isStockAdjustment(proposal)) return null;
  const productId = stringField(proposal.input, 'productId');
  return productId === null || isChangeProposalReference(productId) ? null : productId;
};
