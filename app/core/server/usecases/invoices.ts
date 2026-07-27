import {
  err,
  forbidden,
  integrationNotConfigured,
  notFound,
  ok,
  tenantNotFound,
  validation,
  type AppError,
  type BillingData,
  type Invoice,
  type InvoiceEvent,
  type Order,
  type OrderListItem,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  IdGenerator,
  InvoiceRepository,
  InvoicingPort,
  OrderDetailRepository,
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

const invoicingConfig = async (
  tenantId: string,
  deps: Pick<InvoiceDeps, 'tenantSecrets' | 'secretCrypto'>,
): Promise<Result<{ apiKey: string; subdomain: string }, AppError>> => {
  const [apiKeySecret, subdomainSecret] = await Promise.all([
    deps.tenantSecrets.findByKey(tenantId, 'fakturownia.apiKey'),
    deps.tenantSecrets.findByKey(tenantId, 'fakturownia.subdomain'),
  ]);
  if (apiKeySecret === null || subdomainSecret === null) {
    return err(integrationNotConfigured('Connect Fakturownia in Integrations before issuing invoices'));
  }
  const apiKey = deps.secretCrypto.decrypt(apiKeySecret);
  if (!apiKey.ok) return apiKey;
  const subdomain = deps.secretCrypto.decrypt(subdomainSecret);
  return subdomain.ok ? ok({ apiKey: apiKey.value, subdomain: subdomain.value }) : subdomain;
};

const issue = async (
  tenantId: string,
  order: OrderListItem,
  billing: BillingData | null,
  deps: InvoiceDeps,
): Promise<Result<Invoice, AppError>> => {
  const existing = await deps.invoices.findCurrentByOrder(tenantId, order.id);
  if (existing !== null && existing.status !== 'failed') return ok(existing);
  const createdAt = deps.clock.nowIso();
  const invoice: Invoice = {
    id: deps.ids.nextId(),
    tenantId,
    orderId: order.id,
    status: 'requested',
    provider: 'fakturownia',
    providerInvoiceId: null,
    invoiceNumber: null,
    pdfUrl: null,
    error: null,
    issuedAt: null,
    createdAt,
  };
  const requested = eventFor(deps, tenantId, order.id, invoice.id, 'requested');
  if (!(await deps.invoices.create(tenantId, invoice, requested))) {
    const winner = await deps.invoices.findCurrentByOrder(tenantId, order.id);
    return winner === null ? err(validation('Invoice request could not be claimed')) : ok(winner);
  }
  const fail = async (failure: AppError): Promise<Result<Invoice, AppError>> => {
    const failed: Invoice = { ...invoice, status: 'failed', error: failure.code };
    const failedEvent = eventFor(deps, tenantId, order.id, invoice.id, 'failed', failure.code, {
      message: failure.message,
    });
    await deps.invoices.update(tenantId, failed, failedEvent);
    return err(failure);
  };
  const config = await invoicingConfig(tenantId, deps);
  if (!config.ok) return fail(config.error);
  const issued = await deps.invoicing.issueInvoice({
    order,
    billing,
    productName: order.productTitle,
    config: config.value,
  });
  if (!issued.ok) return fail(issued.error);
  const completed: Invoice = {
    ...invoice,
    status: issued.value.status,
    providerInvoiceId: issued.value.providerInvoiceId,
    invoiceNumber: issued.value.invoiceNumber,
    pdfUrl: issued.value.pdfUrl,
    issuedAt: deps.clock.nowIso(),
  };
  const completedEvent = eventFor(deps, tenantId, order.id, invoice.id, issued.value.status, null, {
    providerInvoiceId: issued.value.providerInvoiceId,
  });
  await deps.invoices.update(tenantId, completed, completedEvent);
  return ok(completed);
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
  if (order.billing == null) return err(validation('Add billing data before issuing an invoice'));
  return issue(ctx.identity.tenantId, order, order.billing, deps);
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
