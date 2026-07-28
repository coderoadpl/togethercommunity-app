# Server edge security

Together serves its SPA and API on the same origin. Session-backed API routes do
not expose CORS headers. Better Auth validates `Origin` on its authentication
POST routes, and its session cookies remain `HttpOnly` and `SameSite=Lax`;
production enables the `Secure` flag. Sessions span tenant subdomains on a real
base domain, while each custom domain remains a separate cookie world.

Open CORS is limited to `GET /api/public/offer` and its preflight because that
read-only contract is intended for external creator sites. Public checkout,
webhook, unsubscribe, confirmation, and authenticated routes do not inherit
that policy.

All responses receive the secure-header baseline. The CSP permits Emotion's
runtime styles, HTTPS images, and HTTPS lesson embeds while keeping scripts and
network requests same-origin. API request bodies are limited to 100KB before a
handler runs. JSON errors and authenticated successes are always `no-store`;
only successful public-offer responses opt into revalidated shared caching.
