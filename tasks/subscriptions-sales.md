# Sprint: subscriptions + sales ledger (owner-approved 2026-07-18)

> Owner decisions: (1) an active subscription = a grant renewed per billing
> period — `invoice.paid` extends the grant to the period end plus a small
> grace buffer (retry window); read-time expiry stays the only enforcement,
> no crons. (2) **Multiple prices per product**: a product carries a list of
> prices (one-time AND/OR recurring monthly/yearly); the buyer picks on the
> checkout page. (3) Sales view ships full: orders list + filters + search +
> CSV/JSON export + summary tiles on the dashboard.

## Model

- `product_prices`: { id, tenantId, productId, kind: 'one_time' | 'recurring',
  interval?: 'month' | 'year', amountCents, currency, active, createdAt }.
  Existing single `priceCents` migrates to one active one-time price.
- `orders` (the ledger Sales reads): { id, tenantId, memberId, productId,
  priceId, kind, status: 'paid' | 'pending' | 'failed' | 'refunded',
  amountCents, currency, provider ('stripe' | 'simulated'),
  providerObjectIds (session/invoice/charge), createdAt }.
  EVERY successful checkout — one-time, recurring invoice, simulated dev
  payment, M2M enroll with a price — appends an order row.
- `member_subscriptions`: { id, tenantId, memberId, productId, priceId,
  providerSubscriptionId?, status: 'active' | 'past_due' | 'canceled',
  currentPeriodEnd, cancelAtPeriodEnd, createdAt, updatedAt }.
- Grants: unchanged shape. A paid period upserts/renews the product grant with
  `expiresAt = currentPeriodEnd + grace (3 days)`. Cancellation does NOT cut
  access — the grant simply is not renewed (expires at period end + grace).

## Flows

- Checkout page: price picker when a product has >1 active price (one-time
  "Kup teraz" vs subscription "Subskrybuj co miesiąc/rok" with clear copy);
  Stripe-hosted checkout in `subscription` mode for recurring prices.
- Webhooks (existing endpoint + processed_events idempotency):
  `checkout.session.completed` (order + grant + subscription row),
  `invoice.paid` (order + grant renewal + period bump),
  `invoice.payment_failed` (status past_due, order 'failed'),
  `customer.subscription.updated/deleted` (cancelAtPeriodEnd / canceled).
- Simulated payments (dev): can create a subscription and simulate the next
  invoice cycle so the whole lifecycle is testable without Stripe keys.
- Member `/my/products`: subscription status chip (aktywna / zaległa płatność /
  anulowana — do końca okresu), renewal date, cancel via billing portal link.
- Panel Sales (`/panel/sales`): ListSection — orders with status/amount/
  product/member/date, filters (status, product, kind), search, CSV/JSON
  export (all rows, not the page); dashboard tiles: revenue last 30 days,
  active subscriptions count, orders last 30 days.

## Out of scope (later)

Own checkout (Payment Element), MRR/churn analytics, dunning e-mails, promo
codes, per-seat pricing, tenant payout reports.

## Executed (2026-07-18)

Shipped in `f4f7ae9` (model + lifecycle core + webhooks + simulated cycles +
migration 0019), `6742fbb` (checkout price picker + member subscription chip),
`735e067` (product price editor, `/panel/sales`, dashboard revenue tiles), and
the verification commit (this one).

- **E2E** — new `npm run e2e:subs` (`scripts/subs-e2e.ts`) drives the whole
  lifecycle on a fresh throwaway Postgres: multi-price product → simulated
  subscription checkout (order + grant to period end + 3d grace) → replayed
  purchase is idempotent → invoice cycle extends grant + appends 2nd order →
  signed `invoice.paid` webhook (order 3) with two replay forms (same event id;
  same invoice under a fresh event id) both skipped → payment failure marks
  `past_due` + failed order without extending the grant → one-time price order →
  filters/search/summary/CSV+JSON export assertions → cancel webhook sets
  `cancelAtPeriodEnd` (replay skipped), next cycle cancels with no new order →
  DB time-travel past period end + grace flips the member view to `expired` at
  read time and the active-subscriptions tile to 0. PASS (13 steps, ~15 s).
- **Browser QA** (headless Chrome, screenshots w prywatnych materiałach
  właściciela): checkout price picker on the
  seeded club product in PL + EN, `/my/products` chips (Aktywna / Zaległa
  płatność / Anulowana — do końca okresu on a throwaway tenant, deleted after),
  `/panel/sales` list + status filter + search + real CSV export download,
  dashboard revenue/subscriptions/orders tiles.
- **Review fixes** — `countActive` in the subscriptions repository derived its
  grace window from a hardcoded `interval '3 days'`; now computed from
  `SUBSCRIPTION_GRACE_DAYS`. Otherwise the S1–S3 diffs conform: strict layers,
  zod at every boundary, `Result`/closed error codes, integer-cents money,
  `processed_events` idempotency (by event id AND object+type).
- **Gates** — `npm run check` (568 tests) + `npm run smoke` + `npm run visual`
  all green. Goldens updated for `panel-products` only (intended S3 delta:
  rows link to the new product editor via "Zarządzaj", inline single price
  dropped now that products carry price lists) — missed in `735e067`.
- **Deferrals** — real-Stripe run (subscription checkout, portal cancel) still
  unverified without keys: the simulated path exercises the same
  `fulfillStripeWebhook` code, but a keyed staging pass is owed. Concurrent
  duplicate webhook deliveries (same event racing itself) rely on
  check-then-insert `processed_events`, not a transactional guard — sequential
  replays are covered. CLI `orders export` is available from the sales commands
  in `app/apps/cli/src/main.ts`. `visual:update`
  rewrites sub-threshold goldens as byte noise; those were kept out of the
  commit.
