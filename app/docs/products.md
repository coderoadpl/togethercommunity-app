# Product drafts

Staff with `product:write` can permanently delete a product draft only if it has never been published and has no orders, grants, sales-link items, checkout snapshots, coupon checkout sessions, subscriptions, or price history referencing it. Unpublishing a product does not make it eligible. Publication history is retained for new products. Existing unpublished products have unknown publication history and deletion refuses them; no history is inferred from their current draft state. Validation errors identify the reason deletion is refused.

The Studio product list and editor offer **Delete draft** for drafts and require confirmation. The server rechecks eligibility when deleting; an action being visible does not guarantee that the draft is eligible.

Deletion removes the product, prices, access items, and download asset rows in one transaction. After commit, stored download objects are removed through the shared download-asset cleanup path. Expected cleanup failures returned as `Result` values are logged without rolling back the committed deletion. Infrastructure rejections propagate to the server error seam; the committed database deletion cannot be rolled back at that point.

## History retention

Draft deletion does not authorize erasing append-only history. The repository checks all references under the tenant-scoped product row's `FOR UPDATE` lock before deleting anything. A price-history row, coupon checkout session, or subscription prevents deletion, including residual records without an order or grant. The product foreign-key cascades therefore cannot remove these records through this action.

The current database trigger appends a base-price history row for every new product, including an unpublished draft. Consequently, normally created drafts currently fail the price-history check. Making those drafts deletable requires a separately approved retention policy or a design that preserves their history; this feature grants no retention exception.

Use `product delete <id> --confirm` in the CLI. Omitting `--confirm` returns a validation error before calling the server. The staff endpoint is `POST /api/products/delete`, accepting `{ "productId": "..." }` and returning `{ "deleted": true }` when eligible.
