import type { Order } from './commerce.js';
import { resolveInvoiceVat, type InvoiceVatResolution, type TenantSettings } from './tenant.js';

export const resolveOrderVat = (order: Order, settings: TenantSettings | null): InvoiceVatResolution => {
  for (const line of order.lines ?? []) {
    if (line.vatRate !== 'exempt') continue;
    const resolution = resolveInvoiceVat({
      invoiceVatMode: 'exempt',
      invoiceExemptionBasisKind: line.vatExemptionBasisKind ?? null,
      invoiceExemptionBasis: line.vatExemptionBasis,
    });
    if (!resolution.ok) return resolution;
  }
  const first = order.lines?.[0];
  if (first?.vatRate != null) {
    if (first.vatRate !== 'exempt') return { ok: true, treatment: { kind: 'rate', percent: first.vatRate } };
    return resolveInvoiceVat({
      invoiceVatMode: 'exempt',
      invoiceExemptionBasisKind: first.vatExemptionBasisKind ?? null,
      invoiceExemptionBasis: first.vatExemptionBasis,
    });
  }
  return settings === null ? { ok: false, reason: 'unset' } : resolveInvoiceVat(settings);
};
