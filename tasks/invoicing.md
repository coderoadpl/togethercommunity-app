# Invoicing & billing data (B11) — contract (delegated decisions, 2026-07-27)

> Owner confirmed B11 as a must (2026-07-26) and delegated design decisions.
> Sequenced BEFORE the first real production tenant; implementation queued
> after the coupons slice. Layered per the BYO philosophy: the platform holds
> as little fiscal machinery as possible, the tenant's own invoicing service
> talks to KSeF.

## Layered shape (decision)

1. **Billing capture (core, this slice).** Checkout gains an optional
   "Potrzebuję faktury" reveal: NIP (validated: checksum + 10 digits),
   company name, address, postal code, city, country (default PL). B2C can
   leave it closed; B2B fills it. Data lands on the order
   (`orders.billing` jsonb or dedicated columns), is visible in panel Sales
   (order detail + export CSV/JSON), and is immutable post-payment (fiscal
   data snapshot). Member /account shows billing data of their own orders.
2. **InvoicingPort (core, this slice).** Port with a narrow surface:
   `issueInvoice(order)`, `getInvoiceStatus(ref)`, `downloadInvoice(ref)`.
   Invoice lifecycle rows follow the projection+events convention
   (`invoices` + email_events-style lifecycle: requested → provider_created → issued → delivered
   | failed, with provider refs in meta). Issuance is tenant-triggered
   (panel action on the order) or auto-on-payment (tenant toggle, default
   off) — never platform-automatic without tenant opt-in.
3. **iFirma adapter (v1 provider).** BYO API credentials per tenant
   (tenant_secrets `ifirma.invoiceApiKey` + `ifirma.username`, AES-GCM as
   Stripe/Bunny/SES). iFirma issues the invoice and handles KSeF submission
   itself (the tenant configures KSeF inside iFirma — their certificate
   never touches us), returns the invoice number and authenticated PDF; we
   store refs, proxy downloads, and surface status. Rationale: creators get KSeF compliance in minutes, the
   platform never becomes fiscal infrastructure.
4. **Direct KSeF adapter (deferred, port-shaped).** Same InvoicingPort; FA(3)
   XML generation + tenant KSeF token. Deliberately NOT v1: certificate
   custody, environment matrix (test/demo/prod), and error semantics are a
   liability while iFirma covers the need. Revisit when a tenant
   demands no-third-party invoicing.

## Slice scope (implementation order)

- Billing capture end-to-end (checkout → order → Sales/export → member view),
  PL/EN, NIP validation, tests incl. fiscal-immutability.
- `invoices` model + InvoicingPort + panel order action ("Wystaw fakturę") +
  status chip + download link; auto-issue toggle per tenant (default off).
- iFirma adapter: issue (domestic VAT invoice, positions from order incl. coupon
  discount as a separate line note when present), status poll, error surfaces
  (bad key, validation) with actionable panel copy; test-mode support for
  e2e (fake adapter in dev, contract tests against recorded shapes).
- Docs: tenant runbook — connect iFirma (username and `faktura` API key, KSeF inside
  iFirma), select the tenant VAT rate, what auto-issue does, B2C-on-request workflow (issue from
  the order detail within the 3-month window).
- Anomaly guard: order without billing data + tenant auto-issue on → issue
  a B2C domestic invoice through iFirma or skip with a
  panel notice (tenant setting: `auto_issue_scope: b2b_only | all`,
  default b2b_only).

## Out of scope (v1)

Self-billing, corrective invoices UI beyond a link-out to iFirma,
multi-currency fiscal logic (orders are PLN today), platform-level VAT
registration and VAT-rate determination (the tenant is the seller of record and must select
the applicable supported rate before issuance — consistent with the
controller/processor posture), OSS/MOSS.

## Interplay

- Coupons: invoice positions reflect the discounted amounts from the order
  ledger (single source of truth); no separate discount accounting here.
- Erasure: invoices are fiscal records — erasure NEVER deletes them; member
  pseudonymization leaves invoice rows intact (legal basis: fiscal retention
  obligations), documented alongside B14.
