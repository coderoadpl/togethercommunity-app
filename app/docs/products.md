# Product drafts

Staff with `product:write` can permanently delete a product draft only if it has never been published and has no orders, grants, sales-link items, or checkout snapshots referencing it. Unpublishing a product does not make it eligible. Publication history is now retained for new products. Existing unpublished products have unknown publication history and deletion currently refuses them; no history is inferred from their current draft state. Validation errors identify the reason deletion is refused.

The Studio product list and editor offer **Delete draft** for drafts and require confirmation. The server rechecks eligibility when deleting; an action being visible does not guarantee that the draft is eligible.

Deletion removes the product, prices, access items, and download asset rows in one transaction. After commit, stored download objects are removed through the shared download-asset cleanup path. Cleanup is best effort: failures are logged without rolling back the committed deletion.

## Draft retention exception (owner decision 2026-10-11)

Permanent deletion of a verified never-published, never-sold draft is an explicit
retention exception to the append-only history rule. It applies only after the
publication-history, order, grant, sales-link, and checkout-snapshot checks above
succeed under the tenant-scoped product row's `FOR UPDATE` lock. Published products
and products with unknown publication history are outside this exception.

The complete product foreign-key cascade includes `product_prices`,
`product_download_assets`, `product_price_history`, `coupon_checkout_sessions`,
`member_subscriptions`, `orders`, and `product_grants`. Prices and download asset
rows are explicitly deleted before the product; access items are embedded in
`products`. The order and grant checks require `orders` and `product_grants` to
be empty for this product, so their cascades are not permitted to erase sales or
access records.

- `product_price_history` rows are removed, including the base-price row created
  on every product insert and subsequent draft price changes. This draft was
  never offered publicly or sold and cannot become a future offer after deletion,
  so its price history is no longer needed for the 30-day lowest-price derivation.
  Price history for any product that has been published or sold remains protected
  by the deletion eligibility checks.
- `coupon_checkout_sessions` rows are removed as disposable checkout preparation
  for the deleted draft. This does not authorize deleting checkout snapshots,
  orders, coupon redemptions, or their events; a snapshot or order reference
  prevents draft deletion.
- `member_subscriptions` is also a product cascade target. Only residual rows for
  a draft satisfying all the checks above fall within this exception; subscriptions
  associated with an order or grant remain protected by those checks. The existing
  restrictive subscription-to-price foreign key is not bypassed: a subscription
  referencing a price being deleted makes the transaction fail and roll back,
  preserving the product and all dependent rows.

Use `product delete <id> --confirm` in the CLI. Omitting `--confirm` returns a validation error before calling the server. The staff endpoint is `POST /api/products/delete`, accepting `{ "productId": "..." }` and returning `{ "deleted": true }`.
