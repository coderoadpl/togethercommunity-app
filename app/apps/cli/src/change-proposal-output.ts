import { registeredChangeProposalOperation, type RegisteredChangeProposalOperation } from '#core/domain/index.js';

const APPLIED_RESOURCE_LABEL: Record<RegisteredChangeProposalOperation, string | null> = {
  'product.create': 'product',
  'product.update': 'product',
  'product.publish': 'product',
  'product.unpublish': 'product',
  'product.delete-draft': 'product',
  'price.create': 'price',
  'price.deactivate': 'price',
  'stock.enable': 'product',
  'stock.adjust': 'product',
  'stock.set-threshold': 'product',
  'sales-link.create': 'sales link',
  'sales-link.update': 'sales link',
  'sales-link.delete': 'sales link',
  'settings.update': null,
  'download.add': 'file',
  'download.replace': 'file',
  'download.remove': 'product',
};

export const changeProposalAppliedLine = (operation: string, appliedResourceId: string | null): string => {
  const known = registeredChangeProposalOperation(operation);
  if (known !== null && APPLIED_RESOURCE_LABEL[known] === null) return 'applied: settings';
  if (appliedResourceId === null) return 'applied';
  const label = known === null ? null : APPLIED_RESOURCE_LABEL[known];
  return label === null ? `applied: ${appliedResourceId}` : `applied: ${label} ${appliedResourceId}`;
};
