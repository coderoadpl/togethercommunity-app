import type { KeyboardEvent } from 'react';

import { CLOSES_ON_ESCAPE_SELECTOR } from '../../components/ui/CheckoutStepParts.js';

export const rowAction = (action: 'apply' | 'pick') => ({ 'data-checkout-row-action': action });

const ROW_ACTION_SELECTOR = '[data-checkout-row-action]';
const CHOICE_INPUT_TYPES = new Set(['checkbox', 'radio']);

export const checkoutFormKeyDown = (payDisabled: boolean) => (event: KeyboardEvent<HTMLFormElement>) => {
  const { target } = event;
  if (!(target instanceof Element)) return;
  if (event.key === 'Escape') {
    const header = target.closest(CLOSES_ON_ESCAPE_SELECTOR)?.querySelector('button[aria-expanded="true"]');
    if (!(header instanceof HTMLButtonElement)) return;
    event.preventDefault();
    header.click();
    header.focus();
    return;
  }
  if (event.key !== 'Enter' || !(target instanceof HTMLInputElement) || target.form !== event.currentTarget) return;
  if (payDisabled || CHOICE_INPUT_TYPES.has(target.type) || target.closest(ROW_ACTION_SELECTOR) !== null) event.preventDefault();
};
