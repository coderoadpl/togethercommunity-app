import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { createKsefClient } from '@adapters/invoicing/ksef.js';
import { renderFa3Invoice } from '@core/domain/index.js';

const configSchema = z.object({
  KSEF_TEST_TOKEN: z.string().min(1),
  KSEF_TEST_CONTEXT_NIP: z.string().regex(/^\d{10}$/),
});

const config = configSchema.parse(process.env);
const client = createKsefClient({
  baseUrls: {
    test: 'https://api-test.ksef.mf.gov.pl/v2',
    production: 'https://api.ksef.mf.gov.pl/v2',
  },
});
const credentials = {
  token: config.KSEF_TEST_TOKEN,
  contextNip: config.KSEF_TEST_CONTEXT_NIP,
};
const generatedAt = new Date().toISOString();
const invoiceNumber = `E2E/${generatedAt.replace(/\D/gu, '').slice(0, 14)}/${randomBytes(4).toString('hex')}`;
const xml = renderFa3Invoice({
  invoiceNumber,
  issueDate: generatedAt.slice(0, 10),
  generatedAt,
  seller: {
    nip: config.KSEF_TEST_CONTEXT_NIP,
    name: 'Together KSeF Test Seller',
    addressLine: 'ul. Testowa 1, 00-001 Warszawa',
  },
  buyer: null,
  productName: 'Together KSeF integration test',
  grossAmountCents: 123,
  discountCents: 0,
  vatRatePercent: 23,
});
const opened = await client.openSession({ environment: 'test', credentials });
if (!opened.ok) throw new Error(opened.error.message);
const submitted = await client.submitInvoice({
  environment: 'test',
  credentials,
  sessionReference: opened.value.sessionReference,
  xml,
  invoiceHashHex: createHash('sha256').update(xml).digest('hex'),
});
if (!submitted.ok) throw new Error(submitted.error.message);
let ksefNumber: string | null = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const status = await client.getInvoiceStatus({
    environment: 'test',
    credentials,
    sessionReference: opened.value.sessionReference,
    invoiceReference: submitted.value.invoiceReference,
  });
  if (!status.ok) throw new Error(status.error.message);
  if (status.value.code === 200) {
    ksefNumber = status.value.ksefNumber;
    break;
  }
  if (status.value.code >= 400) {
    throw new Error(`${String(status.value.code)} ${status.value.description}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (ksefNumber === null) throw new Error('KSeF invoice did not reach status 200');
const upo = await client.downloadUpo({
  environment: 'test',
  credentials,
  sessionReference: opened.value.sessionReference,
  invoiceReference: submitted.value.invoiceReference,
  ksefNumber,
});
if (!upo.ok) throw new Error(upo.error.message);
const closed = await client.closeSession({
  environment: 'test',
  credentials,
  sessionReference: opened.value.sessionReference,
});
if (!closed.ok) throw new Error(closed.error.message);
process.stdout.write(`${JSON.stringify({
  invoiceNumber,
  ksefNumber,
  upoSha256: createHash('sha256').update(upo.value).digest('hex'),
})}\n`);
