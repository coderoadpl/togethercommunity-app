# Product drafts

Staff with `product:write` can permanently delete a product draft only if it has never been published and has no orders, grants, sales-link items, checkout snapshots, coupon checkout sessions, subscriptions referencing it, or recorded price history. Unpublishing a product does not make it eligible. Publication history is retained for new products. Existing unpublished products have unknown publication history and deletion refuses them; no history is inferred from their current draft state. Validation errors identify the reason deletion is refused.

The Studio product list and editor offer **Delete draft** for drafts and require confirmation. The server rechecks eligibility when deleting; an action being visible does not guarantee that the draft is eligible.

Deletion removes the product, prices, access items, and download asset rows in one transaction. After commit, stored download objects are removed through the shared download-asset cleanup path on a best-effort basis. Result-based cleanup failures are logged without changing the successful deletion response or preventing cleanup of the remaining objects. Infrastructure promise rejections propagate to the server error seam, which returns an internal error; the database deletion has already committed and remaining objects are not processed in that request.

## History retention

Draft deletion refuses any `product_price_history` row, including the automatically recorded base price and zero-price entries. Only drafts with no recorded price history are eligible. The current insert trigger records a base price for every newly created product, so even a fresh draft is retained. Refusal leaves the product, prices, access items, download assets, and all price history unchanged. Other tenants' price history does not affect eligibility. Products that have ever been published remain protected from draft deletion.

The repository checks references under the tenant-scoped product row's `FOR UPDATE` lock before deleting anything. Coupon checkout sessions and subscriptions prevent deletion, including residual records without an order or grant.

Use `product delete <id> --confirm` in the CLI. Omitting `--confirm` returns a validation error before calling the server. The staff endpoint is `POST /api/products/delete`, accepting `{ "productId": "..." }` and returning `{ "deleted": true }` when eligible.
