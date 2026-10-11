# Product drafts

Staff with `product:write` can permanently delete a product draft only if it has never been published and has no orders, grants, sales-link items, checkout snapshots, coupon checkout sessions, or subscriptions referencing it. Unpublishing a product does not make it eligible. Publication history is retained for new products. Existing unpublished products have unknown publication history and deletion refuses them; no history is inferred from their current draft state. Validation errors identify the reason deletion is refused.

The Studio product list and editor offer **Delete draft** for drafts and require confirmation. The server rechecks eligibility when deleting; an action being visible does not guarantee that the draft is eligible.

Deletion removes the product, prices, access items, and download asset rows in one transaction. After commit, stored download objects are removed through the shared download-asset cleanup path on a best-effort basis. Cleanup failures, including infrastructure rejections, are logged without changing the successful deletion response or preventing cleanup of the remaining objects.

## History retention

An eligible draft can be deleted even if it has prices or price history. The existing tenant/product foreign key cascades deletion to that draft's price history, including its automatically created base-price row, within the same transaction. Both the tenant/product and price foreign keys remain enforced. Other tenants' products and price history are unaffected, and a later product reusing the deleted draft's ID does not inherit its price history. Products that have ever been published remain protected from draft deletion.

The repository checks references under the tenant-scoped product row's `FOR UPDATE` lock before deleting anything. Coupon checkout sessions and subscriptions prevent deletion, including residual records without an order or grant.

Use `product delete <id> --confirm` in the CLI. Omitting `--confirm` returns a validation error before calling the server. The staff endpoint is `POST /api/products/delete`, accepting `{ "productId": "..." }` and returning `{ "deleted": true }` when eligible.
