# S3-compatible storage

Together uploads browser assets with presigned `PUT` requests. A tenant bucket
must therefore allow the workspace platform origin and every verified custom
domain. Studio → Integrations → Storage lists the current origins and generates
the complete CORS JSON with these settings:

- allowed origins: the platform subdomain and all verified custom domains;
- allowed methods: `PUT`, `GET`, and `DELETE`;
- allowed headers: `Content-Type`;
- exposed headers: `ETag`.

The list updates when tenant routing changes. Copy the regenerated JSON to the
bucket after verifying or removing a custom domain.

Deep health sends an `OPTIONS` preflight with the tenant origin and
`Access-Control-Request-Method: PUT` to the configured bucket for every listed
origin. Results and the ten-minute probe limit are stored in the database, so
all server instances share them. A rejected response or timeout is a warning
and does not make deep health fail. The outbound probes also have a separate
per-run budget, and an unreachable endpoint is reported as unknown instead of
as a bucket CORS failure. Until a verified custom domain has a successful stored
result, Settings → Addresses links back to the storage wizard.

## File versions

Digital download products deliver personalised PDF and EPUB copies or signed,
expiring links as described below.
In the product editor, add a file or enter an optional version note and choose
**Upload new version** on a ready file. The same upload control creates a new
storage object. Completion assigns the next number in that file's lineage and
supersedes the previous latest version atomically. Version notes are trimmed,
limited to 500 characters, and visible to buyers.

Buyers with active product access see the latest ready version of each file in
My products. **Previous versions** expands the full ready version history, with
a separate download link for each version. An expired grant or a non-member
cannot download either current or previous files. Signed links retain the
existing one-hour lifetime; storage URLs are never exposed in read models.

Deleting a version removes only its row and its own storage object. Deleting
the latest version promotes the newest remaining ready version atomically.
Deleting the last ready file preserves existing behavior: the product remains
published but has no downloadable file until another upload completes. A new
publication still requires a ready file or another supported delivery method.

New versions do not automatically email buyers. The publisher can send a
campaign to announce an update. Visible watermarks and an online reader are outside this flow. The CLI currently has no product-file upload command.

The additive migration backfills existing files as version 1 in their own
lineages. Pending replacements retain their target until completion; retries of
an already completed upload do not create another version.

## Copy identifiers

Downloads during member impersonation serve the unchanged original through a
signed link after the member, active-grant and ready-asset checks. They do not
read or personalise the object and do not issue a copy registry row.

Each ordinary member download issues a fresh opaque identifier (`copy_` followed by
26 base32 characters encoding 16 cryptographically random bytes). PDF copies
carry it in the Info dictionary under `together:copy` and Keywords, and in XMP
under `together:copy` and `pdf:Keywords`. Info and XMP Keywords stay synchronized.
PDF saving rewrites the file. Signed or certified PDFs are therefore delivered
unchanged through the signed link and recorded as not personalised. PDF/A
conformance is not preserved, including the custom XMP namespace without a
PDF/A extension schema. Use the original stored file when conformance matters.
EPUB copies carry an OPF `dc:identifier` with `opf:scheme="together-copy"` and a
`meta` element with `property="together:copy"`. Existing publication identifiers
remain intact. This deliberately retains both metadata forms required by the
copy format: `opf:scheme` is EPUB 2 markup, while `meta property` and the package
`prefix` are EPUB 3 markup. Strict EPUB 2 and EPUB 3 validators therefore reject
the mixed OPF vocabulary. Use the original stored EPUB when strict conformance
is required. Only metadata changes; there are no visible marks, DRM, limits,
or notifications. A determined user can remove the metadata.

`PERSONALISATION_MAX_BYTES` defaults to 20 MiB for the Node server. The Vercel
entry point hard-clamps the effective ceiling to 4 MiB, even when configuration
requests more, to stay below the [4.5 MB Function response limit](https://vercel.com/docs/functions/limitations#request-body-size).
The clamp applies to recorded size, storage reads and final personalised output,
so oversized copies use the signed-link fallback before any response is committed.
Download lists show a note when a file is above the configured ceiling and copies
are therefore delivered without an embedded copy identifier.
The recorded asset size and
supported content type are checked before fetching. At most two personalisations
run concurrently per composed server instance through an injected slot adapter;
this is an instance concurrency limit, not a deployment-wide limit. With the
default Node ceiling, an instance can run two concurrent pdf-lib passes on
20 MiB inputs. Parsed PDF objects, decoded metadata and output buffers add
memory overhead, so 40 MiB is not a process memory ceiling. Lower
`PERSONALISATION_MAX_BYTES` when the instance memory budget requires it.
Saturated requests use the signed-link fallback before fetching any object.
Slots are released on success and failure. The S3-compatible reader
uses Content-Length to reject oversized or unknown-size objects before reading
a body, then verifies the streamed byte count without buffering above the
ceiling. PDF and EPUB personalisation buffers only capped files. EPUB container
and OPF expansion and the final output are bounded too. Other ZIP entry local
records remain byte-identical, and `mimetype` is first and uncompressed. Its
original local record is retained when already first, stored and without extra fields.

Unsupported types, oversized files, unavailable storage reads and unsupported
or malformed metadata fall back to the existing one-hour signed link. The
choice is final before any HTTP response is committed. Successful personalised
responses include the original attachment filename, content type, content
length and `Cache-Control: no-store`. Active grants and ready assets remain
mandatory for current and previous versions alike. The API method guard rejects HEAD
with 404 before Hono can dispatch it to GET; it neither fetches an object nor
creates a registry row.

The private `download_copies` registry records every issued response, including
fallbacks with `personalised=false`. Such fallback identifiers are not embedded
in the original file. The row joins tenant, member, product, asset, lineage and
version, and snapshots the filename and issue time. Personalised rows also
store SHA-256 and the exact output byte count; fallbacks leave both null. A
registry write failure prevents delivery. These are issued responses, not proof
that the client finished transferring the file.

`orderId` is the newest order for that tenant, member and product whose current
status is exactly `paid`, ordered by creation time descending and then ID
descending for ties. Pending, failed, refunded and partially refunded orders do
not qualify. When no paid order exists (for example a manual grant, M2M
enrolment or subscription access without a matching paid order), it is null.
Order selection never grants access.

Staff with `order:read` can see issued copies on order and member details and
find an identifier within the product's Downloads tab. The tenant-scoped
`GET /api/download-copies` API requires an order, member, or product plus
identifier filter. The CLI exposes the same operation through `product copies`
with `--order-id`, `--member-id`, or `--product-id` and `--copy-identifier`.
Each request returns at most 50 copies, newest first, ordered by issue time and
ID descending. The cards load further pages only through **Show more copies**.
The API and CLI accept `cursor` / `--cursor` as the last row's `createdAt`, `~`,
and URI-encoded `id` (encode any `~` in the ID as `%7E`). The next page excludes
that row and newer rows, including copies issued between requests.
There is no public registry lookup or buyer-facing registry API.

Member erasure deletes all that member's registry rows in its existing
transaction. Issuance and erasure lock the member row to prevent late registry
writes after erasure. Issued filenames and version references survive asset
deletion until member erasure or tenant deletion; original stored files remain
shared assets. Erasure cannot edit copies already held by buyers.

Tenant owners should explain this metadata identifier and its purpose,
controller access and erasure policy in their terms and privacy information.
Do not put names or email addresses into the file metadata.
