# Shop

## Delivery

This section is reserved for delivery options.

## Stock

Stock tracking is optional per product. A product without a `product_stock`
row is untracked and sells without a limit, which keeps the behaviour of every
existing product. Staff enable tracking in Studio ("Track stock" in the Stock
section of a physical product's editor or create page) or with
`together product stock enable <productId> --on-hand N [--threshold N]`. The
API accepts tracking for any product type; Studio shows the section only for
physical products. Tracking cannot be switched off once enabled; the count is
corrected with an adjustment. Counts are capped at 1,000,000 pieces. An
adjustment may lower `on_hand` below the pieces reserved by open checkouts (for
example damaged goods); a later commit then records `oversold` and alerts.

### Model

- `product_stock` is the projection: `on_hand`, `reserved`, an optional
  `low_stock_threshold`, and `low_stock_notified_at` for alert deduplication.
  Available pieces are `on_hand - reserved`, never below zero.
- `stock_reservations` holds one row per tracked product of a checkout snapshot
  (`active`, `committed` or `released`) with its `expires_at`. The pair
  `(tenant_id, checkout_snapshot_id, product_id)` is unique.
- `stock_events` is append-only. `quantity` is the signed change of the type:
  `tracking_enabled` (initial `on_hand`), `adjusted` and `returned` (change of
  `on_hand`), `reserved` and `released` (change of `reserved`), `committed` and
  `committed_late` (change of `on_hand` actually applied), and `oversold` (the
  pieces sold beyond `on_hand`, not applied). Events carry `reference` with the
  checkout snapshot, order, reservation and reason where they apply.

### Checkout

1. `validateCheckoutSelection` reads the stock of the selected products and
   returns `sold_out` early when any tracked product has no available piece.
   This read is advisory only.
2. After the checkout snapshot is captured and before the Stripe session is
   created, `StockRepository.reserve` reserves one piece of every tracked
   product in one transaction. The conditional update is the only authority:

   ```sql
   update "product_stock" set "reserved" = "product_stock"."reserved" + $1, "updated_at" = $2
   where (("product_stock"."tenant_id" = $3 and "product_stock"."product_id" = $4)
     and "product_stock"."on_hand" - "product_stock"."reserved" >= $5)
   returning "product_id"
   ```

   No updated row for a tracked product rolls the whole reservation back and
   the checkout fails with `sold_out` (HTTP 409, CLI exit code 25) naming the
   product title.
3. With at least one tracked product the Stripe session expires after 31
   minutes (passed as `expires_at`; one minute above the Stripe minimum of 30,
   so the clock read and the request time never take it below the minimum) and
   the reservation after 36 minutes. Untracked-only checkouts keep the Stripe
   default.
4. A failed Stripe session creation, a failure to record the direct handoff
   snapshot, or any other checkout failure after the reservation releases it
   immediately, also when expiring the Stripe session fails as well.
5. Free and fully discounted checkouts keep the reservation and fulfil at once;
   the fulfilment commits it.
6. Staff test checkouts never reserve or commit live stock. The simulated
   provider reserves and commits like a live checkout, after recording the
   order, and sends the same low-stock e-mail.

### Payment and expiry

The paid branch of `checkout.session.completed` and
`checkout.session.async_payment_succeeded` commits stock inside the payment
transaction that records the order:

- an `active` reservation becomes `committed`: `on_hand` and `reserved` both
  drop by one;
- a `committed` reservation is left unchanged, so webhook retries are safe;
- a `released` reservation (the session outlived the sweep) becomes
  `committed` with a `committed_late` event and `on_hand` drops by one;
- a tracked product of the snapshot without any reservation (orders started
  before tracking) is committed late the same way;
- an order without a checkout snapshot is committed late once: a retry finds
  the earlier commit event of that order and changes nothing;
- when `on_hand` would go below zero it is clamped at zero, an `oversold` event
  is appended, a warning is logged and the low-stock e-mail carries the
  oversold flag.

`checkout.session.expired` is not handled. The expiry sweep
`releaseExpiredStockReservations` runs on the existing minute tick (the
`/api/internal/dispatch-email` cron route and the Node ticker) before e-mail
dispatch. It releases at most 100 expired `active` reservations per run, oldest
first, each in its own transaction, and logs one line when it released any. A
failing sweep is logged and never stops that tick's e-mail dispatch.

Refunds never change stock. Staff put goods back with an adjustment whose
reason is `returned` (recorded as a `returned` event).

### Low-stock e-mail

A commit that leaves availability at or below the threshold sends the
`stock-low` e-mail to the support address, or else to every staff member in
their language, with the product title, the available count, the threshold, the
oversold flag and a Studio link. The first crossing records
`low_stock_notified_at`; later commits stay quiet until availability reaches
zero (pieces held by open checkouts count as unavailable), which alerts again.
When the workspace has no recipient the alert is not recorded as sent. An adjustment or threshold
change that lifts availability above the threshold clears
`low_stock_notified_at`. Products without a threshold only alert when oversold.
The e-mail is queued in the payment transaction.

### Public offer

The public offer exposes per product `stock: { tracked, soldOut, low }` and never
the exact count. `low` means a threshold is set and availability reached it. The
offer ETag includes a hash of these flags, so a product selling out or running
low revalidates cached offers while count changes alone do not. A sales link is
sold out when any of its products is: the direct handoff page shows the
"checkout unavailable" state (HTTP 409) instead of posting to Stripe, while
crawlers still receive the preview metadata, and the Together checkout page
disables the pay button with a "Sold out" label.

### Studio and CLI

The product editor shows on hand, reserved and available pieces, an adjustment
form (signed change and reason) and the low-stock threshold. The products list
shows "on hand · reserved", "Sold out" or "Low" for tracked products. The CLI
offers `product stock show|enable|adjust|threshold` and `product list` prints
the same summary for tracked products. All writes require `product:write`.

Stock is not part of the product content snapshot (`core/domain/snapshots/product`):
it is operational state with its own event history, so restoring a product
version never changes stock.
