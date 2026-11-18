import { orderLineQuantity } from './commerce.js';
import type { InvoicePosition } from './fa3.js';
import { splitProductGross } from './product-vat.js';
import type { InvoiceVatTreatment } from './tenant.js';

const withQuantity = (quantity: number): { quantity?: number } => quantity > 1 ? { quantity } : {};

export const linesNeedInvoicePositions = (lines: readonly { quantity?: number | undefined }[]): boolean =>
  lines.length > 1 || lines.some((line) => orderLineQuantity(line) > 1);

export const lineInvoicePositions = (line: {
  name: string;
  quantity: number;
  grossCents: number;
  vat: InvoiceVatTreatment;
}): InvoicePosition[] => {
  const { name, quantity, grossCents, vat } = line;
  const rate = vat.kind === 'exempt' ? 'exempt' : vat.percent;
  const whole = splitProductGross(grossCents, rate);
  if (grossCents % quantity === 0) return [{ name, ...withQuantity(quantity), ...whole, vat }];
  const head = splitProductGross((quantity - 1) * Math.floor(grossCents / quantity), rate);
  return [
    { name, ...withQuantity(quantity - 1), ...head, vat },
    {
      name,
      grossCents: whole.grossCents - head.grossCents,
      netCents: whole.netCents - head.netCents,
      vatCents: whole.vatCents - head.vatCents,
      vat,
    },
  ];
};
