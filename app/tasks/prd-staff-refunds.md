# PRD: Staff-initiated refunds

## Introduction

Workspace staff can already see refunds the platform issues on its own: an order whose goods sold
out before the payment arrived is cancelled and refunded by a queued job (`order_refund_jobs`,
see [Shop](../docs/shop.md), "Automatic refund of a cancelled order"). Staff cannot refund any
other order from the platform; they have to open the payment provider's dashboard, and the
platform learns about it only from the `charge.refunded` webhook.

This feature lets an owner or admin refund a paid order from the Studio order detail and from the
CLI, in full or in part, through the workspace's own payment credentials and the order's mode.
The refund runs through the same queue, dispatcher, idempotency rules, retries, permission
handling, staff alerts and Studio badge as the sold-out refund. There is no second refund path.

## Goals

- A paid order can be refunded in full or in part from Studio and the CLI in under a minute.
- No path can refund an order twice or more than was paid: double clicks, retried requests, two
  staff members at once and a lost provider response all end with at most the requested amount
  refunded.
- A full refund of an unshipped order returns the goods to stock and keeps the order off the
  packing list unless staff decide otherwise.
- The buyer is told once, in their language, when the provider accepted the refund.
- The release currently on production keeps working with every row this feature writes.

## User stories

### US-001: Refund a paid order in full

**Description:** As a workspace owner or admin, I want to refund a paid order in full from its
detail page so that I do not need the payment provider's dashboard.

**Acceptance criteria:**

- [ ] The order detail shows a "Refund" action to owners and admins when the order is refundable
  (FR-3); other viewers never see it.
- [ ] The dialog pre-fills the whole refundable remainder, shows the order's mode, the stock and
  packing consequences, the access consequence and an optional staff-only reason.
- [ ] When the remainder changed after the dialog loaded it, confirming refunds nothing and the
  dialog names the new remainder for staff to confirm again.
- [ ] Confirming queues one refund and shows it in the order's refund history at once.
- [ ] The project's own checks pass.
- [ ] Verified in the running app.

### US-002: Refund part of an order

**Description:** As staff, I want to refund part of an order so that I can compensate for a
damaged item or a late delivery.

**Acceptance criteria:**

- [ ] A "Partial amount" switch reveals an amount field in the order's currency.
- [ ] An amount above the refundable remainder, zero, negative or with more decimals than the
  currency allows is refused with a message naming the remainder.
- [ ] Several partial refunds can follow each other; each is listed with its own state.
- [ ] A partial refund changes no stock, packing or access automatically.
- [ ] The project's own checks pass.
- [ ] Verified in the running app.

### US-003: Keep a refunded order off the packing list

**Description:** As staff packing orders, I do not want to pack an order that was refunded before
it shipped.

**Acceptance criteria:**

- [ ] A full refund of an order that is `to_pack` without a shipment removes it from the packing
  list by default and returns its tracked products to stock by default.
- [ ] Staff can untick either option in the dialog.
- [ ] A removed order can be put back on the packing list with "Ship anyway".
- [ ] The project's own checks pass.
- [ ] Verified in the running app.

### US-004: Refund from the CLI

**Description:** As staff using the CLI, I want `order refund <orderId>` with the same rules as
Studio.

**Acceptance criteria:**

- [ ] `order refund <orderId>` refunds the remainder it printed (`--yes --remainder <decimal>`)
  and is refused when the remainder changed since; `--amount <decimal>` refunds part;
  `--reason <text>`, `--no-restock`, `--keep-on-packing-list` and `--request-key <key>` mirror
  the dialog; `--yes` is required to confirm (as other irreversible commands).
- [ ] `order refund-preview <orderId>` prints what is refundable and the consequences.
- [ ] `--json` prints one envelope; exit codes follow `EXIT_CODE_BY_ERROR_CODE`.
- [ ] The project's own checks pass.

### US-005: Buyer is told the refund was issued

**Description:** As a buyer, I want an e-mail when my money is on its way back.

**Acceptance criteria:**

- [ ] One `order-refund-issued` e-mail per staff refund, queued in the same transaction that
  records the provider's acceptance; none for a refund that never reached the provider or failed.
- [ ] It names the amount, the order's short reference and the arrival time as the provider words
  it, phrased as "usually", never as a promised date; no provider id and no staff reason.
- [ ] The project's own checks pass.

### US-006: Blocked permission

**Description:** As staff, I want to see that a refund waits for the refund permission on the
workspace's restricted key and what to do about it.

**Acceptance criteria:**

- [ ] The refund shows the existing `blocked_permission` state with the existing instructions;
  the existing staff alert e-mail is sent; the hourly retry for 72 hours applies.
- [ ] The project's own checks pass.
- [ ] Verified in the running app.

## Functional requirements

- FR-1: New capability `order:refund`, held by the `owner` and `admin` principals only, listed in
  the verified-e-mail capabilities, absent from impersonation read capabilities, from every API
  key principal and from every shop management key scope.
- FR-2: Routes (session only, tenant-scoped, same origin policy and CSRF checks as other mutating
  Studio routes, rate-limited per actor and per workspace):
  - `GET /api/orders/:orderId/refund-preview` → paid amount, refunded so far, refundable
    remainder, currency, mode, whether stock can be returned (units per product), whether the
    order is on the packing list, whether it has a shipment or label, whether it has an invoice,
    and whether the remainder was read from the provider or from the platform's records only.
  - `POST /api/orders/:orderId/refunds` with `{ requestKey, amountCents?, reason?, restock?,
    removeFromPackingList? }` → the created (or, for a repeated `requestKey`, the existing)
    refund.
  - `POST /api/orders/:orderId/packing-list` → puts a refunded order without fulfilment status
    back to `to_pack` ("Ship anyway") and takes back out of stock, once and in the same
    transaction, the units a staff refund returned (`adjusted` stock event with
    `reference = { orderId, reason: "staff_refund_ship_anyway" }`); `conflict` naming the products
    when fewer units are on hand.
  - The order detail response carries the order's staff refunds (newest first) and the totals.
- FR-3: An order is refundable by staff when: `status` is `paid` or `partially_refunded`;
  `provider` is `stripe`; it has a payment intent id; `amountCents > 0`; `cancelReason` is null
  (a sold-out order is refunded by its own job); and the refundable remainder is above zero.
  Anything else is refused with `conflict` or `validation` and a sentence naming the reason.
- FR-4: Refundable remainder = paid amount − max(committed refunds listed by the provider at
  request time, committed refunds the platform recorded). Committed = not `failed` and not
  `canceled`. When the provider list cannot be read (missing permission, timeout), the platform's
  records decide and the response says so; the provider refuses anything above the charge.
- FR-5: Creating a refund happens in one database transaction that locks the order row
  (`SELECT … FOR UPDATE`), re-reads the platform's committed sum, checks the amount, inserts the
  staff refund row and applies the stock and packing choices. A full refund names the remainder
  staff confirmed in `expectedAmountCents` (required without `amountCents`); when it differs from
  the remainder computed under the lock the request is refused with `conflict`, a message naming
  the current remainder and `details.remainderCents`. A partial refund may leave
  `expectedAmountCents` out or must set it to `amountCents`. A repeated `requestKey` for the
  same order returns the existing refund when the amount, restock and packing choices match and
  `conflict` otherwise. At most one staff refund per order may be waiting to reach the provider
  (`pending`, `running`, `blocked_permission`); a second one is refused with `conflict` until the
  first is accepted or failed.
- FR-6: Every staff refund issues exactly its stored `amountCents`, once (D2'). A full refund (no
  amount) stores the remainder computed at request time as a remainder refund; a refund with a
  typed amount, also one equal to the remainder, is stored as an amount refund. The dispatcher
  matches a staff refund's own provider refund by metadata `refundJobId` or the stored provider
  refund id; it never derives the amount from other refunds, never pays another refund's
  shortfall and never reopens because another refund failed. A dashboard refund that leaves less
  on the charge than the stored amount makes the provider refuse the refund, which ends `failed`
  with the staff alert and no buyer e-mail. When the provider answers that the charge is already
  refunded, the staff refund keeps watching: it ends `skipped_refunded` only when succeeded
  provider refunds cover the paid amount, keeps watching while a pending one covers it, and issues
  its own amount when that one fails. A typed amount that covers the
  whole remainder at request time gets the full refund's stock and packing choices (FR-9). Both use the existing idempotency-key
  generations (`staff-refund-<id>`, `staff-refund-<id>-<n>`), lease, retry delays,
  `blocked_permission`, status checks, `unconfirmed` and staff alerts.
- FR-7: The dispatcher claims due jobs from both tables in one run under the existing cap and
  deadline (sold-out jobs first when both are due at the same instant); the kick after a webhook
  and the minute tick are shared.
- FR-8: Provider refund metadata: `tenantId`, `orderId`, `reason: staff`, `refundJobId`. No
  personal data and no staff reason.
- FR-9: Full refund before shipping (`fulfilmentStatus = to_pack`, no shipment): `restock`
  (default true) writes a `returned` stock event per tracked product line with
  `reference = { orderId, reason: "staff_refund" }` and raises `on_hand`; `removeFromPackingList`
  (default true) sets `fulfilmentStatus` to null as the sold-out flow does. Both happen at request
  time; a refund that later fails leaves them as chosen and the staff alert says so.
- FR-10: An order with a shipment or a bought label can be refunded; `restock` defaults to false
  and the dialog warns that the label is not cancelled; `removeFromPackingList` is offered only
  while the order is `to_pack` and defaults to false. A `shipped` order is never moved.
- FR-11: Access: a full refund leaves access to the existing `charge.refunded` handler, which
  marks the order `refunded` and revokes the grants of the order's products unless another
  purchase keeps them (unchanged behaviour). A partial refund changes no grant; staff revoke one
  on the member page if they want.
- FR-12: The `charge.refunded` handler additionally makes the order's waiting staff refunds due
  now (as it does for the sold-out job), so Studio shows the outcome within a minute.
- FR-13: Studio order detail: "Refund" action, dialog (full / partial), refund history (amount,
  staff member, time, reason, state badge reusing `OrderRefundJob`), totals Paid / Refunded /
  Remaining, "Ship anyway" when the order was taken off the packing list. A partial request from
  the dialog always sends `restock: false` and `removeFromPackingList: false`, so a remainder that
  shrank after the preview loaded never turns it into the full refund's choices; every field is
  locked while the request is in flight, and a refusal stays pinned above the buttons. The Studio orders list
  carries a separate optional `staffRefundStatus` and `staffRefundAmountCents` (the latest staff
  refund while unsettled) for its badge; `refundJobStatus` keeps meaning only the sold-out refund job, and the shop key list and
  the order feed stay unchanged.
- FR-14: Exports: the orders CSV gains a trailing `refunded_amount` column and the JSON export a
  `refundedCents` field (platform-recorded committed refunds, or the paid amount when the order
  is `refunded`). The packing list excludes orders without fulfilment status (unchanged query).
  The shop integration order feed is unchanged in this PR (it already carries the status).
- FR-15: Buyer e-mail `order-refund-issued` (see US-005), outbox id
  `order-refund-issued:<refundId>`, language as the sold-out refund e-mail, branding as other
  buyer e-mails, queued only for staff refunds.
- FR-16: Audit: each staff refund row keeps immutable `requested_by_user_id`,
  `requested_by_email`, `amount_cents`, `note` and `created_at`; the server logs one line per
  request with tenant, order, refund id, actor id and amount (no provider id, no e-mail address).
- FR-17: Docs: `shop.md` (staff refunds section), `payments.md`, `cli.md`, `route-table.md`,
  `permission-table.md`, `security.md`, `shop-management-keys.md` ("a shop key never refunds; a
  propose-mode key never refunds"), `terminology-glossary.md`.

## Non-goals

- No refund through shop management keys, API keys or change proposals.
- No automatic correcting invoice; the dialog tells staff when the order has an invoice.
- No carrier label cancellation.
- No refund of orders paid outside the payment provider (simulated or free orders).
- No change to the sold-out flow's behaviour, its states or its e-mails.
- No new `tenant_audit_events` kind, order status, cancel reason, refund job status, refund alert
  value or `order_changes` shape.

## Design considerations

Mockups were reviewed outside the repository (order detail, full and partial dialog, after a refund, blocked permission, packing list; widths
375, 1280 and 1920). Reuse `OrderRefundJob` for the state badge and the existing dialog and form
components of the order detail page. The refund button uses the primary style with the amount in
its label; it is deliberate, not destructive.

## Technical considerations

### Storage and rollback compatibility

The release on production (main `8141fd15`) parses every `order_refund_jobs` row with
`reason: z.enum(['out_of_stock'])` and claims the oldest due row first, so a row with another
reason would make each of its minute ticks throw on the same row and stop every sold-out refund,
and its order detail would fail for that order. Staff refunds are therefore stored in a new table
`order_staff_refunds` that the previous release never reads. It has the lifecycle columns of
`order_refund_jobs` (status with the same CHECK list, attempts, next attempt, lock, last error,
provider refund id and status, submitted at, status checks, key generation, permission blocked
at, transient failure streak) plus `kind` (`remainder` | `amount`), `request_key` (unique per
workspace), `requested_by_user_id`, `requested_by_email`, `note`, `restocked`,
`removed_from_packing_list`, `buyer_notified_at`. It reuses the trigger function
`record_refund_job_order_change()` on insert and status change, so the order feed sees each
change. Partial unique index `(tenant_id, order_id) WHERE status IN ('pending', 'running',
'blocked_permission')` enforces FR-5.

What the previous release does with rows written by this one:

- `order_staff_refunds`: never read; staff refunds waiting to reach the provider wait until the
  release is back (Studio on the previous release does not show them).
- Deletes of orders: the previous release's demo and smoke reseed deletes each listed table by
  workspace and then `orders`, and its list has no `order_staff_refunds`. The table's foreign key
  to `orders` is `ON DELETE CASCADE`, so deleting an order also deletes its staff refunds and the
  reseed keeps working after a rollback.
- `orders.fulfilment_status = NULL` on a paid order with shipping: already written by the sold-out
  flow and read as "not on the packing list".
- `orders.status` `refunded` / `partially_refunded`: existing values, written by the existing
  webhook.
- `stock_events` types `returned` and `adjusted` (ship anyway): existing types; the `reference`
  JSON is not parsed strictly.
- `order_changes`: same columns, written by the same trigger function.
- `email_outbox` kind `order-refund-issued`: the previous release's `renderEmailOutboxPayload`
  safe-parses the payload and fails only that row ("Invalid email outbox payload"), retries it up
  to the attempts cap and then leaves it `failed`; other e-mails are unaffected. A buyer e-mail
  queued during a rollback window may therefore not be sent.
- Provider refunds with metadata `reason: staff`: the previous release's sold-out jobs count them
  as committed money (correct) and never take them over (metadata reason differs).

A test holds a literal copy of the previous release's schemas (`orderRefundJobSchema` reason and
status lists, `orderSchema` status/cancel reason/fulfilment status, the e-mail payload kinds) and
proves each stored shape above either is never read by it or parses. The same test deletes the
workspace's orders in the previous release's wipe order and proves their staff refunds go with
them.

### Migration

One migration, placeholder number `0168` (`0168_order_staff_refunds.sql`), to be renumbered by the
deployments thread at merge time. It creates the new table, its indexes and two triggers. Locks:
`CREATE TABLE` with foreign keys takes `SHARE ROW EXCLUSIVE` on `tenants` and `orders` for the
duration of the statement (milliseconds; the new table is empty), the indexes and triggers lock
only the new table. No backfill, no rewrite of an existing table.

### Provider payload tolerance

Fields read from the refund API response and `refund.*` objects: `id`, `amount`, `status`,
`failure_reason`, `payment_intent` (string or expanded object), `metadata`. From `charge.refunded`:
`id`, `amount`, `amount_refunded`, `refunded`, `payment_intent`, `invoice`. None of them depends on
the charge's `refunds` list, which newer API versions no longer include by default. The PR body
lists the provider changelog entries checked for each field.

### Money rules

Amounts are integers in the currency's minor units; the CLI and Studio convert decimals with the
existing currency helpers (zero-decimal currencies take whole numbers). The provider is the last
guard against refunding more than the charge.

## Success metrics

- The owner refunds the two paid, unshipped test orders on production from Studio, both end
  `succeeded`, the orders read `refunded`, are off the packing list, stock is back and the buyer
  e-mail arrives.
- No duplicate refund in the provider's dashboard for any test of FR-5.

## Decisions taken for the owner

- D1. Storage: a new table `order_staff_refunds` driven by the existing dispatcher (alternatives:
  A a new reason in `order_refund_jobs`, B a two-release rollout). Why: the production release
  would throw on a foreign reason and stop all sold-out refunds after a rollback. Revert: "undo
  D1 → single table".
- D2'. Every staff refund issues exactly its stored amount once; a full refund is an amount
  refund of the remainder computed at request time and confirmed by `expectedAmountCents`
  (replaces D2, under which a full refund re-derived its amount from the provider's refund list
  and interacted with the failures of other refunds of the order). Why: four review rounds found
  money defects in the re-derivation; with exact amounts a refund never pays another refund's
  shortfall or anything twice, and a changed remainder is refused instead of paid. The sold-out
  job keeps its own remainder rule. Revert: "undo D2' → remainder coverage".
- D3. One staff refund per order waiting to reach the provider; a repeated request key returns the
  same refund. Revert: "undo D3 → parallel refunds".
- D4. Stock and packing changes apply when the refund is requested, not when it succeeds. Why: the
  packing list must drop the order at once. Revert: "undo D4 → after confirmation".
- D5. Restock and packing removal default on only for a full refund of a `to_pack` order without a
  shipment; off and warned with a shipment or label; never for a partial refund. Revert: "undo
  D5 → always ask".
- D6. Access: full refund follows the existing webhook (grants revoked unless another purchase
  keeps them); partial changes nothing. Revert: "undo D6 → partial also revokes access".
- D7. `order:refund` for owner and admin (the only staff roles), verified e-mail required, not under
  impersonation. Revert: "undo D7 → owner only".
- D8. No machine key refunds in this PR; propose-mode keys never. Revert: "undo D8 → key with a
  refund scope".
- D9. Audit = the immutable columns of the staff refund row plus a log line; no new
  `tenant_audit_events` kind (closed enum in the previous release). Revert: "undo D9 → audit log
  entry".
- D10. Buyer e-mail as a new outbox kind, accepting that a rollback window may drop it (the
  alternative, a pre-rendered generic kind, mislabels deliverability data). Revert: "undo D10 →
  no e-mail".
- D11. Exports gain `refunded_amount`; the shop integration feed stays unchanged. Revert: "undo
  D11 → amount in the feed".
- D12. Orders without a payment intent, simulated orders and sold-out orders are not refundable
  from Studio. Revert: "undo D12 → refund by charge".
- D14. A test-mode order is refunded in test mode without a buyer e-mail; restock returns
  nothing because a test checkout never commits stock. Revert: "undo D14 → e-mail in test mode".
- D13. Migration placeholder `0168`; the deployments thread assigns the final number.
