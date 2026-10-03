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

Digital download products deliver files only through signed, expiring links.
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
campaign to announce an update. Personalization, watermarks, and an online reader
are outside this flow. The CLI currently has no product-file upload command.

The additive migration backfills existing files as version 1 in their own
lineages. Pending replacements retain their target until completion; retries of
an already completed upload do not create another version.
