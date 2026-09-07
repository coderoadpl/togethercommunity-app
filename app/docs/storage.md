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
