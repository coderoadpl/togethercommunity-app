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
   `issueInvoice(order)`, `getInvoiceStatus(ref)`, `invoiceDownloadUrl(ref)`.
   Invoice lifecycle rows follow the projection+events convention
   (`invoices` + email_events-style lifecycle: requested → issued → delivered
   | failed, with provider refs in meta). Issuance is tenant-triggered
   (panel action on the order) or auto-on-payment (tenant toggle, default
   off) — never platform-automatic without tenant opt-in.
3. **iFirma adapter (v1 provider — owner decision 2026-07-27, replaces the
   earlier Fakturownia pick).** Rationale: the owner uses iFirma personally,
   so the integration is verifiable end-to-end on a real account. BYO API
   credentials per tenant (tenant_secrets `ifirma.*` keys (invoice API key + username), AES-GCM as
   Stripe/Bunny/SES). iFirma issues the invoice, handles KSeF submission
   itself (tenant configures KSeF inside iFirma — certificates never touch
   us), returns invoice number + PDF; we store refs and surface status.
4. **Direct KSeF adapter (COMMITTED follow-up slice — owner: "jedno i
   drugie").** Same InvoicingPort; FA(3) XML generation + KSeF 2.0 API on a
   tenant-generated KSeF token/certificate (tenant_secrets custody — KSeF has
   no OAuth, key custody is inherent, which is also why the adapter layer
   stays valuable). Sequence: short SPIKE against the open ksef-test sandbox
   first (token auth, submit one FA(3), fetch UPO — no legal effects there),
   then the adapter with own numbering + own PDF visualization + B2C
   own-PDF path; corrections stay deferred. E2E targets ksef-test.

## Slice scope (implementation order)

- Billing capture end-to-end (checkout → order → Sales/export → member view),
  PL/EN, NIP validation, tests incl. fiscal-immutability.
- `invoices` model + InvoicingPort + panel order action ("Wystaw fakturę") +
  status chip + download link; auto-issue toggle per tenant (default off).
- Fakturownia adapter: issue (VAT invoice, positions from order incl. coupon
  discount as a separate line note when present), status poll, error surfaces
  (bad key, validation) with actionable panel copy; test-mode support for
  e2e (fake adapter in dev, contract tests against recorded shapes).
- Docs: tenant runbook — connect Fakturownia (API key, KSeF inside
  Fakturownia), what auto-issue does, B2C-on-request workflow (issue from
  the order detail within the 3-month window).
- Anomaly guard: order without billing data + tenant auto-issue on → issue
  a "paragon-like" B2C invoice per Fakturownia defaults or skip with a
  panel notice (tenant setting: `auto_issue_scope: b2b_only | all`,
  default b2b_only).

## Out of scope (v1)

Self-billing, corrective invoices UI beyond a link-out to Fakturownia,
multi-currency fiscal logic (orders are PLN today), platform-level VAT
registration (tenant is the seller of record — consistent with the
controller/processor posture), OSS/MOSS.

## Interplay

- Coupons: invoice positions reflect the discounted amounts from the order
  ledger (single source of truth); no separate discount accounting here.
- Erasure: invoices are fiscal records — erasure NEVER deletes them; member
  pseudonymization leaves invoice rows intact (legal basis: fiscal retention
  obligations), documented alongside B14.
