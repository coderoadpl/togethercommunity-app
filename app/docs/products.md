# Product drafts

Staff with `product:write` can permanently delete a product draft only if it has never been published and has no orders, grants, sales-link items, checkout snapshots, coupon checkout sessions, or subscriptions referencing it. Unpublishing a product does not make it eligible. Publication history is retained for new products. Existing unpublished products have unknown publication history and deletion refuses them; no history is inferred from their current draft state. Validation errors identify the reason deletion is refused.

The Studio product list and editor offer **Delete draft** for drafts and require confirmation. The server rechecks eligibility when deleting; an action being visible does not guarantee that the draft is eligible.

Deletion removes the product, prices, access items, and download asset rows in one transaction. After commit, stored download objects are removed through the shared download-asset cleanup path on a best-effort basis. Cleanup failures, including infrastructure rejections, are logged without changing the successful deletion response or preventing cleanup of the remaining objects.

## History retention

Draft deletion preserves append-only price history, including the base-price row created automatically for a new draft. Migration `0142_retain_draft_price_history` removes the product and price foreign keys from price history so deleting a draft cannot cascade-delete its history or null out its historical price IDs. The original tenant, product, price, amount, and timestamp remain unchanged; the tenant foreign key and lookup index remain in place.

The repository checks references under the tenant-scoped product row's `FOR UPDATE` lock before deleting anything. Coupon checkout sessions and subscriptions prevent deletion, including residual records without an order or grant.

Use `product delete <id> --confirm` in the CLI. Omitting `--confirm` returns a validation error before calling the server. The staff endpoint is `POST /api/products/delete`, accepting `{ "productId": "..." }` and returning `{ "deleted": true }` when eligible.
