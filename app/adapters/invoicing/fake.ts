import { ok } from '@core/domain/index.js';
import type { InvoicingPort } from '@core/server/index.js';

export const createFakeInvoicing = (): InvoicingPort => {
  const issued = new Map<string, string>();
  return {
    issueInvoice: async ({ order }) => {
      const providerInvoiceId = issued.get(order.id) ?? `fake-${order.id}`;
      issued.set(order.id, providerInvoiceId);
      return ok({
        providerInvoiceId,
        invoiceNumber: `FV/${order.id}`,
        pdfUrl: `https://fake.invoices.local/${providerInvoiceId}.pdf`,
        status: 'issued',
      });
    },
    getInvoiceStatus: async () => ok('issued'),
    invoiceDownloadUrl: async ({ providerInvoiceId }) =>
      ok(`https://fake.invoices.local/${providerInvoiceId}.pdf`),
    testConnection: async () => ok({ diagnostic: 'Fake invoicing is available.' }),
  };
};
