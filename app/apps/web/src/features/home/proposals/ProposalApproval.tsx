import type { ReactNode } from 'react';
import { Typography } from '@mui/material';

import {
  changeProposalAccessChange,
  changeProposalStagedFileIds,
  registeredChangeProposalOperation,
  type ChangeProposalOwnerView,
  type ChangeProposalProposedFile,
} from '#core/domain/index.js';

import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatFileSize } from '../../../lib/format.js';
import { WrapAnywhereText } from '../../../theme.js';
import {
  priceOf,
  proposalCreatesRecord,
  proposalFileChanges,
  proposalFilesAfter,
  proposalRemovesRecord,
  proposalRows,
  proposalTarget,
  proposedImagePaths,
  type DisplayRow,
  type FileChange,
  type GroupReferences,
  type ProposalFile,
  type TargetDisplay,
} from './proposal-display.js';
import { accessFacts, AccessApprovalText } from './ProposedAccess.js';
import { currentVersionText, Fingerprint } from './ProposedFiles.js';
import { fileTypeLabel, Isolated, operationTitle, priceTerms, Sentence, targetPriceTerms } from './proposal-text.js';

export type ApprovalFacts = Pick<
  ChangeProposalOwnerView,
  'id' | 'operation' | 'target' | 'targetLabel' | 'targetPrice' | 'input' | 'effect' | 'appliedResourceId' | 'proposedFiles' | 'accessLabels'
>;

type CopySource = ChangeProposalProposedFile['copiedFrom'];

type Translations = Messages['changeProposals'];

type Coverage = 'every-row' | readonly string[];

interface ApprovalSentence {
  text: ReactNode;
  names: Coverage;
  closing?: false;
}

const targetName = (target: TargetDisplay): string | null => {
  switch (target.kind) {
    case 'label':
      return target.label;
    case 'pending':
      return target.label;
    case 'reference':
      return target.reference.label;
    case 'gone':
      return null;
  }
};

const numberAfter = (rows: readonly DisplayRow[], field: string): number | null => {
  const row = rows.find((candidate) => candidate.field === field);
  return row?.kind === 'change' && row.after?.kind === 'number' ? row.after.value : null;
};

const unnamedRowCount = (rows: readonly DisplayRow[], names: Coverage): number =>
  names === 'every-row' ? 0 : rows.filter((row) => !names.includes(row.field)).length;

const closingSentence = (t: Translations, rows: readonly DisplayRow[], names: Coverage): string => {
  const count = unnamedRowCount(rows, names);
  if (count === 0) return t.approveNothingElse;
  return names !== 'every-row' && names.length === 0 ? t.approveFieldCount({ count }) : t.approveOtherFields({ count });
};

const CopySentence = ({ source }: { source: CopySource }) => {
  const t = useTranslations().changeProposals;
  if (source === null) return null;
  return (
    <>
      {' '}
      {source.productTitle === null
        ? t.approveFileCopiedFromGone({ version: source.versionNumber })
        : <Isolated sentence={(product) => t.approveFileCopiedFrom({ version: source.versionNumber, product })} value={source.productTitle} />}
    </>
  );
};

const FileApprovalText = ({
  change,
  target,
  copiedFrom,
  newProduct,
  reachesBuyers = true,
}: {
  change: FileChange;
  target: string;
  copiedFrom: CopySource;
  newProduct: boolean;
  reachesBuyers?: boolean;
}) => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  const facts = (file: ProposalFile, fingerprint: string): string => {
    const type = fileTypeLabel(file.contentType);
    const size = formatFileSize(file.sizeBytes, language);
    return file.fingerprint === null ? t.fileFacts({ type, size }) : t.fileFactsWithFingerprint({ type, size, fingerprint });
  };
  const fileName = <bdi>{change.file.fileName}</bdi>;
  const fingerprint = change.file.fingerprint === null ? null : <Fingerprint value={change.file.fingerprint} />;
  const product = <bdi>{target}</bdi>;
  if (!reachesBuyers && change.kind !== 'removed') {
    return (
      <>
        <Sentence
          text={(file, slot, name) => t.approveGroupFileNotKept({ file, facts: facts(change.file, slot), target: name })}
          parts={[fileName, fingerprint, product]}
        />
        <CopySentence source={copiedFrom} />
      </>
    );
  }
  switch (change.kind) {
    case 'added': {
      const add = newProduct ? t.approveFileAddToNewProduct : t.approveFileAdd;
      return (
        <>
          <Sentence
            text={(file, slot, name) => add({ file, facts: facts(change.file, slot), target: name })}
            parts={[fileName, fingerprint, product]}
          />
          <CopySentence source={copiedFrom} />
        </>
      );
    }
    case 'replaced':
      return (
        <>
          {change.file.fileName === change.previous.fileName ? (
            <Sentence
              text={(file, slot, name) => t.approveFileNewVersion({
                file,
                facts: facts(change.file, slot),
                version: change.file.versionNumber,
                target: name,
              })}
              parts={[fileName, fingerprint, product]}
            />
          ) : (
            <Sentence
              text={(file, slot, previous, name) => t.approveFileReplace({
                file,
                facts: facts(change.file, slot),
                version: change.file.versionNumber,
                previous,
                target: name,
              })}
              parts={[fileName, fingerprint, <bdi>{change.previous.fileName}</bdi>, product]}
            />
          )}
          <CopySentence source={copiedFrom} />
        </>
      );
    case 'removed':
      return (
        <>
          <Sentence text={(file, name) => t.approveFileRemove({ file, version: change.file.versionNumber, target: name })} parts={[fileName, product]} />
          {` ${currentVersionText(t, change)}`}
        </>
      );
  }
};

const singleFileChange = (proposal: Pick<ChangeProposalOwnerView, 'effect'>): FileChange | null => {
  const files = proposalFileChanges(proposal);
  const [change] = files?.complete === true && files.changes.length === 1 ? files.changes : [];
  return change ?? null;
};

const copySourceOf = (proposal: Pick<ApprovalFacts, 'proposedFiles'>, change: FileChange): CopySource =>
  proposal.proposedFiles?.find((entry) => entry.id === change.file.id)?.copiedFrom ?? null;

const useApprovalSentence = (proposal: ApprovalFacts, rows: readonly DisplayRow[]): ApprovalSentence => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  const operation = registeredChangeProposalOperation(proposal.operation);
  const fallback: ApprovalSentence = { text: t.approveFallback({ operation: operationTitle(t, proposal.operation) }), names: [] };
  if (operation === null) return fallback;
  if (operation === 'settings.update') return { text: t.approveSettingsChange({ count: rows.length }), names: 'every-row' };
  const name = targetName(proposalTarget(proposal));
  if (name === null) return fallback;
  const named = (build: (target: string) => string, names: Coverage): ApprovalSentence =>
    ({ text: <Isolated sentence={build} value={name} />, names });
  const wholeRecord = (build: (target: string) => string, applies: boolean): ApprovalSentence =>
    named(build, applies ? 'every-row' : []);
  switch (operation) {
    case 'stock.adjust': {
      const delta = rows.find((row) => row.kind === 'delta');
      if (delta?.kind !== 'delta') return fallback;
      const count = Math.abs(delta.delta);
      return named(
        (target) => delta.delta > 0 ? t.approveStockAdded({ target, count }) : t.approveStockRemoved({ target, count }),
        [delta.field],
      );
    }
    case 'product.create':
      return wholeRecord((target) => t.approveProductCreate({ target }), proposalCreatesRecord(proposal));
    case 'product.delete-draft':
      return wholeRecord((target) => t.approveProductDeleteDraft({ target }), proposalRemovesRecord(proposal));
    case 'sales-link.create':
      return wholeRecord((target) => t.approveSalesLinkCreate({ target }), proposalCreatesRecord(proposal));
    case 'sales-link.delete':
      return wholeRecord((target) => t.approveSalesLinkDelete({ target }), proposalRemovesRecord(proposal));
    case 'product.publish':
      return named((target) => t.approveProductPublish({ target }), ['published']);
    case 'product.unpublish':
      return named((target) => t.approveProductUnpublish({ target }), ['published']);
    case 'price.create': {
      const price = priceOf(proposal.input);
      return price === null
        ? fallback
        : named((target) => t.approvePriceCreate({ target, price: priceTerms(t, price, language) }), ['activePrices']);
    }
    case 'price.deactivate': {
      const price = proposal.targetPrice;
      return price === null
        ? fallback
        : named((target) => t.approvePriceDeactivate({ target, price: targetPriceTerms(t, price, language) }), ['active']);
    }
    case 'stock.enable': {
      const count = numberAfter(rows, 'onHand');
      if (count === null) return fallback;
      const threshold = numberAfter(rows, 'lowStockThreshold');
      return threshold === null
        ? named((target) => t.approveStockEnable({ target, count }), ['tracked', 'onHand'])
        : named((target) => t.approveStockEnableWithThreshold({ target, count, threshold }), ['tracked', 'onHand', 'lowStockThreshold']);
    }
    case 'stock.set-threshold':
      return named((target) => t.approveStockThreshold({ target }), ['lowStockThreshold']);
    case 'product.update':
    case 'sales-link.update':
      return named((target) => t.approveFieldsChange({ target, count: rows.length }), 'every-row');
    case 'product.set-access': {
      const access = changeProposalAccessChange(proposal);
      if (access === null) return fallback;
      const { refused } = accessFacts(access, proposal.accessLabels);
      const text = <AccessApprovalText target={name} change={access} labels={proposal.accessLabels} newProduct={false} group={false} refused={refused} />;
      return refused ? { text, names: 'every-row', closing: false } : { text, names: ['accessItems'] };
    }
    case 'download.add':
    case 'download.replace':
    case 'download.remove': {
      const change = singleFileChange(proposal);
      return change === null
        ? fallback
        : { text: <FileApprovalText change={change} target={name} copiedFrom={copySourceOf(proposal, change)} newProduct={false} />, names: ['files'] };
    }
  }
};

const FILE_OPERATIONS: ReadonlySet<string> = new Set(['download.add', 'download.replace', 'download.remove']);

type FileNoteFacts = Pick<ChangeProposalOwnerView, 'operation' | 'input' | 'effect' | 'target'>;

const removesLastFile = (proposal: FileNoteFacts): boolean =>
  proposal.operation === 'download.remove' && proposalFileChanges(proposal)?.leavesNoFile === true;

const changesFilesOf = (proposal: FileNoteFacts, product: string | null): boolean =>
  FILE_OPERATIONS.has(proposal.operation) && proposal.target.id === product;

const leavesProductWithoutFile = (proposals: readonly FileNoteFacts[]): boolean =>
  proposals.some((proposal, index) => removesLastFile(proposal)
    && !proposals.slice(index + 1).some((later) => changesFilesOf(later, proposal.target.id)));

export const ApprovalFilesNote = ({
  proposals,
  group,
}: {
  proposals: readonly FileNoteFacts[];
  group: boolean;
}) => {
  const t = useTranslations().changeProposals;
  const attached = changeProposalStagedFileIds(proposals).length;
  const removal = leavesProductWithoutFile(proposals);
  if (attached === 0 && !removal) return null;
  const missing = attached === 0 ? null : group ? t.approveGroupFilesMissing({ count: attached }) : t.approveFileMissing;
  return (
    <Typography variant="body2" data-testid="proposal-approve-files">
      {[removal ? t.fileRemoveOnlyFile : null, missing].filter((sentence) => sentence !== null).join(' ')}
    </Typography>
  );
};

const keptAtGroupEnd = (items: readonly ApprovalFacts[], item: ApprovalFacts, change: FileChange): boolean => {
  const product = item.target.id;
  if (product === null) return true;
  const later = items.slice(items.indexOf(item) + 1).filter((entry) => entry.target.id === product);
  if (later.some((entry) => entry.operation === 'product.delete-draft')) return false;
  const last = later.findLast((entry) => FILE_OPERATIONS.has(entry.operation));
  const final = last === undefined ? null : proposalFilesAfter(last);
  return final === null || final.some((file) => file.id === change.file.id && file.latest);
};

export const GroupFileSentences = ({ items, references }: { items: readonly ApprovalFacts[]; references: GroupReferences }) => {
  const t = useTranslations().changeProposals;
  const files = items.flatMap((item) => {
    if (!FILE_OPERATIONS.has(item.operation)) return [];
    const change = singleFileChange(item);
    const shownTarget = proposalTarget(item, references);
    const target = targetName(shownTarget);
    return [{ item, text: change === null || target === null
      ? t.approveFallback({ operation: operationTitle(t, item.operation) })
      : (
        <FileApprovalText
          change={change}
          target={target}
          copiedFrom={copySourceOf(item, change)}
          newProduct={shownTarget.kind === 'reference'}
          reachesBuyers={keptAtGroupEnd(items, item, change)}
        />
      ) }];
  });
  return (
    <>
      {files.map(({ item, text }) => (
        <WrapAnywhereText key={item.id} variant="body2" data-testid={`proposal-approve-file-${item.id}`}>{text}</WrapAnywhereText>
      ))}
    </>
  );
};

const accessStepsByProduct = (items: readonly ApprovalFacts[]): ApprovalFacts[][] => {
  const byProduct = new Map<string, ApprovalFacts[]>();
  for (const item of items) {
    if (item.operation !== 'product.set-access') continue;
    const product = item.target.id ?? item.id;
    byProduct.set(product, [...(byProduct.get(product) ?? []), item]);
  }
  return [...byProduct.values()];
};

type AccessLabels = NonNullable<ApprovalFacts['accessLabels']>;

const mergedAccessLabels = (steps: readonly ApprovalFacts[]): ApprovalFacts['accessLabels'] => {
  const present = steps.flatMap((step) => (step.accessLabels === undefined ? [] : [step.accessLabels]));
  if (present.length === 0) return undefined;
  const merged = (kind: 'courses' | 'modules' | 'lessons'): AccessLabels[typeof kind] => {
    const byId = new Map<string, AccessLabels[typeof kind][number]>();
    for (const labels of present) for (const entry of labels[kind]) if (!byId.has(entry.id)) byId.set(entry.id, entry);
    return [...byId.values()];
  };
  const archived = [...new Set(present.flatMap((labels) => labels.archivedCourses ?? []))];
  return {
    courses: merged('courses'),
    modules: merged('modules'),
    lessons: merged('lessons'),
    ...(archived.length === 0 ? {} : { archivedCourses: archived }),
  };
};

const stepRefused = (step: ApprovalFacts): boolean => {
  const change = changeProposalAccessChange(step);
  return change !== null && accessFacts(change, step.accessLabels).refused;
};

const deletedLater = (items: readonly ApprovalFacts[], last: ApprovalFacts): boolean =>
  last.target.id !== null && items.slice(items.indexOf(last) + 1).some(
    (later) => later.operation === 'product.delete-draft' && later.target.id === last.target.id,
  );

export const GroupAccessSentences = ({ items, references }: { items: readonly ApprovalFacts[]; references: GroupReferences }) => {
  const t = useTranslations().changeProposals;
  const sentences = accessStepsByProduct(items).flatMap((steps) => {
    const [first] = steps;
    const item = steps.at(-1);
    if (first === undefined || item === undefined) return [];
    const before = changeProposalAccessChange(first);
    const after = changeProposalAccessChange(item);
    const shownTarget = proposalTarget(item, references);
    const target = targetName(shownTarget);
    const refused = steps.some(stepRefused);
    if (target !== null && deletedLater(items, item)) {
      return refused
        ? [{ item, text: <Isolated sentence={(slot) => t.approveGroupProductSetAccessRefusedDeleted({ target: slot })} value={target} /> }]
        : [];
    }
    return [{ item, text: before === null || after === null || target === null
      ? t.approveFallback({ operation: operationTitle(t, item.operation) })
      : (
        <AccessApprovalText
          target={target}
          change={{ before: before.before, after: after.after }}
          labels={mergedAccessLabels(steps)}
          newProduct={shownTarget.kind === 'reference'}
          group
          refused={refused}
        />
      ) }];
  });
  return (
    <>
      {sentences.map(({ item, text }) => (
        <WrapAnywhereText key={item.id} variant="body2" data-testid={`proposal-approve-access-${item.id}`}>{text}</WrapAnywhereText>
      ))}
    </>
  );
};

export const ApprovalImagesNote = ({ proposals, group }: { proposals: readonly Pick<ChangeProposalOwnerView, 'id' | 'effect' | 'input'>[]; group: boolean }) => {
  const t = useTranslations().changeProposals;
  const count = proposedImagePaths(proposals).length;
  if (count === 0) return null;
  return (
    <Typography variant="body2" data-testid="proposal-approve-images">
      {group ? t.approveGroupImagesPublic({ count }) : t.approveImagesPublic({ count })}
    </Typography>
  );
};

export const ApprovalSummary = ({ proposal }: { proposal: ApprovalFacts }) => {
  const t = useTranslations().changeProposals;
  const rows = proposalRows(proposal);
  const sentence = useApprovalSentence(proposal, rows);
  return (
    <>
      <WrapAnywhereText variant="body2" data-testid="proposal-approve-summary">
        {sentence.text}
        {sentence.closing === false ? null : ` ${closingSentence(t, rows, sentence.names)}`}
      </WrapAnywhereText>
      <ApprovalImagesNote proposals={[proposal]} group={false} />
      <ApprovalFilesNote proposals={[proposal]} group={false} />
    </>
  );
};
