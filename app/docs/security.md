# Server edge security

Potential vulnerabilities must be reported privately through the repository
[security policy](../../SECURITY.md), not through a public issue or pull request.

Together serves its SPA and API on the same origin. Session-backed API routes do
not expose CORS headers. Better Auth validates `Origin` on its authentication
POST routes, and its session cookies remain `HttpOnly` and `SameSite=Lax`;
production enables the `Secure` flag. Cookie scope and the passkey relying
party are derived from the host of each request: a host under the base domain
gets `Domain=.<baseDomain>` and the base domain as its relying party, so one
session and one passkey cover the platform host and every tenant subdomain,
while a verified custom domain gets host-only cookies and its own relying
party and therefore remains a separate credential world. A `localhost` base
domain and single-tenant deployments keep host-only cookies and the configured
host as the relying party. Non-local authentication origins are HTTPS-only. HTTP origins are composed only
for `localhost`, and boot rejects an HTTP `APP_BASE_URL` outside local
development.

Magic-link, password-reset, e-mail-verification and marketing-confirmation
links are built from the resolved tenant, never from the request `Host` or a
client `x-forwarded-proto`. A tenant resolved by subdomain — including one
matched through a `subdomain` domain row — gets its own subdomain origin on
the scheme and port of `APP_BASE_URL`, a tenant resolved through a verified
custom domain gets `https://<domain>` on the HTTPS port of `APP_BASE_URL`, and
every other case — `X-Tenant` routing, single-tenant mode, an unknown host, or
a failed tenant lookup — gets `APP_BASE_URL`. Delivery contexts for the three
authentication flows are keyed by e-mail address, capped at 512 entries per
flow, and cleared once the request finishes, so a rejected request leaves no
residue for the next legitimate one.

Better Auth stores rate-limit windows in PostgreSQL so deployments, process
restarts, and serverless isolates share one bucket. Production boot requires an
explicit client-address mode. Set `AUTH_TRUSTED_PROXY_HEADER=direct` when Node
receives traffic directly and the socket peer is authoritative. The shipped
Caddy proxy overwrites `X-Forwarded-For` and uses `x-forwarded-for`; other
proxies must overwrite the selected header. Vercel uses the platform-written
`x-vercel-forwarded-for` header. Missing, malformed, and multi-hop configured
values are not treated as client addresses and emit one diagnostic per process.

Unauthenticated write routes carry their own PostgreSQL fixed-window limiter in
`rate_limit_buckets`: checkout session creation, coupon validation and the
marketing consent forms are limited per client address and per resolved tenant,
and magic-link, password-reset, sign-up and verification requests are limited
per client address and per e-mail address. The client address comes from the
same trusted forwarding resolution as authentication, never from a raw
`x-forwarded-for`, and a request whose address cannot be attributed falls back
to one shared bucket. Rejections
answer `429` with `Retry-After` and a message that does not reveal which bucket
was exhausted. Expired windows are deleted by the hourly KSeF dispatch run.

New passwords require at least 15 characters, with no character-class rules.
The 15-character floor is required because MFA remains optional; it applies to
registration, password reset, and password change. Existing imported accounts
with shorter passwords may still sign in, but any replacement password must
meet the current floor.

Open CORS covers public offer and payment configuration reads, coupon
validation, checkout-session start, auth configuration, and free lesson
previews so external creator sites can use the public checkout contract.
Sign-in method resolution (`/api/public/auth-resolve`) is excluded: it answers
CORS only to the platform host, the tenant subdomains of `APP_BASE_DOMAIN` and
the verified custom domains held in `tenant_domains`, never with a wildcard, and
a preflight from any other origin is refused. The lookup reveals only whether a
tenant member or admin holds a password credential — unknown addresses and
passwordless accounts are indistinguishable — and enumeration of that signal is
bounded by the auth-resolve per-address and per-tenant limits recorded in the
[go-live checklist](go-live-checklist.md).
Webhook, unsubscribe, confirmation, and authenticated routes do not inherit
that policy. The lesson read resolves a session when one is present and falls
back to anonymous public capabilities, which reach lessons flagged as free
previews and nothing else.

All responses receive the secure-header baseline. The CSP permits Emotion's
runtime styles, HTTPS images, HTTPS lesson embeds, and Sentry envelope delivery
while keeping other scripts and network requests same-origin. Ordinary API
request bodies are limited to 100KB. Public HTML mutations are limited to 16KB,
provider webhooks to 512KB, and bounded layout, document, and lesson authoring
payloads to 2MB. JSON errors and authenticated successes are always `no-store`;
only successful public-offer responses opt into revalidated shared caching.

## Accepted dependency advisories

`pnpm audit --prod --audit-level=moderate` is a blocking CI gate. Its allowlist
contains only this reviewed advisory:

- `GHSA-67mh-4wv8-2f99` affects esbuild's development server. The production
  audit reaches the old esbuild through `better-auth` and `drizzle-kit`.
  Together does not invoke esbuild's development server from application code.
  `drizzle-kit` resolves esbuild 0.25 only from 1.0, which in turn requires
  `drizzle-orm` 1.0 while `better-auth` still declares a `drizzle-orm` 0.45
  peer, so revisit when `better-auth` supports `drizzle-orm` 1.0.
