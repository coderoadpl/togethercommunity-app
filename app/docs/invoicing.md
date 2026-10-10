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
7. In **Settings → Automatic invoices**, select 5%, 8%, or 23% VAT, or select VAT exemption and provide its legal basis.
8. Complete a paid test order with billing data, open it in **Sales**, and select **Issue invoice**.

If the connection test reports rejected credentials, verify the login, confirm that the saved key is the `faktura` key, and generate a replacement key in iFirma if necessary. A validation error means iFirma accepted authentication but rejected the account configuration or document data. An unavailable error indicates a network or iFirma technical failure and can be retried.

## What Together sends

Together creates a paid domestic VAT invoice in PLN for a Polish billing address. Each position uses the immutable paid-order product name and amount rather than a current product price. Products without an explicit VAT rate store a null override and follow **Settings → Automatic invoices**; creating or editing a product does not freeze that default. For a single-product order without an explicit override, the invoice uses the current Settings treatment at issue time, including B2C invoices requested later. An explicit product rate is frozen on the order line; a sales link freezes every line's resolved rate at checkout. A sales link produces one position per product, with mixed 5%, 8%, 23%, and exempt rates supported by both iFirma and KSeF. The invoice request event freezes the positions; KSeF also freezes the exact XML. Every position is treated as delivered at the time of sale; there is no advance-payment invoice flow. For a single-product order, the existing position discount note and FA(3) XML shape remain unchanged, including omission of `P_6`. Multi-line FA(3) invoices include the sale date in `P_6`. For bundles, a total coupon discount is allocated proportionally across positions using cumulative integer-cent rounding; the position gross amounts sum exactly to the paid order total. Net and VAT amounts are computed separately per discounted position. The buyer comes from the immutable checkout billing snapshot; a B2B buyer includes the NIP, while a B2C buyer does not.

Naming decision (2026-10-08): single-product invoice positions also use the stored order-line name. New orders capture that name at purchase; pre-existing orders received the product title current when migration `0136_order_lines.sql` backfilled them. Renaming a product afterward does not change the position name on an invoice requested later. This deliberately changes the previous behavior, which used the current product title at invoice issuance, and keeps invoice names consistent with the order ledger.

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

## Uninvoiced consumer sales summary

On the Studio Orders page, **Uninvoiced consumer sales** defaults to the previous calendar month. It groups stored order lines by 5%, 8%, 23%, and exempt VAT rates and shows distinct order counts, line counts, net, VAT, and gross in integer cents. Totals count a mixed-rate order once. The paid `amountCents` is allocated proportionally across stored line gross values using cumulative rounding, as for invoice positions. Each allocated gross amount is split into net and VAT at its stored rate. This includes partial and 100% coupon discounts and reconciles gross to the amount paid; current prices and tax settings are never used.

Selection is scoped to the workspace: live paid orders only, with neither full nor partial refunds, no NIP in the immutable billing snapshot (an absent snapshot also qualifies), and no issued, in-flight, accepted, or ambiguous invoice. Invoice rows in `requested`, `queued`, `submitting`, `processing`, `issued`, `delivered`, or `conflict` status exclude the order, including accepted KSeF invoices awaiting UPO and KSeF 440 conflicts. A failed invoice also excludes the order if it has `provider_create_uncertain`, a stored issue timestamp, an iFirma provider invoice ID, or a KSeF number (including the original number). A skipped invoice event, an absent invoice, or a definitive failure without that evidence does not exclude the order. The inclusive calendar-day range uses the order's `createdAt` date in the workspace timezone. There is no configurable workspace timezone; this summary uses `Europe/Warsaw`, the existing Studio sales-link timezone constant. Test-mode orders are excluded, as in the orders export.

The summary is input for the accountant's collective **internal document (WEW)** and is not itself a tax document. It is computed live. An invoice issued later on request removes that order from subsequent summary runs, including a re-run of the original sales month; it does not move the sale into the invoice month. Export once per month after the applicable on-request window, or keep the exported file as the record used for bookkeeping. Invoices handled directly outside Together must be reconciled by the accountant because this summary sees only invoice rows recorded in Together.

**Download CSV** exports one row per rate and a `TOTAL` row, then a second section with included order numbers (order IDs), Warsaw calendar dates, allocated paid gross amounts, and JSON rate breakdowns. The file records the range, timezone, currency, counts, and integer-cent amounts. JSON also includes the list of included order IDs. If eligible orders have missing lines or unresolved stored VAT rates, the summary returns a validation error identifying the orders; it does not guess a rate or omit them. A period containing multiple currencies also returns a validation error rather than summing different currencies. A positive payment with zero stored line gross cannot be allocated and is also rejected.

**Known historical VAT gap:** single-product checkouts that inherit workspace VAT can store a null line rate. Although the subscription lifecycle supplies no lines, migration 0136's insert trigger captures a single product line; that migration also backfills older orders. Both copy the product VAT rate, which can be null when it inherits the workspace default. Explicit product rates therefore work for subscriptions, but unresolved rates or missing lines on any eligible order block the entire period: the Studio card and CSV cannot provide that month’s summary. Orders contain no historical workspace VAT-setting snapshot, and backfilled product rates reflect migration time rather than a verified payment-time snapshot. Current settings and product VAT can differ from those at payment, and an uninvoiced order need not have a frozen invoice treatment. No fallback has been selected: reliable historical VAT data or an explicit owner decision about fallback treatment is required before blocked periods can be summarized.

The endpoint is `GET /api/orders/consumer-sales-summary?from=YYYY-MM-DD&to=YYYY-MM-DD`; `format=csv` returns a downloadable CSV. Both formats require `order:export`. CLI parity:

```bash
pnpm --silent run cli --json --tenant acme orders consumer-sales-summary --from 2026-09-01 --to 2026-09-30
pnpm --silent run cli --tenant acme orders consumer-sales-summary --from 2026-09-01 --to 2026-09-30 --format csv --out consumer-sales.csv
```

## Retention and erasure

Paid-order billing snapshots are immutable. Invoices and their append-only lifecycle events are fiscal records. Member erasure pseudonymizes the member but does not delete invoice rows or their order relationship.

## Direct KSeF 2.0

### Generate and connect a token

1. Sign in to KSeF in the tenant's NIP context.
2. Open the token management screen and generate a token with `InvoiceWrite`. Token permissions cannot be changed later; replace the token if the permission set must change.
3. Copy the token when KSeF displays it. KSeF shows its secret value only once.
4. In Together, open **Settings → Automatic invoices** and select **Direct KSeF**.
5. Save the context NIP and KSeF token. Both are write-only tenant secrets; Together subsequently shows only masked previews.
6. Save the seller name, seller address, and applicable VAT rate or VAT exemption with its legal basis.
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

Together renders the A4 visualization itself from the frozen FA(3) XML, with no PDF service and no PDF dependency: seller, buyer, positions, VAT summary, KSeF number, verification note, and the XML SHA-256. The same bytes are produced for the same invoice. The structured invoice in KSeF and its UPO remain the fiscal documents; the PDF is only a readable copy. It uses the standard PDF fonts, so Polish diacritics are transliterated to their ASCII equivalents; embedding a font with full Polish coverage is a follow-up.

### Environments and operations

`KSEF_ENVIRONMENT` is a deployment setting, not a tenant switch. Use `test` with `https://api-test.ksef.mf.gov.pl/v2` only for synthetic data. TEST is shared between integrators, so never use real personal, commercial, or production secrets there. Production uses `https://api.ksef.mf.gov.pl/v2`.

The durable dispatcher is invoked every minute by the Vercel cron entry for `GET /api/internal/dispatch-ksef`, authenticated with `Authorization: Bearer $CRON_SECRET`. Long-running Node deployments also invoke it every `KSEF_DISPATCH_INTERVAL_MS` (one second by default). Each invocation drains a bounded batch while the repository continues to serialize work per tenant. It respects `Retry-After`, refreshes expired access tokens once, stores every projection transition with an append-only lifecycle event, and persists UPO content rather than its expiring download URL. Operators can also invoke `POST /api/internal/dispatch-ksef` with `x-scheduler-operator-secret: $CRON_SECRET`.

The isolated real-environment acceptance script:

```bash
pnpm run db:up
pnpm run e2e:ksef
```

Each run creates a fresh checksum-valid synthetic seller NIP, buyer NIP, TEST certificate, tenant KSeF token, isolated database, seeded paid order, and unique P_2. It submits the invoice through Together's renderer and durable adapter, polls to a KSeF number, downloads UPO, asserts lifecycle rows and events, closes the session, revokes the test token, and removes the isolated database. If the official TEST environment cannot be reached, it prints an explicit `SKIP`; it is intentionally excluded from `check` and `smoke`.

### Deferred scope

Direct KSeF currently supports online single-invoice submission only. Deferred work includes batch/TarGz sessions, inbound invoice synchronization, corrections, and every offline mode: offline24, outage handling, QR code I/II generation, offline certificate custody, post-outage deadlines, technical corrections, and attachments.

## VAT-exempt sellers

The direct KSeF path supports VAT-exempt (`zw`) positions both alone and alongside taxed positions. Each exempt position has no VAT amount and its gross equals net. The frozen FA(3) XML carries a single exempt position's materialized legal basis in `P_19A` for a statute basis or `P_19C` for another basis. Multiple exempt positions join their distinct bases in `P_19C`; taxed positions retain their own rate summaries. Inherited exemption settings require a basis kind and non-empty text, and `art_43_1` requires the applicable numbered provision (`pkt`). The same validation applies to frozen exemption lines before issuance. The PDF visualization prints the same basis; its Polish diacritics are transliterated because the PDF uses standard fonts. The XML stored and submitted to KSeF is the fiscal document.

The iFirma payload sends `TypStawkiVat: ZW`, a null rate, and `PodstawaPrawna`. It also mirrors the basis in `Uwagi`, which can produce cosmetic duplication. Real-account acceptance is still required before enabling this path for production: confirm that the owner's account preserves the basis on the PDF and in the document forwarded to KSeF, record the outcome here, and remove the `Uwagi` mirror if the structured field proves reliable without it.

The setting supplies the default treatment for products without an explicit rate. Explicit product rates allow one invoice to mix 5%, 8%, 23%, and `zw` positions. Together does not monitor the art. 113 ust. 1 turnover threshold because it sees only its own orders. The tenant is the seller of record, remains responsible for the cited provision and total turnover, and must change the setting when the exemption ends.
