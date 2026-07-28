import {
  err,
  forbidden,
  integrationNotConfigured,
  notFound,
  ok,
  renderFa3Invoice,
  tenantNotFound,
  validateFa3Structure,
  validation,
  type AppError,
  type BillingData,
  type Invoice,
  type InvoiceEvent,
  type KsefEnvironment,
  type Order,
  type OrderListItem,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  ContentHash,
  Fa3Validator,
  FiscalArtifactRepository,
  IdGenerator,
  InvoiceRepository,
  InvoicingPort,
  OrderDetailRepository,
  KsefCredentialResolver,
  KsefClientPort,
  KsefInvoicePdf,
  KsefNumberRepository,
  SecretCrypto,
  TenantRepository,
  TenantSecretRepository,
} from '../ports.js';

export interface InvoiceDeps {
  invoices: InvoiceRepository;
  invoicing: InvoicingPort;
  orderDetails: OrderDetailRepository;
  tenants: TenantRepository;
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  ids: IdGenerator;
  clock: Clock;
  ksef?: {
    environment: KsefEnvironment;
    credentials: KsefCredentialResolver;
    numbers: KsefNumberRepository;
    artifacts: FiscalArtifactRepository;
    hash: ContentHash;
    validator: Fa3Validator;
    pdf?: KsefInvoicePdf;
    client: KsefClientPort;
  };
}

const eventFor = (
  deps: Pick<InvoiceDeps, 'ids' | 'clock'>,
  tenantId: string,
  orderId: string,
  invoiceId: string | null,
  type: InvoiceEvent['type'],
  error: string | null = null,
  meta: Record<string, unknown> = {},
): InvoiceEvent => ({
  id: deps.ids.nextId(),
  tenantId,
  invoiceId,
  orderId,
  type,
  error,
  meta,
  occurredAt: deps.clock.nowIso(),
});

const warsawDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

const invoicingConfig = async (
  tenantId: string,
  deps: Pick<InvoiceDeps, 'tenantSecrets' | 'secretCrypto'>,
): Promise<Result<{ invoiceApiKey: string; username: string }, AppError>> => {
  const [invoiceApiKeySecret, usernameSecret] = await Promise.all([
    deps.tenantSecrets.findByKey(tenantId, 'ifirma.invoiceApiKey'),
    deps.tenantSecrets.findByKey(tenantId, 'ifirma.username'),
  ]);
  if (invoiceApiKeySecret === null || usernameSecret === null) {
    return err(integrationNotConfigured('Connect iFirma in Integrations before issuing invoices'));
  }
  const invoiceApiKey = deps.secretCrypto.decrypt(invoiceApiKeySecret);
  if (!invoiceApiKey.ok) return invoiceApiKey;
  const username = deps.secretCrypto.decrypt(usernameSecret);
  return username.ok
    ? ok({ invoiceApiKey: invoiceApiKey.value, username: username.value })
    : username;
};

const issueIfirma = async (
  tenantId: string,
  order: OrderListItem,
  billing: BillingData | null,
  deps: InvoiceDeps,
): Promise<Result<Invoice, AppError>> => {
  const existing = await deps.invoices.findCurrentByOrder(tenantId, order.id);
  if (existing !== null && existing.provider !== 'ifirma') return ok(existing);
  if (existing !== null && existing.status !== 'failed') return ok(existing);
  if (
    existing?.status === 'failed' &&
    existing.providerInvoiceId === null &&
    existing.error === 'provider_create_uncertain'
  ) {
    return err(validation('iFirma may already have created this invoice. Verify it in iFirma before retrying.'));
  }
  const createdAt = deps.clock.nowIso();
  let invoice: Invoice = existing === null
    ? {
        id: deps.ids.nextId(),
        tenantId,
        orderId: order.id,
        status: 'requested',
        provider: 'ifirma',
        providerInvoiceId: null,
        invoiceNumber: null,
        pdfUrl: null,
        error: null,
        issuedAt: null,
        createdAt,
      }
    : { ...existing, status: 'requested', error: null };
  const requested = eventFor(deps, tenantId, order.id, invoice.id, 'requested');
  const claimed = existing === null
    ? await deps.invoices.create(tenantId, invoice, requested)
    : await deps.invoices.claimRetry(tenantId, invoice, requested);
  if (!claimed) {
    const winner = await deps.invoices.findCurrentByOrder(tenantId, order.id);
    return winner === null ? err(validation('Invoice request could not be claimed')) : ok(winner);
  }
  let providerCreateUncertain = false;
  const fail = async (failure: AppError): Promise<Result<Invoice, AppError>> => {
    const projectionError = providerCreateUncertain && invoice.providerInvoiceId === null
      ? 'provider_create_uncertain'
      : failure.code;
    const failed: Invoice = { ...invoice, status: 'failed', error: projectionError };
    const failedEvent = eventFor(deps, tenantId, order.id, invoice.id, 'failed', failure.code, {
      message: failure.message,
    });
    await deps.invoices.update(tenantId, failed, failedEvent);
    return err(failure);
  };
  const config = await invoicingConfig(tenantId, deps);
  if (!config.ok) return fail(config.error);
  const settings = await deps.tenants.findSettings(tenantId);
  if (settings?.invoiceVatRatePercent == null) {
    return fail(validation('Set the tenant VAT rate in Settings before issuing invoices'));
  }
  const issued = await deps.invoicing.issueInvoice({
    order,
    billing,
    productName: order.productTitle,
    vatRatePercent: settings.invoiceVatRatePercent,
    providerInvoiceId: invoice.providerInvoiceId,
    onProviderInvoiceCreateUncertain: async () => {
      providerCreateUncertain = true;
    },
    onProviderInvoiceCreated: async (providerInvoiceId) => {
      invoice = { ...invoice, providerInvoiceId };
      const providerCreated = eventFor(
        deps,
        tenantId,
        order.id,
        invoice.id,
        'provider_created',
        null,
        { providerInvoiceId },
      );
      const persisted = await deps.invoices.update(tenantId, invoice, providerCreated);
      if (persisted === null) throw new Error('Invoice provider identifier could not be persisted');
      invoice = persisted;
    },
    config: config.value,
  });
  if (!issued.ok) return fail(issued.error);
  const completed: Invoice = {
    ...invoice,
    status: issued.value.status,
    providerInvoiceId: issued.value.providerInvoiceId,
    invoiceNumber: issued.value.invoiceNumber,
    pdfUrl: null,
    issuedAt: deps.clock.nowIso(),
  };
  const completedEvent = eventFor(deps, tenantId, order.id, invoice.id, issued.value.status, null, {
    providerInvoiceId: issued.value.providerInvoiceId,
  });
  await deps.invoices.update(tenantId, completed, completedEvent);
  return ok(completed);
};

const issueKsef = async (
  tenantId: string,
  order: OrderListItem,
  billing: BillingData | null,
  deps: InvoiceDeps,
): Promise<Result<Invoice, AppError>> => {
  if (deps.ksef === undefined || deps.invoices.createFrozenKsef === undefined) {
    return err(integrationNotConfigured('KSeF submission is unavailable in this deployment'));
  }
  const existing = await deps.invoices.findCurrentByOrder(tenantId, order.id);
  if (existing !== null && existing.provider !== 'ksef') return ok(existing);
  if (existing !== null) return ok(existing);
  if (order.currency !== 'PLN') return err(validation('KSeF invoices require an order ledger amount in PLN'));
  if (billing?.country !== undefined && billing.country !== 'PL') {
    return err(validation('KSeF domestic invoices require a Polish billing address'));
  }
  const settings = await deps.tenants.findSettings(tenantId);
  if (settings?.invoiceVatRatePercent == null) {
    return err(validation('Set the tenant VAT rate in Settings before issuing invoices'));
  }
  if (settings.invoiceSellerName == null || settings.invoiceSellerAddress == null) {
    return err(validation('Set the invoice seller name and address before issuing through KSeF'));
  }
  const credentials = await deps.ksef.credentials.resolve(tenantId);
  if (!credentials.ok) return credentials;
  const createdAt = deps.clock.nowIso();
  const issueDate = warsawDate(createdAt);
  const allocated = await deps.ksef.numbers.allocate(tenantId, {
    orderId: order.id,
    invoiceType: 'VAT',
    year: Number(issueDate.slice(0, 4)),
    allocatedAt: createdAt,
  });
  const invoiceId = deps.ids.nextId();
  const xml = renderFa3Invoice({
    invoiceNumber: allocated.p2,
    issueDate,
    generatedAt: createdAt,
    seller: {
      nip: credentials.value.contextNip,
      name: settings.invoiceSellerName,
      addressLine: settings.invoiceSellerAddress,
    },
    buyer: billing === null
      ? null
      : {
          nip: billing.nip,
          name: billing.companyName,
          addressLine: `${billing.address}, ${billing.postalCode} ${billing.city}`,
        },
    productName: order.productTitle,
    grossAmountCents: order.amountCents,
    discountCents: order.discountCents,
    vatRatePercent: settings.invoiceVatRatePercent,
  });
  const structural = validateFa3Structure(xml);
  if (!structural.ok) return err(validation('Generated FA(3) failed local validation', structural.errors));
  const xsd = await deps.ksef.validator.validate(xml);
  if (!xsd.ok) return xsd;
  const xmlSha256 = deps.ksef.hash.sha256(xml);
  const xmlArtifactKey = `invoice/${invoiceId}/fa3.xml`;
  const invoice: Invoice = {
    id: invoiceId,
    tenantId,
    orderId: order.id,
    status: 'queued',
    provider: 'ksef',
    providerInvoiceId: null,
    invoiceNumber: allocated.p2,
    pdfUrl: null,
    error: null,
    issuedAt: null,
    createdAt,
    ksef: {
      environment: deps.ksef.environment,
      schemaSystemCode: 'FA (3)',
      schemaVersion: '1-0E',
      contextNip: credentials.value.contextNip,
      sellerName: settings.invoiceSellerName,
      sellerAddress: settings.invoiceSellerAddress,
      p2: allocated.p2,
      invoiceType: 'VAT',
      issueDate,
      xmlArtifactKey,
      xmlByteSize: new TextEncoder().encode(xml).byteLength,
      xmlSha256,
      state: 'queued',
      authConfigVersion: 1,
      sessionReference: null,
      invoiceReference: null,
      ksefNumber: null,
      lastStatusCode: null,
      lastStatusDescription: null,
      lastStatusDetails: [],
      lastStatusExtensions: {},
      lastPolledAt: null,
      acquisitionAt: null,
      invoicingAt: null,
      permanentStorageAt: null,
      upoArtifactKey: null,
      upoSha256: null,
      upoRetrievedAt: null,
      originalSessionReference: null,
      originalKsefNumber: null,
      lastTransportError: null,
      retryAt: null,
      attempt: 0,
      correlationChecks: 0,
      version: 0,
    },
  };
  const frozen = eventFor(deps, tenantId, order.id, invoice.id, 'frozen', null, {
    p2: allocated.p2,
    xmlSha256,
  });
  const stored = await deps.invoices.createFrozenKsef(
    tenantId,
    invoice,
    frozen,
    {
      key: xmlArtifactKey,
      tenantId,
      invoiceId,
      kind: 'fa3',
      content: xml,
      sha256: xmlSha256,
      byteSize: invoice.ksef?.xmlByteSize ?? 0,
      createdAt,
    },
    {
      id: deps.ids.nextId(),
      tenantId,
      invoiceId,
      status: 'queued',
      attempts: 0,
      nextAttemptAt: createdAt,
      lockedAt: null,
      lastError: null,
      createdAt,
    },
  );
  if (stored) return ok(invoice);
  const winner = await deps.invoices.findCurrentByOrder(tenantId, order.id);
  return winner === null ? err(validation('KSeF invoice request could not be claimed')) : ok(winner);
};

const issue = async (
  tenantId: string,
  order: OrderListItem,
  billing: BillingData | null,
  deps: InvoiceDeps,
): Promise<Result<Invoice, AppError>> => {
  const settings = await deps.tenants.findSettings(tenantId);
  if ((settings?.invoicingProvider ?? 'ifirma') === 'ksef') {
    return issueKsef(tenantId, order, billing, deps);
  }
  return issueIfirma(tenantId, order, billing, deps);
};

export const downloadInvoice = async (
  ctx: Ctx,
  invoiceId: string,
  deps: InvoiceDeps,
): Promise<Result<{ content: Uint8Array; contentType: 'application/pdf'; filename: string }, AppError>> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound());
  if (ctx.identity.staffRole === null) return err(forbidden());
  const invoice = await deps.invoices.findById(ctx.identity.tenantId, invoiceId);
  if (invoice === null) return err(notFound('Invoice was not found'));
  if (invoice.provider === 'ksef') {
    if (invoice.ksef === null || invoice.ksef === undefined || deps.ksef?.pdf === undefined) {
      return err(validation('The KSeF invoice visualization is unavailable'));
    }
    const artifact = await deps.ksef.artifacts.findByKey(
      ctx.identity.tenantId,
      invoice.ksef.xmlArtifactKey,
    );
    if (artifact === null || deps.ksef.hash.sha256(artifact.content) !== invoice.ksef.xmlSha256) {
      return err(validation('The frozen KSeF invoice artifact failed its integrity check'));
    }
    const filenameBase = invoice.ksef.p2.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return ok({
      content: deps.ksef.pdf.render({ invoice, xml: artifact.content }),
      contentType: 'application/pdf',
      filename: `${filenameBase}.pdf`,
    });
  }
  if (invoice.providerInvoiceId === null) return err(validation('The provider has not created this invoice yet'));
  const config = await invoicingConfig(ctx.identity.tenantId, deps);
  if (!config.ok) return config;
  const downloaded = await deps.invoicing.downloadInvoice({
    providerInvoiceId: invoice.providerInvoiceId,
    config: config.value,
  });
  if (!downloaded.ok) return downloaded;
  const filenameBase = (invoice.invoiceNumber ?? `invoice-${invoice.id}`).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return ok({ ...downloaded.value, filename: `${filenameBase}.pdf` });
};

export const downloadMemberInvoice = async (
  ctx: Ctx,
  invoiceId: string,
  deps: InvoiceDeps,
): Promise<Result<{ content: Uint8Array; contentType: 'application/pdf'; filename: string }, AppError>> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound());
  if (ctx.identity.memberId === null) return err(forbidden('Only the invoice buyer can download it'));
  if (deps.invoices.findByIdForMember === undefined) {
    return err(integrationNotConfigured('Member invoice downloads are unavailable'));
  }
  const invoice = await deps.invoices.findByIdForMember(
    ctx.identity.tenantId,
    ctx.identity.memberId,
    invoiceId,
  );
  if (invoice === null) return err(notFound('Invoice was not found'));
  if (invoice.status !== 'issued' && invoice.status !== 'delivered') {
    return err(validation('The invoice has not been issued yet'));
  }
  if (invoice.provider !== 'ksef' || invoice.ksef === null || invoice.ksef === undefined
    || deps.ksef?.pdf === undefined) {
    return err(validation('The member invoice visualization is unavailable'));
  }
  const artifact = await deps.ksef.artifacts.findByKey(
    ctx.identity.tenantId,
    invoice.ksef.xmlArtifactKey,
  );
  if (artifact === null || deps.ksef.hash.sha256(artifact.content) !== invoice.ksef.xmlSha256) {
    return err(validation('The frozen KSeF invoice artifact failed its integrity check'));
  }
  return ok({
    content: deps.ksef.pdf.render({ invoice, xml: artifact.content }),
    contentType: 'application/pdf',
    filename: `${invoice.ksef.p2.replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`,
  });
};

export const downloadInvoiceUpo = async (
  ctx: Ctx,
  invoiceId: string,
  deps: Pick<InvoiceDeps, 'invoices' | 'ksef'>,
): Promise<Result<{ content: Uint8Array; contentType: 'application/xml'; filename: string }, AppError>> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound());
  if (ctx.identity.staffRole === null) return err(forbidden());
  const invoice = await deps.invoices.findById(ctx.identity.tenantId, invoiceId);
  if (invoice?.ksef?.upoArtifactKey == null || invoice.ksef.upoSha256 === null
    || deps.ksef === undefined) {
    return err(notFound('KSeF UPO was not found'));
  }
  const artifact = await deps.ksef.artifacts.findByKey(
    ctx.identity.tenantId,
    invoice.ksef.upoArtifactKey,
  );
  if (artifact === null || artifact.sha256 !== invoice.ksef.upoSha256
    || deps.ksef.hash.sha256(artifact.content) !== invoice.ksef.upoSha256) {
    return err(validation('The stored KSeF UPO failed its integrity check'));
  }
  return ok({
    content: new TextEncoder().encode(artifact.content),
    contentType: 'application/xml',
    filename: `${invoice.ksef.p2.replace(/[^a-zA-Z0-9._-]+/g, '_')}-UPO.xml`,
  });
};

export const requestInvoice = async (
  ctx: Ctx,
  orderId: string,
  deps: InvoiceDeps,
): Promise<Result<Invoice, AppError>> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound());
  if (ctx.identity.staffRole === null) return err(forbidden('Only tenant staff can issue invoices'));
  const order = await deps.orderDetails.findById(ctx.identity.tenantId, orderId);
  if (order === null) return err(notFound('Order was not found'));
  return issue(ctx.identity.tenantId, order, order.billing ?? null, deps);
};

export const autoIssueOnPayment = async (
  tenantId: string,
  order: Order,
  deps: InvoiceDeps,
): Promise<void> => {
  try {
    const settings = await deps.tenants.findSettings(tenantId);
    if (settings?.autoIssueInvoices !== true) return;
    if ((settings.autoIssueInvoiceScope ?? 'b2b_only') === 'b2b_only' && order.billing?.nip == null) {
      const skipped = eventFor(deps, tenantId, order.id, null, 'skipped', null, {
        reason: 'b2b_only',
      });
      await deps.invoices.appendEvent(tenantId, skipped);
      return;
    }
    const detail = await deps.orderDetails.findById(tenantId, order.id);
    if (detail === null) return;
    await issue(tenantId, detail, order.billing ?? null, deps);
  } catch {
    return;
  }
};

export const refreshInvoiceStatus = async (
  ctx: Ctx,
  invoiceId: string,
  deps: InvoiceDeps,
): Promise<Result<Invoice, AppError>> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound());
  if (ctx.identity.staffRole === null) return err(forbidden());
  const invoice = await deps.invoices.findById(ctx.identity.tenantId, invoiceId);
  if (invoice === null) return err(notFound('Invoice was not found'));
  if (invoice.provider === 'ksef') return ok(invoice);
  if (invoice.providerInvoiceId === null) return ok(invoice);
  const config = await invoicingConfig(ctx.identity.tenantId, deps);
  if (!config.ok) return config;
  const status = await deps.invoicing.getInvoiceStatus({
    providerInvoiceId: invoice.providerInvoiceId,
    config: config.value,
  });
  if (!status.ok) return status;
  const refreshed: Invoice = {
    ...invoice,
    status: status.value,
    error: status.value === 'failed' ? 'provider_failed' : null,
  };
  const refreshedEvent = eventFor(
    deps,
    ctx.identity.tenantId,
    invoice.orderId,
    invoice.id,
    'refreshed',
    refreshed.error,
    { status: status.value },
  );
  return ok((await deps.invoices.update(ctx.identity.tenantId, refreshed, refreshedEvent)) ?? refreshed);
};

export const testIfirmaConnection = async (
  ctx: Ctx,
  deps: Pick<InvoiceDeps, 'invoicing' | 'tenantSecrets' | 'secretCrypto'>,
): Promise<Result<{ ok: true; diagnostic: string }, AppError>> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound('Select a tenant to test iFirma'));
  if (ctx.identity.staffRole !== 'owner') {
    return err(forbidden('Only the tenant owner can test iFirma'));
  }
  const config = await invoicingConfig(ctx.identity.tenantId, deps);
  if (!config.ok) return config;
  const tested = await deps.invoicing.testConnection({ config: config.value });
  return tested.ok ? ok({ ok: true, diagnostic: tested.value.diagnostic }) : tested;
};

export const testKsefConnection = async (
  ctx: Ctx,
  deps: Pick<InvoiceDeps, 'ksef'>,
): Promise<Result<{ ok: true; diagnostic: string }, AppError>> => {
  if (ctx.identity.tenantId === null) return err(tenantNotFound('Select a tenant to test KSeF'));
  if (ctx.identity.staffRole !== 'owner') {
    return err(forbidden('Only the tenant owner can test KSeF'));
  }
  if (deps.ksef === undefined) {
    return err(integrationNotConfigured('KSeF is unavailable in this deployment'));
  }
  const credentials = await deps.ksef.credentials.resolve(ctx.identity.tenantId);
  if (!credentials.ok) return credentials;
  const tested = await deps.ksef.client.validateCredentials({
    environment: deps.ksef.environment,
    credentials: credentials.value,
  });
  return tested.ok ? ok({ ok: true, diagnostic: tested.value.diagnostic }) : tested;
};
