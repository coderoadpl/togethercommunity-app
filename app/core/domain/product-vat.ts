import { z } from 'zod';

import { resolveInvoiceVat, type InvoiceVatTreatment, type TenantSettings } from './tenant.js';

export const productVatRateSchema = z.union([z.literal(5), z.literal(8), z.literal(23), z.literal('exempt')]);
export type ProductVatRate = z.infer<typeof productVatRateSchema>;

export const productVatFields = {
  vatRate: productVatRateSchema.nullable().optional(),
  vatExemptionBasis: z.string().trim().min(1).max(256).nullable().optional(),
};

type ProductVat = { vatRate?: ProductVatRate | null | undefined; vatExemptionBasis?: string | null | undefined };

export const resolveProductVat = (product: ProductVat, settings: TenantSettings | null): InvoiceVatTreatment | null => {
  if (product.vatRate == null) {
    if (settings === null) return null;
    const resolution = resolveInvoiceVat(settings);
    return resolution.ok ? resolution.treatment : null;
  }
  if (product.vatRate !== 'exempt') return { kind: 'rate', percent: product.vatRate };
  const basis = product.vatExemptionBasis?.trim() ?? settings?.invoiceExemptionBasis?.trim();
  if (!basis) return null;
  const resolution = resolveInvoiceVat({
    invoiceVatMode: 'exempt',
    invoiceExemptionBasisKind: basis === settings?.invoiceExemptionBasis?.trim() ? settings.invoiceExemptionBasisKind ?? null : 'other',
    invoiceExemptionBasis: basis,
  });
  return resolution.ok ? resolution.treatment : null;
};

export const defaultProductVat = (product: ProductVat, settings: TenantSettings | null): ProductVat => {
  const vat = resolveProductVat(product, settings);
  return vat === null
    ? { vatRate: null, vatExemptionBasis: null }
    : { vatRate: vat.kind === 'rate' ? vat.percent : 'exempt', vatExemptionBasis: vat.kind === 'exempt' ? vat.basis : null };
};

export const splitProductGross = (grossCents: number, vatRate: ProductVatRate) => {
  const netCents = vatRate === 'exempt' ? grossCents : Math.round(grossCents * 100 / (100 + vatRate));
  return { grossCents, netCents, vatCents: grossCents - netCents };
};
