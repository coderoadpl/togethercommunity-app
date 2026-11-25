# Product drafts

Staff with `product:write` can permanently delete a product draft only if it has never been published and has no orders, grants, sales-link items, checkout snapshots, coupon checkout sessions, or subscriptions referencing it. Unpublishing a product does not make it eligible. Publication history is retained for new products. Existing unpublished products have unknown publication history and deletion refuses them; no history is inferred from their current draft state. Validation errors identify the reason deletion is refused.

The Studio product list and editor offer **Delete draft** for drafts and require confirmation. The server rechecks eligibility when deleting; an action being visible does not guarantee that the draft is eligible.

Deletion removes the product, prices, price history, access items, and download asset rows in one transaction. After commit, stored download objects are removed through the shared download-asset cleanup path on a best-effort basis. Result-based cleanup failures are logged without changing the successful deletion response or preventing cleanup of the remaining objects. Infrastructure promise rejections propagate to the server error seam, which returns an internal error; the database deletion has already committed and remaining objects are not processed in that request.

## Sales channel

Every product has a sales channel: `any` (the default) or `sales_links_only`. A
`sales_links_only` product can be bought only inside an active sales link; every
standalone purchase answers exactly as for an unknown product, and the product
never appears in the listed catalogue whatever its visibility. A variant group
makes the product available in every link that contains one of its siblings, at
its own price. Access of people
who already own it does not change. A membership cannot be `sales_links_only`.
Set it in the product editor next to **Visibility**, with `--sales-channel` in
`product create|update`, or with `salesChannel` in the product API, the import API
and the shop manifest. See
[Products sold only through sales links](sales-links.md#products-sold-only-through-sales-links)
for what is refused and what stays allowed. Restoring a product version never
changes its sales channel.

## Gallery

Besides its cover (`coverUrl`), every product has an ordered gallery, `images`:
a list of at most 12 `{ "url": "<image-url>", "alt": "<alternative text>" }`
entries. `url` takes the same forms as the cover (an absolute HTTP(S) URL or a
root-relative platform asset path such as
`/api/public/assets/product-image/<file>`) and appears at most once; `alt` is
trimmed text of up to 250 characters and defaults to `""`. A new product starts
with `[]`.

The staff product API, the shop management key routes, the import API and the
shop manifest accept `images`. An update with `images` replaces the whole list
in the given order, `[]` clears it, and an update without the field keeps the
stored gallery; the Studio editor has no gallery editor yet and never sends the
field, so saving a product there keeps its gallery. Gallery images are uploaded
like covers, with the `product-image` asset kind
(`POST /api/image-assets/product-image/upload` and `.../complete`, PNG, JPEG,
WebP or SVG up to 5 MiB); completion publishes the image without attaching it.
From the CLI, `product image-upload <file>` prints the URL and
`product update <id> --images-file <path>` sets the gallery (see [CLI](cli.md)).

The public offer and the sales-link offer lines return `images` (`[]` when
empty) next to `coverUrl`, with URLs in the same form. Product versions carry
the gallery like the cover, so restoring a version restores its gallery;
restoring a version saved before galleries existed clears the gallery. The
version preview lists the gallery in order, so a version that differs only in
its gallery or in the order of its images shows the gallery as changed.

Rollback: migration 0171 adds `products.images` with the default `[]`. The
previous release ignores the column, so its product writes keep the stored
gallery and its public offer omits `images`; storefronts then fall back to
`coverUrl`. Product content versions written by this release are snapshot
version 12; that release refuses to open or restore them as newer than its
version 11 and leaves the rows intact.

Pending change proposals survive the release in both directions. A product
without gallery images has no `images` entry in a proposal's effect, so a
product creation or draft deletion proposed before this release still applies
after it, and a product creation proposed without `images` stores no `images`
key in its input, so the previous release can still apply it after a rollback.
The previous release marks a proposal that sends `images`, or the draft
deletion of a product with gallery images, stale on approval and changes
nothing.

## History retention

A never-published draft without orders, grants, sales-link items or checkout references can be deleted. Its prices, price history and download assets go with it. Automatically recorded base prices and zero-price entries do not prevent deletion. Other tenants' data is unchanged. Products that have ever been published remain protected from draft deletion.

The repository checks references under the tenant-scoped product row's `FOR UPDATE` lock before deleting anything. Coupon checkout sessions and subscriptions prevent deletion, including residual records without an order or grant.

Use `product delete <id> --confirm` in the CLI. Omitting `--confirm` returns a validation error before calling the server. The staff endpoint is `POST /api/products/delete`, accepting `{ "productId": "..." }` and returning `{ "deleted": true }` when eligible.
