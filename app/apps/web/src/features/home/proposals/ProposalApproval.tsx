import type { ReactNode } from 'react';
import { Typography } from '@mui/material';

import { knownChangeProposalOperation, type ChangeProposalOwnerView } from '#core/domain/index.js';

import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { priceOf, proposalRows, proposalTarget, type TargetDisplay } from './proposal-display.js';
import { Isolated, operationTitle, priceTerms, targetPriceTerms } from './proposal-text.js';

export type ApprovalFacts = Pick<
  ChangeProposalOwnerView,
  'operation' | 'target' | 'targetLabel' | 'targetPrice' | 'input' | 'effect' | 'appliedResourceId'
>;

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

export const ApprovalSummary = ({ proposal }: { proposal: ApprovalFacts }) => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  const operation = knownChangeProposalOperation(proposal.operation);
  const rows = proposalRows(proposal);
  const name = targetName(proposalTarget(proposal));
  const fallback = t.approveFallback({ operation: operationTitle(t, proposal.operation) });

  const sentence = (): ReactNode => {
    if (operation === null) return fallback;
    if (operation === 'settings.update') return t.approveSettingsChange({ count: rows.length });
    if (name === null) return fallback;
    const named = (build: (target: string) => string) => <Isolated sentence={build} value={name} />;
    switch (operation) {
      case 'stock.adjust': {
        const delta = rows.find((row) => row.kind === 'delta');
        if (delta?.kind !== 'delta') return fallback;
        const count = Math.abs(delta.delta);
        return named((target) => delta.delta > 0 ? t.approveStockAdded({ target, count }) : t.approveStockRemoved({ target, count }));
      }
      case 'product.create':
        return named((target) => t.approveProductCreate({ target }));
      case 'product.publish':
        return named((target) => t.approveProductPublish({ target }));
      case 'product.unpublish':
        return named((target) => t.approveProductUnpublish({ target }));
      case 'product.delete-draft':
        return named((target) => t.approveProductDeleteDraft({ target }));
      case 'price.create': {
        const price = priceOf(proposal.input);
        return price === null ? fallback : named((target) => t.approvePriceCreate({ target, price: priceTerms(t, price, language) }));
      }
      case 'price.deactivate': {
        const price = proposal.targetPrice;
        return price === null ? fallback : named((target) => t.approvePriceDeactivate({ target, price: targetPriceTerms(t, price, language) }));
      }
      case 'stock.enable':
        return named((target) => t.approveStockEnable({ target }));
      case 'stock.set-threshold':
        return named((target) => t.approveStockThreshold({ target }));
      case 'sales-link.create':
        return named((target) => t.approveSalesLinkCreate({ target }));
      case 'sales-link.delete':
        return named((target) => t.approveSalesLinkDelete({ target }));
      case 'product.update':
      case 'sales-link.update':
        return named((target) => t.approveFieldsChange({ target, count: rows.length }));
    }
  };

  return (
    <Typography variant="body2" data-testid="proposal-approve-summary">
      {sentence()}
      {` ${t.approveNothingElse}`}
    </Typography>
  );
};
