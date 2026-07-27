# iFirma and invoices

Together delegates VAT invoice issuance to the tenant's iFirma account. The tenant remains the seller of record. Together stores the paid order ledger, immutable billing snapshot, iFirma document reference, assigned invoice number, and lifecycle events.

Together can also submit FA(3) invoices directly to KSeF 2.0. Direct KSeF uses Together's own immutable per-tenant P_2 numbering, stores the exact XML and SHA-256 before transport, and processes every network step asynchronously.

## Connect iFirma

1. Sign in to iFirma and open the account API configuration.
2. Enable the API and generate the symmetric key named `faktura`. The other named keys (`abonent`, `rachunek`, and `wydatek`) do not authorize invoice operations.
3. Configure KSeF inside iFirma. KSeF credentials and certificates stay in iFirma and never reach Together.
4. In Together, open **Integrations → iFirma**.
5. Save the iFirma username and the `faktura` API key. Both fields are write-only: after saving, Together displays only masked previews.
6. Select **Test connection**. The test performs an authenticated, read-only invoice-list request and does not create a document.
7. In **Settings → Automatic invoices**, select the tenant's applicable VAT rate. Together supports 5%, 8%, and 23% domestic invoices in v1 and refuses issuance until a rate is selected.
8. Complete a paid test order with billing data, open it in **Sales**, and select **Issue invoice**.

If the connection test reports rejected credentials, verify the login, confirm that the saved key is the `faktura` key, and generate a replacement key in iFirma if necessary. A validation error means iFirma accepted authentication but rejected the account configuration or document data. An unavailable error indicates a network or iFirma technical failure and can be retried.

## What Together sends

Together creates a paid domestic VAT invoice in PLN for a Polish billing address. Its position uses the final gross amount stored in the paid order ledger, not a current product price. When a coupon was applied, the Polish position note includes the discount amount from the order ledger. The buyer comes from the immutable checkout billing snapshot; a B2B buyer includes the NIP, while a B2C buyer does not.

iFirma assigns the fiscal number. Together persists the iFirma identifier immediately after creation, then reads the document back by that identifier. A retry resumes from the stored identifier and never creates a second fiscal document. If the create request loses its response before an identifier can be stored, Together blocks automatic retry and directs staff to reconcile the document in iFirma first. PDF downloads are fetched by Together with the tenant credentials and streamed to the authenticated staff browser.

iFirma requires query parameters to be excluded from the URL used to calculate its HMAC authentication header. The adapter follows the [official authentication-header specification](https://api.ifirma.pl/naglowek-autoryzacji/).

## Automatic issuance

Automatic issuance is off by default. The owner can enable it under **Settings → Automatic invoices** and select one scope:

- **B2B only** issues an invoice only when the paid order billing snapshot contains a NIP. Paid B2C orders are recorded as skipped.
- **All orders** also issues a B2C invoice when no NIP is present. If the checkout had no billing snapshot, Together sends an individual retail-buyer record without a NIP.

Automatic issuance runs outside the payment-webhook response path after payment fulfillment. Provider requests time out after eight seconds. An iFirma failure never rolls back the purchase, payment, or access grant. The failed invoice projection and lifecycle event remain available for diagnosis and retry. Subscription renewal orders carry the original billing snapshot and are eligible for the same automatic or staff-triggered issuance flow.

## B2C invoices on request

A buyer can reveal the invoice fields during checkout and supply a name and address without a NIP. Staff can issue that B2C invoice from the paid order detail during the applicable three-month request window.

If the buyer did not request an invoice during checkout, the paid order has no billing snapshot and Together cannot add or edit one after payment. Handle that exceptional request directly in iFirma within the applicable legal window, using the paid order ledger as the amount source.

## Retention and erasure

Paid-order billing snapshots are immutable. Invoices and their append-only lifecycle events are fiscal records. Member erasure pseudonymizes the member but does not delete invoice rows or their order relationship.

## Direct KSeF 2.0

### Generate and connect a token

1. Sign in to KSeF in the tenant's NIP context.
2. Open the token management screen and generate a token with `InvoiceWrite`. Token permissions cannot be changed later; replace the token if the permission set must change.
3. Copy the token when KSeF displays it. KSeF shows its secret value only once.
4. In Together, open **Settings → Automatic invoices** and select **Direct KSeF**.
5. Save the context NIP and KSeF token. Both are write-only tenant secrets; Together subsequently shows only masked previews.
6. Save the seller name, seller address, and applicable VAT rate.
7. Select **Test connection**. Together performs the real KSeF challenge, RSA-OAEP token encryption, asynchronous authentication poll, and one-shot token redemption. It does not create an invoice.

Do not paste a KSeF access token or refresh token into Together. Those credentials are short-lived and remain in memory only. Do not upload a qualified certificate or private key; direct issuance uses the tenant-generated KSeF token.

### Provider switch and numbering

The provider switch affects new invoice requests only. Existing iFirma invoices remain attached to iFirma, while every already-frozen KSeF invoice continues through its durable KSeF job. Switching providers never moves or reissues a fiscal document.

Together allocates P_2 from an immutable per-tenant yearly series such as `FV/2026/000001`. KSeF retains the duplicate key `(seller NIP, invoice type, P_2)` for ten years counted from the end of the invoice year. Never change P_2 or submit a fresh copy to bypass a duplicate.

### Submission states

- **Queued** means the canonical FA(3) XML and SHA-256 are already frozen and the durable job is waiting to open a session.
- **Session opened** means the encrypted online session reference is persisted, but the invoice has not yet been sent.
- **Submitting** means the send boundary has been checkpointed. After an ambiguous timeout, Together lists that same session and correlates by the frozen invoice hash before any resend is considered.
- **Processing** means KSeF returned an invoice reference and is still validating the document. HTTP 202 is never shown as final acceptance.
- **Accepted, awaiting UPO** means status 200 and the KSeF number are persisted, while retrieval of the signed UPO is still retrying.
- **Issued** means the KSeF number and hash-verified UPO are stored. Staff can download the UPO and Together's deterministic A4 PDF visualization; the buyer receives the PDF link in `/account`.
- **Rejected** means KSeF returned a terminal schema, content, semantic, or permission failure. Correct the underlying fiscal data before creating a valid follow-up document.
- **Hard numbering conflict** means KSeF returned 440 but the original document could not be proven to match the frozen local invoice. Do not renumber or resend. Reconcile the original session, KSeF number, seller NIP, P_2, and XML hash manually.

When 440 identifies an original with the same seller NIP, invoice type, P_2, and frozen hash, Together adopts the original KSeF number and downloads its UPO. Otherwise it stops in the hard-conflict state.

### PDF visualization

Together renders the A4 visualization itself from the frozen FA(3) XML, with no PDF service and no PDF dependency: seller, buyer, positions, VAT summary, KSeF number, verification note, and the XML SHA-256. The same bytes are produced for the same invoice. The structured invoice in KSeF and its UPO remain the fiscal documents; the PDF is only a readable copy. It uses the standard PDF fonts, so Polish diacritics are transliterated (`Żółć` prints as `Zolc`); embedding a font with full Polish coverage is a follow-up.

### Environments and operations

`KSEF_ENVIRONMENT` is a deployment setting, not a tenant switch. Use `test` with `https://api-test.ksef.mf.gov.pl/v2` only for synthetic data. TEST is shared between integrators, so never use real personal, commercial, or production secrets there. Production uses `https://api.ksef.mf.gov.pl/v2`.

The durable dispatcher is invoked every minute by the Vercel cron entry for `GET /api/internal/dispatch-ksef`, authenticated with `Authorization: Bearer $CRON_SECRET`. Long-running Node deployments also invoke it every `KSEF_DISPATCH_INTERVAL_MS` (one second by default). Each invocation drains a bounded batch while the repository continues to serialize work per tenant. It respects `Retry-After`, refreshes expired access tokens once, stores every projection transition with an append-only lifecycle event, and persists UPO content rather than its expiring download URL. Operators can also invoke `POST /api/internal/dispatch-ksef` with `x-scheduler-operator-secret: $CRON_SECRET`.

The isolated real-environment acceptance script:

```bash
npm run db:up
npm run e2e:ksef
```

Each run creates a fresh checksum-valid synthetic seller NIP, buyer NIP, TEST certificate, tenant KSeF token, isolated database, seeded paid order, and unique P_2. It submits the invoice through Together's renderer and durable adapter, polls to a KSeF number, downloads UPO, asserts lifecycle rows and events, closes the session, revokes the test token, and removes the isolated database. If the official TEST environment cannot be reached, it prints an explicit `SKIP`; it is intentionally excluded from `check` and `smoke`.

### Deferred scope

Direct KSeF currently supports online single-invoice submission only. Deferred work includes batch/TarGz sessions, inbound invoice synchronization, corrections, and every offline mode: offline24, outage handling, QR code I/II generation, offline certificate custody, post-outage deadlines, technical corrections, and attachments.

## Known limitation: VAT-exempt sellers (v1)

Tenants exempt from VAT (zwolnienie podmiotowe/przedmiotowe, e.g. art. 113
ust. 1) cannot issue invoices through iFirma or direct KSeF in Together yet:
the tenant VAT setting accepts only 5/8/23% and issuance refuses loudly until a rate is set.
This is the SAFE failure mode (no incorrect 23% documents are ever created),
but the refusal message is the generic "set the VAT rate" one. Exempt-rate
support ("zw" positions with the legal-basis annotation required on the
invoice) is tracked as a dedicated follow-up; until it ships, exempt sellers
should issue invoices outside Together in their configured accounting workflow.
