import type { KeyboardEvent } from 'react';

import { CLOSES_ON_ESCAPE_SELECTOR } from '../../components/ui/CheckoutStepParts.js';

export const rowAction = (action: 'apply' | 'pick') => ({ 'data-checkout-row-action': action });

const ROW_ACTION_SELECTOR = '[data-checkout-row-action]';
const CHOICE_INPUT_TYPES = new Set(['checkbox', 'radio']);

const ownOpenHeader = (box: Element): HTMLButtonElement | undefined =>
  [...box.querySelectorAll('button[aria-expanded="true"]')]
    .find((button): button is HTMLButtonElement => button instanceof HTMLButtonElement && button.closest(CLOSES_ON_ESCAPE_SELECTOR) === box);

const openHeaderAround = (target: Element): HTMLButtonElement | undefined => {
  for (let box = target.closest(CLOSES_ON_ESCAPE_SELECTOR); box !== null; box = box.parentElement?.closest(CLOSES_ON_ESCAPE_SELECTOR) ?? null) {
    const header = ownOpenHeader(box);
    if (header !== undefined) return header;
  }
  return undefined;
};

export const checkoutFormKeyDown = (payDisabled: boolean) => (event: KeyboardEvent<HTMLFormElement>) => {
  const { target } = event;
  if (!(target instanceof Element)) return;
  if (event.key === 'Escape') {
    const header = openHeaderAround(target);
    if (header === undefined) return;
    event.preventDefault();
    header.click();
    header.focus();
    return;
  }
  if (event.key !== 'Enter' || !(target instanceof HTMLInputElement) || target.form !== event.currentTarget) return;
  if (payDisabled || CHOICE_INPUT_TYPES.has(target.type) || target.closest(ROW_ACTION_SELECTOR) !== null) event.preventDefault();
};
