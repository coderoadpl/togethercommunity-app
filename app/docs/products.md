# Product drafts

Staff with `product:write` can permanently delete a product draft only if it has never been published and has no orders, grants, sales-link items, or checkout snapshots referencing it. Unpublishing a product does not make it eligible. Publication history is now retained for new products. Existing unpublished products have unknown publication history and deletion currently refuses them; no history is inferred from their current draft state. Validation errors identify the reason deletion is refused.

The Studio product list and editor offer **Delete draft** for drafts and require confirmation. The server rechecks eligibility when deleting; an action being visible does not guarantee that the draft is eligible.

Deletion removes the product, prices, access items, and download asset rows in one transaction. After commit, stored download objects are removed through the shared download-asset cleanup path. Cleanup is best effort: failures are logged without rolling back the committed deletion.

Use `product delete <id> --confirm` in the CLI. Omitting `--confirm` returns a validation error before calling the server. The staff endpoint is `POST /api/products/delete`, accepting `{ "productId": "..." }` and returning `{ "deleted": true }`.
