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

## Image prefixes

Image assets (covers, branding images, avatars) live under these prefixes in the
tenant bucket:

| Prefix | Holds | Served |
|---|---|---|
| `image-asset-candidates/<workspace>/<kind>/` | an upload between its presigned `PUT` and its completion | never. Completion deletes it, also when its checks fail; the minute sweep deletes a propose-mode key's candidate 20 minutes after its upload started, completed or not, a second `PUT` through a still valid URL included. A live upload that is never completed stays, and the storage orphan report lists it |
| `image-assets/<workspace>/<kind>/` | completed images, and images a change proposal approval published under their SHA-256, written just before that approval commits; a copy written by an approval that then did not end applied stays until its withdrawal or the minute sweep deletes it | through `/api/public/assets/<kind>/<file>`, a redirect to a signed `GET` |
| `image-asset-quarantine/<workspace>/<key id>/<kind>/` | images a propose-mode shop management key uploaded, awaiting the owner's approval | never publicly; the owner previews them through the change proposal owner route |

A propose-mode key's presigned `PUT` targets the candidate prefix like any
other upload, so the bucket CORS rules above cover it; its signature also
covers `content-length`, so the bucket accepts only a body of the declared
size. The quarantine is
described in [Change proposals](change-proposals.md#images).

## Download file prefixes

Product files live under the workspace's private download prefix:

| Prefix | Holds | Served |
|---|---|---|
| `<workspace>/product-downloads/<product>/<file>/` | files uploaded in the product editor | to buyers with active access, through a signed `GET` or a personalised copy |
| `<workspace>/product-downloads/key-uploads/<key id>/` | a shop management key's upload between its presigned `PUT` (signed for the declared size) and its completion | never. A completion copies it server-side and deletes it; the minute sweep deletes it again once its upload record is 20 minutes old and no completion holds it, a second `PUT` through a still valid URL included |
| `<workspace>/product-downloads/key-files/<key id>/<file>/` | files a shop management key staged, by completing an upload or by a server-side copy of a ready product file; once attached, the product file itself | never while staged; an attached file is served like any other product file |

A key writes only its own `key-uploads/` object, through the presigned `PUT`
of its upload ([Download files](shop-management-keys.md#download-files)).
Only the server writes under `key-files/`: the completion of an upload and a
key's copy of a ready product file write the staged object with the
workspace's storage credentials, which no key ever receives. The server-side
copy into `key-files/` replaces the object metadata with
`application/octet-stream`, `attachment` and `no-store`, so no header the key
sent with its upload survives.

Who deletes them:

- a `key-uploads/` object: a completion that staged it or that failed for a
  definite reason (nothing uploaded, a wrong size or type, a copy the storage
  refused), and the minute sweep once its upload record is 20 minutes old and
  the lease of its last completion attempt (10 minutes) has ended;
- a `key-files/` object that is still staged: a completion or copy that wrote
  it and then failed for a definite reason, the key's discard, and the minute
  sweep 7 days after staging or once the key is revoked, expired or purged;
- the destination of a completion or copy whose storage outcome is unknown (a
  copy or read the storage did not answer in time, a connection error, a server
  error, a copy answer without a copy result): only the minute sweep, once its
  record is 20 minutes old and the attempt's lease has ended, because a copy
  the storage still runs may land after any earlier delete. Until then the
  record keeps the upload object and the destination, and both count against
  the key's limits;
- the destination of a completion attempt that a later completion took over:
  the takeover writes a destination of its own under a fresh file id and, in
  the same transaction, records the earlier destination as an owed deletion
  that is due 30 minutes after the earlier attempt started. The minute sweep
  deletes it then, whether or not an object is there, and it counts against the
  key's limits until the storage confirms the delete;
- a `key-files/` object that is attached: removing that file version (by a key
  or in the product editor) or deleting the draft product.

Every staged or upload object is owned by a database row: an upload or copy
record (its upload object, and its destination until a completion hands it to a
staged row), a staged file, or an owed deletion. Completions, copies, the
key's discard and file removal, and the minute sweep hold that row until the
storage answers, so an attach that takes the object over in the meantime is
never undone. Removing a file version or deleting a draft product whose file
object is under `key-files/`, and discarding a staged file, record the
object's deletion in `change_proposal_download_deletions` in the same
transaction, owed by the key whose `key-files/` prefix holds the object,
whoever removed the file; the owed bytes count against that key's and the
workspace's staging limits until the storage confirms the delete
([Download files](shop-management-keys.md#download-files)). After a key's
removal or discard the deletion that follows holds and removes that row; after
a removal in the product editor or a draft deletion the object is deleted once
after its row as before, without the owed row, and the minute sweep deletes it
once more and removes the row. That delete cannot remove a newer file: every
completion attempt and every copy writes a destination of its own under a fresh
file id, and no path writes to a `key-files/` address that a staged file or a
product file names. A late copy of a superseded completion attempt lands only on
that attempt's own destination, which no staged file names and the sweep
deletes. This rests on one assumption: an S3-compatible provider finishes or
abandons a CopyObject it accepted within 30 minutes; the signed copy request
itself expires 60 seconds after it was signed.

The minute sweep never holds back e-mail and refund dispatch: the cron route
runs it after them with an end 50 seconds after the tick started, 10 seconds
before the 60-second function limit, and the Node ticker runs it beside them.
It has a budget of 10 seconds of its own and stops at the earlier of the two
ends. It starts a row only when what is left covers a lock wait of at least 250
milliseconds and 1 second for each of the row's storage deletes (two for an
upload record that still owns its upload object and its destination). The row's
lock wait gets what is left minus those seconds, and each delete, the lookup of
the storage endpoint included, gets at most 10 seconds and what is left minus 1
second for each delete still to come in that row, so the sweep's lock waits and
storage requests end by its end; the 10 seconds before the function limit are
for its database statements and the answer. It serves workspaces, and inside a
workspace one queue of upload and copy records, staged files and owed deletions
(an owed deletion with a not-before time only once that time passed), longest
waiting first, by the time of a row's last failed delete or else its creation;
a failed delete records its attempt, so rows whose deletion keeps failing move
behind the others. A row another request holds past the lock wait, and a row
the budget could not cover, are tried again on the next run. Each state change of an
upload or copy record is appended, in the same transaction, to
`change_proposal_download_upload_events` (the record, the key, the attempt, the
kind of change and a short machine reason), which the sweep deletes 30 days
after each event. The storage orphan report counts the objects these rows name
(staged objects, the upload object and the destination of an open record, owed
deletions) as pending, and classifies an attached object like any other
product file. Files uploaded in the product editor are deleted as before: the
object is deleted once after its row.

A file a key staged is stored as `application/octet-stream` with a bare
`attachment` disposition, and a buyer's signed link asks the storage for the
file's type and name instead (`response-content-type`,
`response-content-disposition`). The storage probe that runs when storage is
configured or tested signs such a read of its scratch object and reports
`signedResponseOverrides` in its diagnostic: `"honoured"` when the answer
carries the requested type and name, `"ignored"` when the provider answers the
read without them, and `"refused"` when the read with the overrides fails. None
of them fails the configuration. With a provider that ignores the overrides, a
buyer receives such a file as an `application/octet-stream` download named
after the last segment of its stored object, the file's sanitised name. For a
provider that refuses them the diagnostic message is a warning that buyer
download links carry these overrides, so buyers may not be able to download
files from it.

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
campaign to announce an update. Visible watermarks and an online reader are outside this flow. The CLI has no product-file upload command for an owner session; a direct-mode shop management key uploads and attaches files with `shop files upload` ([Download files](shop-management-keys.md#download-files)).

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

## Database connections

The node-postgres pool expires idle connections after 30 seconds, enables TCP
keepalive, limits connection attempts to 10 seconds, and allows the process to
exit while connections are idle. Neon can close idle connections while a
serverless function remains warm, leaving a dead connection available for reuse.
The pool removes and closes a failed idle client before emitting its error;
the registered error listener logs the failure so it cannot become an unhandled
pool error that crashes the process. The listener does not release the client
again. These settings do not affect the neon-http driver.
