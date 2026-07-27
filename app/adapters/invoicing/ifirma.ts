import { createHmac } from 'node:crypto';

import { z } from 'zod';

import {
  err,
  integrationAuth,
  integrationUnavailable,
  ok,
  validation,
  type AppError,
} from '@core/domain/index.js';
import type { InvoicingPort } from '@core/server/index.js';

const IFIRMA_BASE_URL = 'https://www.ifirma.pl/iapi';
const IFIRMA_KEY_NAME = 'faktura';

const providerResponseSchema = z.object({
  response: z.object({
    Kod: z.number(),
    Informacja: z.string().optional(),
  }).passthrough(),
});

const invoiceCreatedSchema = z.object({
  response: z.object({
    Kod: z.literal(0),
    Informacja: z.string().optional(),
    Identyfikator: z.union([z.string(), z.number()]).transform(String),
  }),
});

const invoiceListSchema = z.object({
  response: z.object({
    Kod: z.literal(0),
    Informacja: z.string().optional(),
    Wynik: z.array(z.object({
      FakturaId: z.union([z.string(), z.number()]).transform(String),
      PelnyNumer: z.string(),
      CzyWyslano: z.boolean().optional(),
    }).passthrough()),
  }),
});

const invoiceStatusSchema = z.object({
  response: z.object({
    Kod: z.literal(0),
    CzyWyslano: z.boolean().optional(),
    Wynik: z.union([
      z.object({ CzyWyslano: z.boolean().optional() }).passthrough(),
      z.array(z.object({ CzyWyslano: z.boolean().optional() }).passthrough()),
    ]).optional(),
  }).passthrough(),
});

type IfirmaConfig = Parameters<InvoicingPort['testConnection']>[0]['config'];

const invoiceApiKeyBytes = (invoiceApiKey: string): Buffer => {
  if (invoiceApiKey.length === 0 || invoiceApiKey.length % 2 !== 0 || !/^[\dA-Fa-f]+$/.test(invoiceApiKey)) {
    throw new Error('Invalid iFirma invoice API key');
  }
  return Buffer.from(invoiceApiKey, 'hex');
};

export const ifirmaAuthenticationHeader = (
  url: string,
  config: IfirmaConfig,
  requestContent = '',
): string => {
  const signedUrl = url.split('?')[0] ?? url;
  const digest = createHmac('sha1', invoiceApiKeyBytes(config.invoiceApiKey))
    .update(`${signedUrl}${config.username}${IFIRMA_KEY_NAME}${requestContent}`)
    .digest('hex');
  return `IAPIS user=${config.username}, hmac-sha1=${digest}`;
};

export const ifirmaInvoicePayload = (
  input: Parameters<InvoicingPort['issueInvoice']>[0],
  issueDate: string,
) => {
  const grossAmount = input.order.amountCents / 100;
  const billing = input.billing;
  return {
    Zaplacono: grossAmount,
    ZaplaconoNaDokumencie: grossAmount,
    LiczOd: 'BRT',
    NumerKontaBankowego: null,
    DataWystawienia: issueDate,
    DataSprzedazy: input.order.createdAt.slice(0, 10),
    FormatDatySprzedazy: 'DZN',
    TerminPlatnosci: null,
    SposobZaplaty: 'ELE',
    RodzajPodpisuOdbiorcy: 'BWO',
    WidocznyNumerBdo: false,
    Numer: null,
    Pozycje: [{
      StawkaVat: 0.23,
      Ilosc: 1,
      CenaJednostkowa: grossAmount,
      NazwaPelna: input.order.couponId === null
        ? input.productName
        : `${input.productName} (coupon discount applied)`,
      Jednostka: 'szt.',
      PKWiU: '',
      TypStawkiVat: 'PRC',
    }],
    Kontrahent: billing === null
      ? {
          Nazwa: 'Klient detaliczny',
          Identyfikator: null,
          PrefiksUE: null,
          NIP: null,
          Ulica: '',
          KodPocztowy: '00-000',
          Kraj: 'Polska',
          KodKraju: 'PL',
          Miejscowosc: 'Nie podano',
          OsobaFizyczna: true,
        }
      : {
          Nazwa: billing.companyName,
          Identyfikator: null,
          PrefiksUE: billing.country === 'PL' ? null : billing.country,
          NIP: billing.nip,
          Ulica: billing.address,
          KodPocztowy: billing.postalCode,
          Kraj: billing.country,
          KodKraju: billing.country,
          Miejscowosc: billing.city,
          OsobaFizyczna: billing.nip === null,
        },
  };
};

const errorDetail = (information: string | undefined): string =>
  information === undefined || information.trim() === ''
    ? ''
    : ` iFirma says: ${information.trim().slice(0, 300)}`;

const providerError = (
  status: number,
  code: number | null,
  information: string | undefined,
  action: string,
): AppError => {
  if (status === 401 || status === 403 || (code !== null && code >= 400 && code <= 403)) {
    return integrationAuth(
      `iFirma rejected the username or faktura API key. Update both in Integrations.${errorDetail(information)}`,
    );
  }
  if (code === 100 || status >= 500) {
    return integrationUnavailable(
      `iFirma could not ${action} because its API reported a technical failure. Retry later.${errorDetail(information)}`,
    );
  }
  return validation(
    `iFirma could not ${action}. Check the account configuration and invoice data.${errorDetail(information)}`,
  );
};

const responseError = async (response: Response, action: string): Promise<AppError> => {
  const parsed = providerResponseSchema.safeParse(
    await response.clone().json().catch(() => null),
  );
  return providerError(
    response.status,
    parsed.success ? parsed.data.response.Kod : null,
    parsed.success ? parsed.data.response.Informacja : undefined,
    action,
  );
};

const authenticatedFetch = (
  fetcher: typeof fetch,
  url: string,
  config: IfirmaConfig,
  init: RequestInit = {},
  body = '',
): Promise<Response> => {
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  headers.set('Authentication', ifirmaAuthenticationHeader(url, config, body));
  if (body !== '') headers.set('content-type', 'application/json; charset=UTF-8');
  return fetcher(url, { ...init, headers, ...(body === '' ? {} : { body }) });
};

const invoiceListUrl = (date: string): string =>
  `${IFIRMA_BASE_URL}/faktury.json?dataOd=${date}&dataDo=${date}`;

const invoiceUrl = (providerInvoiceId: string, format: 'json' | 'pdf'): string =>
  `${IFIRMA_BASE_URL}/fakturakraj/${encodeURIComponent(providerInvoiceId)}.${format}`;

const unreachable = (action: string): AppError =>
  integrationUnavailable(`iFirma is unreachable. Retry ${action}.`);

const invalidConfig = (config: IfirmaConfig): AppError | null => {
  try {
    invoiceApiKeyBytes(config.invoiceApiKey);
    return config.username.trim() === ''
      ? integrationAuth('The iFirma username is empty. Update it in Integrations.')
      : null;
  } catch {
    return integrationAuth(
      'The iFirma faktura API key must be a hexadecimal key copied from iFirma. Update it in Integrations.',
    );
  }
};

const wasDelivered = (input: z.infer<typeof invoiceStatusSchema>): boolean => {
  if (input.response.CzyWyslano === true) return true;
  if (Array.isArray(input.response.Wynik)) {
    return input.response.Wynik.some((item) => item.CzyWyslano === true);
  }
  return input.response.Wynik?.CzyWyslano === true;
};

export const createIfirmaInvoicing = (
  fetcher: typeof fetch = fetch,
  today: () => string = () => new Date().toISOString().slice(0, 10),
): InvoicingPort => ({
  issueInvoice: async (input) => {
    const configError = invalidConfig(input.config);
    if (configError !== null) return err(configError);
    if (input.order.currency !== 'PLN') {
      return err(validation('iFirma domestic VAT invoices require an order ledger amount in PLN.'));
    }
    try {
      const issueDate = today();
      const payload = JSON.stringify(ifirmaInvoicePayload(input, issueDate));
      const createResponse = await authenticatedFetch(
        fetcher,
        `${IFIRMA_BASE_URL}/fakturakraj.json`,
        input.config,
        { method: 'POST' },
        payload,
      );
      const createPayload: unknown = await createResponse.json().catch(() => null);
      const providerResponse = providerResponseSchema.safeParse(createPayload);
      if (!createResponse.ok || (providerResponse.success && providerResponse.data.response.Kod !== 0)) {
        return err(providerError(
          createResponse.status,
          providerResponse.success ? providerResponse.data.response.Kod : null,
          providerResponse.success ? providerResponse.data.response.Informacja : undefined,
          'issue the invoice',
        ));
      }
      const created = invoiceCreatedSchema.safeParse(createPayload);
      if (!created.success) {
        return err(validation('iFirma returned an invalid invoice-creation response. Retry and contact support if it persists.'));
      }

      const listResponse = await authenticatedFetch(
        fetcher,
        invoiceListUrl(issueDate),
        input.config,
      );
      const listPayload: unknown = await listResponse.json().catch(() => null);
      const providerListResponse = providerResponseSchema.safeParse(listPayload);
      if (!listResponse.ok || (providerListResponse.success && providerListResponse.data.response.Kod !== 0)) {
        return err(providerError(
          listResponse.status,
          providerListResponse.success ? providerListResponse.data.response.Kod : null,
          providerListResponse.success ? providerListResponse.data.response.Informacja : undefined,
          'retrieve the issued invoice number',
        ));
      }
      const listed = invoiceListSchema.safeParse(listPayload);
      const invoice = listed.success
        ? listed.data.response.Wynik.find(
            (candidate) => candidate.FakturaId === created.data.response.Identyfikator,
          )
        : undefined;
      if (invoice === undefined) {
        return err(validation('iFirma issued the invoice but did not return its assigned number. Open iFirma and verify the document.'));
      }

      const pdf = await authenticatedFetch(
        fetcher,
        invoiceUrl(created.data.response.Identyfikator, 'pdf'),
        input.config,
        { headers: { accept: 'application/pdf' } },
      );
      if (!pdf.ok || !pdf.headers.get('content-type')?.toLowerCase().includes('application/pdf')) {
        return err(await responseError(pdf, 'retrieve the issued invoice PDF'));
      }
      return ok({
        providerInvoiceId: created.data.response.Identyfikator,
        invoiceNumber: invoice.PelnyNumer,
        pdfUrl: invoiceUrl(created.data.response.Identyfikator, 'pdf'),
        status: invoice.CzyWyslano === true ? 'delivered' : 'issued',
      });
    } catch {
      return err(unreachable('invoice issuance'));
    }
  },
  getInvoiceStatus: async (input) => {
    const configError = invalidConfig(input.config);
    if (configError !== null) return err(configError);
    try {
      const response = await authenticatedFetch(
        fetcher,
        invoiceUrl(input.providerInvoiceId, 'json'),
        input.config,
      );
      const payload: unknown = await response.json().catch(() => null);
      const providerResponse = providerResponseSchema.safeParse(payload);
      if (!response.ok || (providerResponse.success && providerResponse.data.response.Kod !== 0)) {
        return err(providerError(
          response.status,
          providerResponse.success ? providerResponse.data.response.Kod : null,
          providerResponse.success ? providerResponse.data.response.Informacja : undefined,
          'refresh the invoice status',
        ));
      }
      const parsed = invoiceStatusSchema.safeParse(payload);
      return parsed.success
        ? ok(wasDelivered(parsed.data) ? 'delivered' : 'issued')
        : err(validation('iFirma returned an invalid invoice-status response.'));
    } catch {
      return err(unreachable('the status refresh'));
    }
  },
  invoiceDownloadUrl: async (input) => {
    const configError = invalidConfig(input.config);
    if (configError !== null) return err(configError);
    try {
      const url = invoiceUrl(input.providerInvoiceId, 'pdf');
      const response = await authenticatedFetch(
        fetcher,
        url,
        input.config,
        { headers: { accept: 'application/pdf' } },
      );
      return response.ok && response.headers.get('content-type')?.toLowerCase().includes('application/pdf')
        ? ok(url)
        : err(await responseError(response, 'retrieve the invoice PDF'));
    } catch {
      return err(unreachable('the PDF download'));
    }
  },
  testConnection: async ({ config }) => {
    const configError = invalidConfig(config);
    if (configError !== null) return err(configError);
    try {
      const response = await authenticatedFetch(fetcher, invoiceListUrl(today()), config);
      const payload: unknown = await response.json().catch(() => null);
      const providerResponse = providerResponseSchema.safeParse(payload);
      if (!response.ok || (providerResponse.success && providerResponse.data.response.Kod !== 0)) {
        return err(providerError(
          response.status,
          providerResponse.success ? providerResponse.data.response.Kod : null,
          providerResponse.success ? providerResponse.data.response.Informacja : undefined,
          'test the connection',
        ));
      }
      return providerResponse.success
        ? ok({ diagnostic: 'iFirma accepted the username and faktura API key.' })
        : err(validation('iFirma returned an invalid connection-test response.'));
    } catch {
      return err(unreachable('the connection test'));
    }
  },
});
