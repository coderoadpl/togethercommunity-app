import { z } from 'zod';

import {
  err,
  integrationAuth,
  integrationUnavailable,
  ok,
  validation,
  type Result,
  type AppError,
} from '@core/domain/index.js';
import type { InvoicingPort } from '@core/server/index.js';

const responseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  number: z.string(),
  view_url: z.string().url().optional(),
  status: z.string().optional(),
});

export const fakturowniaInvoicePayload = (
  input: Parameters<InvoicingPort['issueInvoice']>[0],
) => ({
  api_token: input.config.apiKey,
  invoice: {
    kind: 'vat',
    currency: input.order.currency,
    buyer_name: input.billing?.companyName ?? 'Klient detaliczny',
    ...(input.billing?.nip == null ? {} : { buyer_tax_no: input.billing.nip }),
    ...(input.billing === null
      ? {}
      : {
          buyer_street: input.billing.address,
          buyer_post_code: input.billing.postalCode,
          buyer_city: input.billing.city,
          buyer_country: input.billing.country,
        }),
    positions: [
      {
        name: input.order.couponId === null
          ? input.productName
          : `${input.productName} (discount applied)`,
        quantity: 1,
        total_price_gross: input.order.amountCents / 100,
        tax: 23,
      },
    ],
  },
});

const providerError = async (response: Response): Promise<AppError> => {
  if (response.status === 401 || response.status === 403) {
    return integrationAuth('Fakturownia rejected the API key. Update it in Integrations.');
  }
  const detail = await response.text().catch(() => '');
  return validation(
    detail === ''
      ? 'Fakturownia rejected the invoice data. Check the order billing snapshot.'
      : `Fakturownia rejected the invoice data: ${detail.slice(0, 300)}`,
  );
};

export const createFakturowniaInvoicing = (
  fetcher: typeof fetch = fetch,
): InvoicingPort => ({
  issueInvoice: async (input) => {
    try {
      const response = await fetcher(
        `https://${encodeURIComponent(input.config.subdomain)}.fakturownia.pl/invoices.json`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(fakturowniaInvoicePayload(input)),
        },
      );
      if (!response.ok) return err(await providerError(response));
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return err(validation('Fakturownia returned an invalid invoice response'));
      }
      return ok({
        providerInvoiceId: parsed.data.id,
        invoiceNumber: parsed.data.number,
        pdfUrl:
          parsed.data.view_url ??
          `https://${input.config.subdomain}.fakturownia.pl/invoices/${parsed.data.id}.pdf`,
        status: parsed.data.status === 'paid' ? 'delivered' : 'issued',
      });
    } catch {
      return err(integrationUnavailable('Fakturownia is unreachable. Retry invoice issuance.'));
    }
  },
  getInvoiceStatus: async (input) => {
    try {
      const response = await fetcher(
        `https://${encodeURIComponent(input.config.subdomain)}.fakturownia.pl/invoices/${encodeURIComponent(input.providerInvoiceId)}.json?api_token=${encodeURIComponent(input.config.apiKey)}`,
      );
      if (!response.ok) return err(await providerError(response));
      const parsed = responseSchema.safeParse(await response.json());
      return parsed.success
        ? ok(parsed.data.status === 'paid' ? 'delivered' : 'issued')
        : err(validation('Fakturownia returned an invalid status response'));
    } catch {
      return err(integrationUnavailable('Fakturownia is unreachable. Retry the status refresh.'));
    }
  },
  invoiceDownloadUrl: async (input): Promise<Result<string, AppError>> =>
    ok(
      `https://${input.config.subdomain}.fakturownia.pl/invoices/${encodeURIComponent(input.providerInvoiceId)}.pdf`,
    ),
});
