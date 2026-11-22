import type { ReactNode } from 'react';
import { Typography } from '@mui/material';

import { changeProposalStagedFileIds, registeredChangeProposalOperation, type ChangeProposalOwnerView } from '#core/domain/index.js';

import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatFileSize } from '../../../lib/format.js';
import {
  priceOf,
  proposalCreatesRecord,
  proposalFileChanges,
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
import { currentVersionText, Fingerprint } from './ProposedFiles.js';
import { fileTypeLabel, Isolated, operationTitle, priceTerms, Sentence, targetPriceTerms } from './proposal-text.js';

export type ApprovalFacts = Pick<
  ChangeProposalOwnerView,
  'id' | 'operation' | 'target' | 'targetLabel' | 'targetPrice' | 'input' | 'effect' | 'appliedResourceId'
>;

type Translations = Messages['changeProposals'];

type Coverage = 'every-row' | readonly string[];

interface ApprovalSentence {
  text: ReactNode;
  names: Coverage;
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

const FileApprovalText = ({ change, target }: { change: FileChange; target: string }) => {
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
  switch (change.kind) {
    case 'added':
      return (
        <Sentence
          text={(file, slot, name) => t.approveFileAdd({ file, facts: facts(change.file, slot), target: name })}
          parts={[fileName, fingerprint, product]}
        />
      );
    case 'replaced':
      return (
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
    case 'download.add':
    case 'download.replace':
    case 'download.remove': {
      const change = singleFileChange(proposal);
      return change === null ? fallback : { text: <FileApprovalText change={change} target={name} />, names: ['files'] };
    }
  }
};

const FILE_OPERATIONS: ReadonlySet<string> = new Set(['download.add', 'download.replace', 'download.remove']);

const removesFile = (proposal: Pick<ChangeProposalOwnerView, 'operation'>): boolean => proposal.operation === 'download.remove';

export const ApprovalFilesNote = ({
  proposals,
  group,
}: {
  proposals: readonly Pick<ChangeProposalOwnerView, 'operation' | 'input'>[];
  group: boolean;
}) => {
  const t = useTranslations().changeProposals;
  const attached = changeProposalStagedFileIds(proposals).length;
  const removal = proposals.some(removesFile);
  if (attached === 0 && !removal) return null;
  const missing = attached === 0 ? null : group ? t.approveGroupFilesMissing({ count: attached }) : t.approveFileMissing;
  return (
    <Typography variant="body2" data-testid="proposal-approve-files">
      {[removal ? t.fileRemoveOnlyFile : null, missing].filter((sentence) => sentence !== null).join(' ')}
    </Typography>
  );
};

export const GroupFileSentences = ({ items, references }: { items: readonly ApprovalFacts[]; references: GroupReferences }) => {
  const t = useTranslations().changeProposals;
  const files = items.flatMap((item) => {
    if (!FILE_OPERATIONS.has(item.operation)) return [];
    const change = singleFileChange(item);
    const target = targetName(proposalTarget(item, references));
    return [{ item, text: change === null || target === null
      ? t.approveFallback({ operation: operationTitle(t, item.operation) })
      : <FileApprovalText change={change} target={target} /> }];
  });
  return (
    <>
      {files.map(({ item, text }) => (
        <Typography key={item.id} variant="body2" data-testid={`proposal-approve-file-${item.id}`}>{text}</Typography>
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
      <Typography variant="body2" data-testid="proposal-approve-summary">
        {sentence.text}
        {` ${closingSentence(t, rows, sentence.names)}`}
      </Typography>
      <ApprovalImagesNote proposals={[proposal]} group={false} />
      <ApprovalFilesNote proposals={[proposal]} group={false} />
    </>
  );
};
