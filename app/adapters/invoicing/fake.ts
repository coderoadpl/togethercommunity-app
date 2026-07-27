import { ok } from '@core/domain/index.js';
import type { InvoicingPort } from '@core/server/index.js';

export const createFakeInvoicing = (): InvoicingPort => {
  const issued = new Map<string, string>();
  return {
    issueInvoice: async ({
      order,
      providerInvoiceId: existingProviderInvoiceId,
      onProviderInvoiceCreated,
    }) => {
      const providerInvoiceId = existingProviderInvoiceId ?? issued.get(order.id) ?? `fake-${order.id}`;
      issued.set(order.id, providerInvoiceId);
      if (existingProviderInvoiceId === null) {
        await onProviderInvoiceCreated(providerInvoiceId);
      }
      return ok({
        providerInvoiceId,
        invoiceNumber: `FV/${order.id}`,
        status: 'issued',
      });
    },
    getInvoiceStatus: async () => ok('issued'),
    downloadInvoice: async () =>
      ok({ content: new TextEncoder().encode('%PDF-1.7 fake'), contentType: 'application/pdf' }),
    testConnection: async () => ok({ diagnostic: 'Fake invoicing is available.' }),
  };
};
