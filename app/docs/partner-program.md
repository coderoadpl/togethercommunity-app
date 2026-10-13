# Partner programs

Owners and administrators manage partner programs in **Sales → Partner programs**.
Partners are existing workspace members; assignment does not grant Studio access.
Each program has an integer commission percentage from 1 to 100, a grace period
from 0 to 365 days (14 by default), notes, and an active or archived status.
Programs, partners and codes are archived rather than deleted.

## Codes and checkout

Each code belongs to one program and one partner. Codes contain 2–40 uppercase
letters, digits or hyphens; input is trimmed and uppercased. Names are unique
within the workspace, case-insensitively, across partner codes and regular
coupons. The integer discount is between zero and the program commission,
inclusive. An equal discount leaves the partner with zero commission.

A code names one or more sales links. Each selected offer must enable
**Discount codes allowed on this offer** (`allowsCodes`, false by default).
An offer cannot disable codes while an active partner code names it; archive
that code first. Eligibility requires an active program, partner and code,
the selected sales link, an inclusive start and exclusive end when configured,
and an available redemption under the optional cap. Checkout creation reserves
capacity atomically before asking Stripe for a session, including attribution-only
codes. Every session with a partner reservation expires after 30 minutes, the
shortest Stripe checkout lifetime. Fulfillment consumes that reservation in the
payment transaction. Confirmed session expiration or asynchronous payment failure releases it; a definite session
creation failure also releases it. Reservations do not expire on a local timer:
a delayed payment webhook must not let another buyer reuse a paid slot. Provider
failures with an unknown outcome retain capacity until the session is resolved.
Stripe webhook endpoints must include `checkout.session.expired` alongside the
checkout completion and asynchronous payment events so abandoned sessions release
their reservations.

### Existing Stripe endpoints: required rollout step

Deploying this release does not update an endpoint already registered in Stripe.
Before enabling any partner codes, reconfigure Stripe for **every existing
workspace** that accepts payments. Do this in a maintenance window with checkout
traffic paused and existing sessions resolved: reconfiguration deletes the old
endpoint before creating its replacement and saving the new signing secret.

1. In **Integrations → Stripe**, enter the workspace's existing live restricted
   key again and select **Save and create webhook**. The headless equivalent is
   `stripe configure <restricted-key>` through the Together CLI with the correct
   API origin and tenant selected. No new key is required.
2. Repeat for each configured test-mode card, or use
   `stripe test-mode configure <restricted-key>`. Each slot is reconfigured
   separately; saving one leaves the other unchanged.
3. Confirm configuration succeeds and the replacement endpoint in Stripe enables
   `checkout.session.expired`, `checkout.session.completed`,
   `checkout.session.async_payment_succeeded` and
   `checkout.session.async_payment_failed`, together with the remaining events
   in `STRIPE_WEBHOOK_EVENT_TYPES` (`core/server/usecases/stripe-webhook.ts`).
   Confirm a signed checkout event is delivered successfully before resuming
   checkout traffic.
   A successful connection test alone does not prove the event subscription.

If reconfiguration fails, keep checkout paused until the endpoint and signing
secret have been configured successfully. This procedure updates future
deliveries; it does not recover expiration events missed before the upgrade.
If partner checkout was already enabled, reconcile unresolved reservations
against confirmed provider outcomes before reopening capped codes. Never release
a reservation solely because it is old: its payment notification may be delayed.
Test-mode orders do not reserve partner capacity, so a sandbox delivery verifies
the endpoint, not live capped-slot recovery. The local reservation integration
tests cover release, retry and capacity reuse without real payments.

The [go-live checklist](go-live-checklist.md) and [staging runbook](staging.md)
require this step for existing endpoints before partner checkout rollout.

### Buyer entry and attribution

On the direct offer page, **I have a discount code** cancels the scheduled
automatic handoff before its POST starts and reveals the code input and
**Continue to payment** button. While a POST is in flight, the code controls are
locked so its reserved redemption and successful checkout URL cannot be discarded.
A failed POST unlocks the controls for correction. A `code` query
parameter prefills the input, including through `/link/<key>` redirects, and
waits for an explicit **Continue to payment** click; it never starts an automatic
POST. Offers without a prefilled code keep the automatic handoff. The server
validates every submitted code before creating a payment session. Invalid codes show an inline error so the buyer can retry or continue without a code.
Offers that disallow codes hide the input and reject supplied codes.

The Together checkout coupon field uses the same partner eligibility rules.
A partner code requires a sales link and cannot apply to a single-product
checkout without that context. Regular coupons retain their existing rules.
Stripe's promotion-code field stays disabled on the direct handoff because
Stripe cannot scope a code to one offer. Together validates the offer before
applying the existing unscoped Stripe coupon and promotion code. A zero-percent
code is attribution-only, has no Stripe coupon or promotion code, and displays
no discount line.

Orders store `partnerCodeId`; `couponId` remains null for partner codes. The
checkout snapshot preserves attribution and the discount through payment
fulfillment. Studio order details show the code, partner email and program.
Commission percentage, discount percentage and grace days are also frozen in
the checkout snapshot, so edits cannot change the terms of an in-flight payment.
Studio program totals are grouped by order currency; currencies are never added together.
The checkout preview reuses the coupon breakdown envelope; its `couponId`
identifies the partner code for that preview only, not the order's coupon column.

## Commission ledger

Payment fulfillment records one commission per nonphysical order line, in the
same transaction as the order. Test-mode orders do not create commissions.
The base is the immutable line net amount before the buyer's discount:

`amountCents = roundHalfUp(baseCents × max(0, commissionPct − discountPct) / 100)`

For a net line of 10,000 cents, a 50% program and a 10% discount give the partner
40%, or 4,000 cents. Physical lines earn nothing. Rounding is independent per
line; a 1-cent base at 50% rounds to 1 cent.

Order lines are immutable JSON snapshots, so the ledger's `orderLineId` combines
the order ID and product ID. Sales links include each product once. A unique
order-line key prevents duplicate commissions on webhook retries.

New entries are pending until `payableAt`, the payment time plus the program's
grace days. Reads compute payable status once the grace period expires while
the order remains paid; no scheduler is required. A full refund or dispute
inside the grace period voids all pending commissions for the order with its
reason. Refunds after grace do not claw back earned commissions. Paid and voided
entries remain terminal. Partial refund events do not proportionally adjust
partner commissions. Payout selection and transitions operate on whole orders,
even though commission arithmetic is recorded per line.
Payment and adjustment timing uses the provider event timestamp when available,
with the processing clock as a fallback; delayed delivery does not extend grace.

## Next wave

Wave 2 adds the member partner panel and manual payouts with an attachment,
whole-order selection and payout references. Partners will see public order
numbers, products and amounts without buyer identity. The ledger already keeps
the paid status and nullable payout reference needed for that workflow.

## CLI

`partner-program` exposes `list`, `show <id>`, `create`, `update`, `assign`,
`update-partner`, `create-code`, and `update-code`. Mutations accept `--input`
JSON; program and code updates include `id` and `expectedRevision`.
Sales-link create and update inputs accept `allowsCodes`. The direct
`sales-link checkout <slug>` command accepts `--code` for the same offer-scoped
validation as the browser.

See [Sales links](sales-links.md) and [Payments](payments.md).
