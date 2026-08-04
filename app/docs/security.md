# Server edge security

Together serves its SPA and API on the same origin. Session-backed API routes do
not expose CORS headers. Better Auth validates `Origin` on its authentication
POST routes, and its session cookies remain `HttpOnly` and `SameSite=Lax`;
production enables the `Secure` flag. Sessions span tenant subdomains on a real
base domain, while each custom domain remains a separate cookie world.

Open CORS covers public offer and payment configuration reads, coupon
validation, checkout-session start, auth configuration, and free lesson
previews so external creator sites can use the public checkout contract.
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
