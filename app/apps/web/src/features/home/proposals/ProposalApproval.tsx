import type { ReactNode } from 'react';
import { Typography } from '@mui/material';

import { knownChangeProposalOperation, type ChangeProposalOwnerView } from '#core/domain/index.js';

import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import {
  priceOf,
  proposalCreatesRecord,
  proposalRemovesRecord,
  proposalRows,
  proposalTarget,
  type DisplayRow,
  type TargetDisplay,
} from './proposal-display.js';
import { Isolated, operationTitle, priceTerms, targetPriceTerms } from './proposal-text.js';

export type ApprovalFacts = Pick<
  ChangeProposalOwnerView,
  'operation' | 'target' | 'targetLabel' | 'targetPrice' | 'input' | 'effect' | 'appliedResourceId'
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

const useApprovalSentence = (proposal: ApprovalFacts, rows: readonly DisplayRow[]): ApprovalSentence => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  const operation = knownChangeProposalOperation(proposal.operation);
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
  }
};

export const ApprovalSummary = ({ proposal }: { proposal: ApprovalFacts }) => {
  const t = useTranslations().changeProposals;
  const rows = proposalRows(proposal);
  const sentence = useApprovalSentence(proposal, rows);
  return (
    <Typography variant="body2" data-testid="proposal-approve-summary">
      {sentence.text}
      {` ${closingSentence(t, rows, sentence.names)}`}
    </Typography>
  );
};
