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
for `localhost` and its subdomains, and boot rejects an HTTP `APP_BASE_URL`
outside local development.

## Session tokens and browsers

Better Auth's bearer plugin copies the session cookie value into a readable
`set-auth-token` response header (listed in `Access-Control-Expose-Headers`)
whenever a response sets the session cookie, and its sign-in, sign-up,
two-factor, session and session-list JSON bodies carry the session `token`.
A script on the page could read either and replay it as
`Authorization: Bearer` from anywhere for the rest of the session's lifetime,
on the platform host and on every workspace where the user has a role, which
defeats the cookie's `HttpOnly` flag. The auth adapter (`adapters/auth/browser-session-token.ts`,
applied to every Better Auth response by `createAuth`) therefore strips them
from responses to browser requests. A request counts as a browser when it
carries `Sec-Fetch-Site` or a cookie under the Better Auth session cookie name
(with or without the `__Secure-` prefix, whatever its value, so an empty one
under one name cannot mask the other). Current browsers send `Sec-Fetch-Site` on HTTPS and
`localhost` origins, and page scripts cannot set or remove it; Chrome before
76, Firefox before 90 and Safari before 16.4 (on macOS and iOS), browsers and
in-app webviews built on those engine versions, and plain-HTTP local
development hosts a browser does not treat as potentially trustworthy do not
send it, which is why a cookie-bearing request is treated as a browser too.
Such a request gets no `set-auth-token` header, no
`Access-Control-Expose-Headers` entry for it, no top-level `token`, no
`session.token` and no `token` on session-list entries.
Cookies, status codes and every other field stay unchanged, so browser
sign-in, sign-out, magic-link, passkey, two-factor and impersonation flows run
on the `HttpOnly` cookie alone; the web app never reads the token. The CLI,
the auth end-to-end harness and server-to-server smoke checks send neither
header nor session cookie (they authenticate with `Authorization: Bearer`) and
still receive the token they authenticate with. A non-browser client that keeps
a cookie jar (a cookie-keeping HTTP session object, `curl -b`/`-c`) is treated
as a browser once its jar holds the session cookie: a later sign-in that still
sends that cookie gets the new session cookie but no `set-auth-token` header and
no body `token`. Such a client keeps using the session cookie it holds, or signs
in from a client without a cookie jar. A backend that signs in to obtain a
bearer token gets no token to hand on when that request carries
`Sec-Fetch-Site` or a session cookie, the only two triggers of the strip.
Separately, such a backend should forward no other browser metadata either
(the remaining `Sec-Fetch-*` headers), even though they do not trigger it.
The auth end-to-end run (`scripts/auth-e2e.ts`) signs a browser in with a
virtual passkey, by identifier and as a discoverable credential, and asserts
that each `/passkey/verify-authentication` response (whose unstripped body
carries `session.token`) has no `set-auth-token` header, no
`Access-Control-Expose-Headers` entry for it, no `token` and no
`session.token`. It also signs in without `Sec-Fetch-Site` while sending an
empty secure-prefixed session cookie next to a valid plain one, and asserts the
same for that response.
Nothing stored changes; removing the wrapper restores the previous responses.

Remaining gaps (not closed by this change):

- A response that creates a session (sign-up, sign-in, two-factor, magic-link,
  passkey or One Tap) to a browser that sends no `Sec-Fetch-Site` (Chrome
  before 76, Firefox before 90, Safari before 16.4, browsers and in-app
  webviews built on those engine versions, or a plain-HTTP local development
  host the browser does not treat as potentially trustworthy) still carries the
  token, because that request has no session cookie yet. Every later
  cookie-bearing response is stripped.
- Google One Tap hands its credential (a Google ID token) to page JavaScript
  before the page posts it to `/api/auth/one-tap/callback`. A script already
  running on the page can intercept that credential and exchange it for a
  session. A server-issued nonce bound to the One Tap prompt would close this
  and is the follow-up. The One Tap leg of `scripts/two-factor-e2e.ts` bypasses
  the login document's content security policy and uses a fake Google provider,
  so it proves the callback and the response it gets, not that the production
  prompt loads (see [the Google smoke notes](social-google-smoke.md)).

Better Auth's provider-token routes `/get-access-token`, `/refresh-token` and
`/account-info` are disabled (`disabledPaths`, answering 404): the app never
calls them, and they would hand a page script the stored Google ID token,
which could then be exchanged for a fresh session. For the same reason the
Google provider sets `disableIdTokenSignIn`, so `/sign-in/social` accepts only
the redirect flow the web app uses; One Tap keeps its own callback route.

Follow-up (defence in depth, not needed to close the browser leak):
`bearer({ requireSignature: true })` would stop a raw `session.token` read
from the session table (a backup, a replica, read-only SQL access) from
working as a bearer credential without the auth secret. Before it can be
enabled, the clients and harnesses that send the unsigned body `token` as
`Authorization: Bearer` must switch to the signed `set-auth-token` header:
`apps/server/src/request-origin.auth.test.ts`,
`shop-management-switch.test.ts`, `shop-integration-routes.test.ts`,
`shop-settings-routes.test.ts`, `shop-proposal-groups.test.ts`,
`shop-propose-mode.test.ts`, `change-proposal-panel.test.ts`,
`shop-assets-routes.test.ts`, `shop-catalog-routes.test.ts`,
`shop-order-routes.test.ts`, `shop-management-keys-legacy-isolation.test.ts`
and `sign-in-events.test.ts` under `apps/server/src/`, plus `scripts/stripe-webhook-old-api-redelivery.test.ts`,
`scripts/change-proposal-replay.test.ts` and `scripts/shop-machine-replay.test.ts`.
Outside integrators that copied the body token would need the header too.

## Unsafe request origins

Every `/api/*` request other than `GET`, `HEAD` and `OPTIONS` passes an origin
guard before impersonation, identity resolution or route mutations. The explicit
method/path inventory in `apps/server/src/request-origin-policy.ts` classifies
session, optional-session, authentication and independently authorized routes.
Application construction and coverage tests reject an unclassified unsafe route;
the runtime fallback is protected, not exempt. There is no public/internal prefix
exemption and no exemption based on a credential-shaped header alone.

For cookie-authorized operations, `Origin` must be an exact HTTP(S) origin from
the request target's trust set: the configured application/platform origin,
the target tenant's generated subdomain, and all its currently verified custom
domains, including canonical and noncanonical aliases. Scheme and effective port
matter. Domain verification is read on each decision, without a stale allowlist
cache. Host routing takes precedence over `X-Tenant`; an unknown host cannot
become trusted by supplying that header. Account/authentication endpoints on the
platform host do not expand their trust set using a tenant header. A configured
application, platform or deployment authentication host that does not resolve to
a tenant (for example an `APP_BASE_URL` host shaped like a subdomain of the base
domain) is treated as tenantless and trusts only the configured origins; any
other host whose tenant resolution fails is rejected. A sibling tenant's origin
is never implicitly trusted.

The request authority must itself match one of those configured/verified origins.
The scheme and port come from `APP_BASE_URL` (custom domains use HTTPS), not
`Forwarded` or `X-Forwarded-*`. This also supports TLS-terminating deployments
without trusting client-supplied proxy headers. In local development only, the
shipped `http://localhost:48730` API configuration composes the explicit Vite
`http://localhost:48731` origin and corresponding tenant subdomains. The Vite
proxy preserves `Host`. Other ports are not implicitly accepted.

A missing `Origin` is accepted only with `Sec-Fetch-Site: same-origin` for a
validated target. `same-site`, `cross-site` and `none` require an allowed Origin;
`same-site` alone does not protect sibling tenants. Contradictory same-origin
metadata, malformed/multiple/opaque (`null`) origins and missing browser metadata
on cookie-authorized mutations fail closed. Rejections use the normal JSON error
seam, HTTP 403 and the stable `forbidden` code. Installed PWAs follow the same
rules. Origin permission does not grant CORS access, tenant capabilities or
cross-site cookie availability.

The independently authorized exceptions retain their own mandatory checks:
tenant API keys for import/M2M/automation and shop management, Stripe and SNS/SES provider signatures,
and scheduler/operator shared secrets. Session-backed API routes also accept a
successfully verified CLI bearer token without browser metadata: verification
runs with cookies removed, and downstream processing receives no ambient cookies
on this path. An invalid bearer that falls back to a cookie is not exempt.
Requests without any session authority still receive the route's ordinary
unauthorized response rather than gaining a session from the guard.

Better Auth browser mutations, including sign-in, password recovery, passkeys and
two-factor challenges, remain protected even when a bearer header is supplied.
CLI authentication POSTs already send their canonical API Origin, including
provisional two-factor cookie requests. Better Auth's own CSRF and callback
validation remain enabled; its broad trusted-origins list is not the tenant trust
set. Safe OAuth/magic-link GET callbacks retain their protocol validation. A new
POST callback needs an individually reviewed protocol exception, not a wildcard.

Guest checkout and survey submissions that carry no credentials, or credentials
that resolve to no signed-in user, pass the guard from any origin, including a
sales page hosted elsewhere, because they hold no ambient authority. When they
carry the session of a signed-in user, they use the exact-origin policy before
checkout test-mode authority or member attribution. The sign-in resolver, coupon
lookup and direct sales-link guest handoff keep their existing public validation; the direct
handoff retains its local-origin restriction. Embedded newsletter/signup forms
keep their explicit JSON/CORS allowlists and external HTML form-post flow and do
not consume session authority. Development-only writes retain their composition
gate and headerless automation support but reject foreign browser origins.
Scoped-token mail endpoints outside `/api` are inventoried separately: RFC 8058
one-click unsubscribe POSTs, confirmation, preference and double-opt-in POSTs
continue to accept server-to-server delivery without browser metadata.

This boundary does not isolate account-level cookies from trusted scripts already
running on a tenant's own origin. The shared-cookie vendor-script exposure
accepted in the repository policy remains; solving it requires cookie/account
isolation rather than a broader claim about CSRF protection. Such a script can
act with the cookie while the page is open, but apart from the remaining gaps
listed in [Session tokens and browsers](#session-tokens-and-browsers) it cannot
read the session token from auth responses or take a stored Google ID token to
mint a new session.

## Account and delivery boundaries

A signed-in account visiting another platform tenant without a staff grant or
membership receives a successful `/api/me` response with `tenantAccess: "none"`
and null tenant fields. The web shell presents that tenant’s public visitor
experience with an account notice, a workspace-picker link, and an account-switch
action; studio routes redirect to the visitor home. The picker includes both staff
workspaces and member communities. Tenant membership and staff grants remain
mandatory for tenant-scoped capabilities; a staff grant is either a direct
workspace grant or a role derived from the organization the workspace is linked
to (see [Organization-derived workspace roles](#organization-derived-workspace-roles)).
Custom-domain cookies remain host-scoped,
and visiting a tenant never creates a membership.

Magic-link, password-reset, e-mail-verification and marketing-confirmation
links are built from the resolved tenant, never from the request `Host` or a
client `x-forwarded-proto`. A tenant resolved by subdomain — including one
matched through a `subdomain` domain row — gets its own subdomain origin on
the scheme and port of `APP_BASE_URL`, a tenant resolved through a verified
custom domain gets `https://<domain>` on the HTTPS port of `APP_BASE_URL`, and
`X-Tenant` routing and single-tenant mode use that tenant's canonical verified
custom origin or generated tenant origin. Tenantless delivery uses `APP_BASE_URL`;
unsafe authentication requests on unknown hosts are rejected by the origin guard
before delivery context is installed. Delivery contexts for the three
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
`rate_limit_buckets`: checkout session creation, sales-link checkout, coupon
validation, survey submissions, the marketing unsubscribe, preference and double
opt-in confirmation forms and Meta conversion consent decisions are limited per
client address and per resolved tenant,
and magic-link, password-reset, sign-up and verification requests are limited
per client address and per e-mail address. The client address comes from the
same trusted forwarding resolution as authentication, never from a raw
`x-forwarded-for`, and a request whose address cannot be attributed falls back
to one shared bucket. Rejections
answer `429` with `Retry-After` and a message that does not reveal which bucket
was exhausted. Public checkout session-status polling uses a separate per-IP
`checkout-status:ip` bucket of 600 requests per five minutes in production
(60,000 in development and staging), so several buyers behind one NAT can poll
without consuming checkout-start or coupon-validation capacity. The public
parcel locker lookup has its own `parcel-locker:ip` (30 per minute in
production) and `parcel-locker:tenant` (600 per minute) buckets, and every
call to the carrier, from that route or from checkout, draws on the
platform-wide `parcel-locker:global` budget (1,200 per minute), of which the
route may use at most its `parcel-locker:public` share (600 per minute), see
[Parcel locker lookup](#parcel-locker-lookup). Expired windows
are deleted by the hourly KSeF dispatch run.

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
a preflight from any other origin is refused. It answers every address on every
tenant with the same constant list — password, passkey and magic link — without
reading account records, so the answer carries no signal about an account.
Passkeys use discoverable credentials, including conditional browser autofill.
Password sign-in answers an unknown address and a stored credential given the
wrong password with the same status and the same body, and a magic-link request
answers a known and an unknown address the same way. These three POST endpoints
have a 300 ms response floor on accepted and rejected outcomes alike. The floor
does not bound database or delivery latency above 300 ms.

Administrator invitations activate after any successful mailbox-proving
magic-link sign-in on the tenant host, including completion of required
two-factor authentication; the link need not come from the invitation e-mail.
Ordinary e-mail verification and password sign-in do not activate invitations.
When magic-link sign-in verifies a previously unverified account, the same
locked transaction removes its password credentials, passkeys, two-factor
enrollment and pending user-bound verification values, including two-factor
challenges, revokes all existing sessions and resets two-factor status before
invitation activation. This invalidates authenticators and challenges created
before mailbox ownership was proved. Already verified accounts are untouched,
and ordinary e-mail verification preserves passwords and sessions. The mailbox
owner can set a password through the e-mailed reset flow and enroll new
authenticators. Invitation activation errors are logged without blocking
sign-in.

Each endpoint has separate IP and normalized email-hash buckets: production
defaults are 60 requests per minute per IP and 10 per 10 minutes per email,
with magic links limited to 5 per 10 minutes per email. Existing public auth
limits still apply. `PUBLIC_RATE_LIMIT_SIGN_IN_PER_IP_PER_MINUTE`,
`PUBLIC_RATE_LIMIT_SIGN_IN_PER_EMAIL_PER_10_MINUTES` and
`PUBLIC_RATE_LIMIT_AUTH_LINKS_PER_EMAIL_PER_10_MINUTES` override these budgets.
Development and staging retain higher defaults for automated suites. Rejections
return `429` with `Retry-After`. Sign-in telemetry records only the normalized
email's HMAC-SHA-256 digest keyed with `BETTER_AUTH_SECRET`, outcome and reason
codes. Provider logging retains errors while suppressing warnings and lower
levels. Magic links use the existing `auth-link:email` bucket without a second
sign-in email counter.

Anonymous tenant redirects increment only an aggregate hit counter after a
per-redirect minute bucket accepts the request. The default is 600 and
`PUBLIC_RATE_LIMIT_REDIRECT_HITS_PER_REDIRECT_PER_MINUTE` overrides it. The
bucket key contains only the tenant and redirect identifiers, so the counter
stores no visitor data. Exhausting the bucket skips the counter update without
blocking the redirect, making counts a lower bound during a traffic flood.

Webhook, unsubscribe, confirmation, and authenticated routes do not inherit
that policy. The lesson read resolves a session when one is present and falls
back to anonymous public capabilities, which reach lessons flagged as free
previews and nothing else.

All responses receive the secure-header baseline. The CSP permits Emotion's
runtime styles, HTTPS images and HTTPS lesson embeds. SPA documents allow HTTPS
network requests; other responses permit same-origin connections and Sentry
envelope delivery.

For server-served HTML success returns under `/offer/` and `/checkout/`, the CSP
extends `script-src` only when `status=success`, permitting
`https://www.googletagmanager.com/gtag/` and `https://connect.facebook.net`
alongside the existing same-origin and nonce sources. The Google path prefix
permits its GA4 scripts. Meta needs its host because `fbevents.js` loads further
scripts under `/signals/config/<id>` and plugin paths. These success documents
use `connect-src 'self' https:`, including `/offer/` success returns whose other
server responses allow only same-origin and Sentry connections. The existing
`img-src 'self' data: https:` is unchanged; no vendor-specific connection sources
are added. Entry, cancellation, handoff
and other documents retain the baseline script policy, except that checkout form
documents allow the InPost parcel locker map origin as described below.

The hosted deployment serves these SPA returns statically. In `vercel.json`,
the `/offer/(.*)` and `/checkout/(.*)` success header entries both require
`status=success` and allow
`script-src 'self' https://www.googletagmanager.com/gtag/ https://connect.facebook.net`.
The content security policy entries are mutually exclusive, so the result does
not depend on which matching entry takes precedence: the catch-all excludes
`/checkout/` as well as the server-rendered prefixes, and every checkout form
entry below lists `status=success` under `missing`. All other header entries
retain the baseline policy, except the checkout form entries below.

Checkout form documents — `/checkout/<productRef>` and the hosted cart page
`/checkout/cart/pay` without `status=success`, `/offer/<slug>?checkout=together`
and `/offer/<slug>?status=cancelled` — add
`https://geowidget.inpost.pl` to `script-src` and `style-src` for the InPost
parcel locker map used by shipped products (owner decision 2026-11-05), in both
the server middleware and the static hosting headers. `connect-src` is not part
of that change: each document keeps its base value, `'self' https:` on
`/checkout/*` documents and in the static hosting headers, and
`'self' https://*.sentry.io` on `/offer/*` server responses. On a
server-rendered `/offer/*` form document the map may therefore fail to reach
InPost's API; the buyer then enters the locker code in the typed input, which
the delivery step always offers. The page injects the map script and stylesheet only
when the workspace has a Geowidget token, the buyer has chosen a parcel locker
option and opened the parcel locker picker, the checkout runs in live mode and the viewer holds no staff session
(owner or admin) for the workspace (owner decision 2026-11-05), so the map code
never runs next to a staff session or a Stripe test-mode purchase. Success,
sign-in, member and Studio documents never list that origin. Once the map
script has been injected, leaving the form document by any in-app navigation
becomes a full document navigation, as on the analytics success document, so the
map code never runs in sign-in or signed-in views. See [Shop](shop.md#content-security-policy-for-the-parcel-locker-map).
No other directive changes: `connect-src` and `img-src 'self' data: https:`
keep their base values. Routes and rewrites are unchanged.
Static headers cannot resolve tenant settings, test mode or cookie consent.
Their script allowance does not load either library: the client still requires a
configured ID, a live success return and the consent rule before loading.

The platform never loads tenant-authored scripts: checkout analytics is limited
to Google's GA4 `gtag.js` and Meta's `fbevents.js` libraries for tenant-configured
measurement and Pixel IDs, on the checkout success document only, after the
consent rule passes. The member session is not otherwise isolated from those
libraries, as on any site using GA4 or Meta Pixel.

After a checkout tag loads, navigation away from the return page forces a full
document load for the sign-in button, router links, programmatic navigation and
browser history before member or Studio content renders. Consent Mode first denies
all four categories. A matching consent cookie grants all four; explicitly
bypassing the cookie check grants only `analytics_storage`, leaving advertising
storage, advertising user data and advertising personalization denied. The public
payment configuration computes `cookieScope` from the request host: `parent`
only for a verified custom domain belonging to the tenant, and `host` on the
platform base domain and every other host. For `parent`, GA4 omits `cookie_domain`
and `cookie_prefix`, so its default automatic domain selection shares the
standard parent-domain `_ga` identifier with the creator's website. For `host`,
GA4 sets `cookie_domain` to the current document hostname and uses a host-specific
cookie prefix, so it neither shares identifiers across workspace subdomains nor
adopts an existing parent-domain `_ga` identifier.
Meta still uses its vendor-default first-party cookie behavior; the
loader does not yet isolate its identifiers across workspace subdomains. The
accepted session-cookie exposure does not authorize shared vendor tracking
cookies. A consent cookie is separate from these vendor identifiers: it must
be readable on the checkout host. A creator's unrelated domain cannot set a
consent cookie for a platform subdomain; a custom checkout subdomain can read a
consent cookie set for its shared parent domain. Meta's consent API is binary: it grants
consent once before initialization and events when the rule passes, including the
bypass path, which loads Meta Pixel in full. When the rule does not pass, Meta
consent is revoked without loading or initializing the Pixel. The owner is
responsible for applicable consent rules when enabling the bypass. Each configured
library sends page-view and purchase events independently. See [checkout analytics](payments.md#checkout-analytics).
Ordinary API request bodies
are limited to 100KB. Public HTML mutations are limited to 16KB,
provider webhooks to 512KB, and bounded layout, document, and lesson authoring
payloads to 2MB. JSON errors and authenticated successes are always `no-store`;
only successful public-offer responses opt into revalidated shared caching.

Exception (owner decision 2026-10-14, approved, implemented and recorded in
`CLAUDE.md`): on the checkout success documents
(`/offer/*` and `/checkout/*` requested with `status=success`) `script-src`
additionally lists the two vendor script sources named there, Google's tag
library and Meta's pixel library, and `connect-src` is `'self' https:` as on
other web-app documents, in both the static hosting headers and the server
middleware. Other `/offer/*` server responses retain `'self'
https://*.sentry.io`, including the checkout form documents. The
policy is static per document; the libraries are loaded
only when the workspace has configured analytics and its consent rule passes,
and leaving that document after a vendor library loads uses a full document
navigation. The accepted session exposure is platform-wide, because the base-domain
session cookie is valid on every workspace subdomain. Every other document
keeps the same-origin script policy, except the checkout form documents, which
also list the InPost parcel locker map origin as described above.

## Staff refunds

Refunding money is the `order:refund` capability, held by the workspace
`owner` and `admin` only and only with a verified e-mail address. It is not an
impersonation read capability, so every refund route, the preview included, is
refused while staff view the workspace as a member, and no tenant API key or
shop management key scope grants it: a shop key never refunds and a
propose-mode key never refunds (the use-cases also refuse a machine actor
explicitly). The three routes (`GET /api/orders/:orderId/refund-preview`,
`POST /api/orders/:orderId/refunds`, `POST /api/orders/:orderId/packing-list`)
take session credentials only, are classified `session` in the origin policy
and answer `404 not_found` for an order of another workspace. They are
rate-limited per staff member and per workspace with the shared rate buckets.

Money guards: the request locks the order row, re-reads the committed refunds,
refuses an amount above the remainder or a full refund confirmed for a
remainder that changed, and allows one refund waiting to reach Stripe per
order; each refund issues exactly its stored amount once; the request key and the Stripe idempotency key generations
make retries and lost responses safe, and Stripe refuses an amount above the
charge. The dispatcher saves a create attempt and its key generation under the
job's lease before every create call, so a worker lost after Stripe accepted a
refund leaves it recorded; a create call whose outcome is unknown (no answer, a
request still executing or a Stripe server error) keeps its key, no failed
refund list after such an attempt counts as Stripe refusing the refund, and a
refund that never saw its own Stripe refund ends `unconfirmed` rather than
`failed`. A request confirmed for a packing-list or label state that changed
since its preview is refused, so no goods return to stock behind a bought
label. The CLI refuses
any refund without the confirmed `--remainder` and, with `--json`, any
refund without `--request-key`. Each refund row keeps the requesting user's id and e-mail address
after the account is removed, as audit evidence of who moved money. The staff
note refuses control characters other than line breaks and tabs, and the
dispatcher's log lines replace Stripe object ids and keys in provider messages
with `[provider id]`. Every refund failure message has Stripe API keys and
webhook secrets replaced with `[credential]` before it is stored on the
refund, returned in the order detail or copied into a staff alert e-mail.

## Accepted dependency advisories

`pnpm audit --prod --audit-level=moderate` blocks merges through `check` only
when a pull request changes `app/package.json`, `app/pnpm-lock.yaml`,
`app/pnpm-workspace.yaml`, or `app/.pnpmfile.cjs`,
targets `main` for promotion, or runs on a push to `main`. The independent
`dependency-audit` job runs on every CI run and is advisory
(`continue-on-error`, so it cannot block): a failed run shows as a warning with
an error annotation and an advisory count in the job summary rather than a red
required check, and on an unrelated pull request it means a dependency bump
pull request is due. Owner decision 2026-10-07 (recorded in `app/CLAUDE.md`,
section on the dependency audit): the production dependency audit blocks merges
only for pull requests that change dependencies and for promotions into main;
on every other run the advisory `dependency-audit` job reports the
finding without blocking, and an unaccepted advisory is handled by a dependency
bump or acceptance before the next promotion. Accepting an advisory requires both
an `auditConfig.ignoreGhsas` entry in `app/pnpm-workspace.yaml` and its written
justification under Accepted dependency advisories.
`app/.pnpmfile.cjs` removes the optional `vitest` peer that `better-auth`
declares (and any `@better-auth/*` package that declares it), so the test
runner stays out of the production graph the audit sees;
`config-regression/auth-library-test-peer.test.ts` fails when the lockfile
carries that peer again.
The audit allowlist contains these reviewed advisories:

- `GHSA-67mh-4wv8-2f99` affects esbuild's development server. The production
  audit reaches the old esbuild through `better-auth` and `drizzle-kit`.
  Together does not invoke esbuild's development server from application code.
  `drizzle-kit` resolves esbuild 0.25 only from 1.0, which in turn requires
  `drizzle-orm` 1.0 while `better-auth` still declares a `drizzle-orm` 0.45
  peer, so revisit when `better-auth` supports `drizzle-orm` 1.0.
- `GHSA-mrhx-c7xc-m3w5` (zod, high): parsing a very large array against an
  array schema without a length constraint accumulates one validation issue per
  failing element with no cap, so an attacker can drive the process out of
  memory. The fix exists only in zod 4.6.6; Together runs zod 3 and nested zod 4
  copies are overridden to 4.6.7. Every schema parse of attacker-controlled
  input in Together runs on a request body, and bodies are capped before
  parsing by `apps/server/src/body-limits.ts` (16 KiB on public forms, 100 KiB
  on API bodies, 512 KiB on webhooks and transactional M2M calls, 1 MiB on
  contact-import row pages, 2 MiB on content and M2M import bodies, 4 MiB on
  the contact-import upload, 10 MiB on the authenticated M2M import validation,
  the largest cap), which bounds the array length and therefore the issue
  list. Webhook bodies are also signature-verified before any schema runs,
  provider responses come from the tenant's own configured integrations, and
  browser-side parsing can only exhaust the visitor's own tab. A zod 3 `.max()`
  on the array schema is not a mitigation: it records one `too_big` issue and
  still validates every element. Revisit with the zod 4 migration; until then a
  new parse of unbounded, unauthenticated input must stay behind a route body
  limit in `body-limits.ts` or check the array length before the schema runs.

## Organization-derived workspace roles

A workspace linked to an organization gives the organization's members a
workspace role without storing a workspace grant. The staff-grant lookup
(`TenantAccessReader.findStaffGrant`) is one query that maps an organization
`owner` to the workspace role `owner` and an organization `admin` to the
workspace role `admin`, and returns the higher of the direct workspace grant
and the derived role together with its source: `direct`, or `organization` when
only the derived role is higher (a tie keeps `direct`). The resolved identity
carries that source. A role is derived only for the organization the workspace
is linked to and only while that organization is `active`; the same lookup
lists linked workspaces among the member's staff workspaces. No workspace role
holds an `organization:*` capability.

- **Revocation.** Nothing is cached: each request reads the membership, its
  role, the workspace link and the organization's status again, so removing a
  member, demoting an owner to admin, unlinking the workspace or suspending the
  organization takes effect on the next request, for sessions and for shop
  management keys issued by a derived owner alike.
- **Suspension.** A `suspended` organization derives no workspace role. Its own
  session routes (`/api/organizations/:organizationId/...`) keep their reads
  (the organization, its workspaces and their configuration sources, members,
  masked secrets and audit) and refuse every write with `forbidden` until it is
  reactivated. The operator organization routes and the workspace-side unlink
  by a direct owner do not use the organization context and are unaffected. No
  route or CLI command changes an organization's status.
- **Members without an invitation.** Organization owners add members only from
  existing accounts with a verified e-mail address; no invitation is sent.
  This is acceptable because a member reaches only workspaces that were linked
  with a direct owner's consent: linking needs an organization owner who also
  holds a direct owner grant in the workspace. Any direct owner of a linked
  workspace can take it out of the organization at any time with
  `POST /api/tenant/organization/unlink`, organization member or not, and any
  organization owner can unlink it from the organization side; both are
  refused with `conflict` only while the workspace takes a configuration group
  from the organization.
- **Direct-only readers.** The workspace staff list (`listStaffForTenant`),
  which supplies staff notification recipients, and the team members of the
  team list read direct grants only, so neither includes derived staff; the
  team list shows them in a separate read-only organization section. Removing a user whose only access is derived answers
  `organization_managed` (HTTP 409, CLI exit 32).
- **Results that outlive the request.** Creating a tenant API key, adding or
  removing a team administrator and the workspace-side unlink require the
  owner role to come from a direct workspace grant; an owner whose role comes
  from the organization is `forbidden`. Shop management keys stay open to such
  an owner because the issuer's role is checked again on every request with
  the key (below).
- **What remains after a derived role ends or is lowered.** Removal from the
  organization, unlinking the workspace and suspending the organization end
  the derived role on the next request. Demoting an organization owner to
  organization admin does not end it: the derived workspace role becomes
  `admin` (source `organization`). In every one of these cases the shop
  management keys the person issued stop on the next request, because a key
  needs its issuer to hold the workspace owner role; only a direct owner grant
  in the workspace keeps them working. None of them undoes what the person did
  with the role. Workspace changes made in the meantime stay in force: the
  payment account configuration, object storage and other workspace secrets,
  custom domains, products, coupons, sales links and scheduled marketing
  sends. Legacy tenant API keys are not affected by organization changes:
  organization-derived roles and the direct-grant requirement for creating
  such a key (above) arrive in the same release, so a role that comes only
  from the organization has never been able to create one, and every key in
  `tenant_api_keys` was created by a direct owner of the workspace. After
  removing or demoting an organization member, a direct owner of each linked
  workspace should review those settings.

## Tenant API keys

The `report:read` scope grants only the `report:read` capability through the
`report-api-key` principal. It cannot be combined with enrollment, marketing,
transactional, or either import scope. Legacy unscoped keys do not gain reporting
access. Import scope combinations and expiry rules remain unchanged.

Report keys may omit expiry, like other non-import keys; no separate maximum
lifetime is imposed. Owners can revoke them through the existing key controls.
Creating a tenant API key requires the owner role to come from a direct
workspace grant, because the key outlives an organization-derived role; an
owner whose role comes from the organization is `forbidden`.
Studio supports exclusive report keys and both English and Polish copy.

The [activity reports API](reports-api.md) accepts API-key authentication only.
Every lookup uses the resolved tenant. Sign-in activity comes only from that
tenant's `member_events`, joined to its current members. Global auth sessions
are never a report data source. Session credentials alone cannot access reports.
An API key issued for one tenant cannot be used for another. Both endpoints use
the existing API-key minute/day policy and atomic PostgreSQL rate buckets before
reading reports. Revocation and expiry are checked on each request.

Report responses contain member email addresses and use `Cache-Control: no-store`.
Report telemetry records route templates and status, without response rows or
query strings. Database exceptions are sanitized at the report adapter boundary
because driver exceptions can include bound email filters. Reporting uses the
normal application repository connection and requires no database role changes.

### Shop management keys

A program may operate a workspace's shop with a token instead of a session
(owner decision 2026-11-14, recorded in `CLAUDE.md`). Such a token is a shop
management key stored in its own table, `shop_management_keys`; the existing
tenant API keys (`tenant_api_keys`, the legacy keys) are not changed in shape,
rows or code path. The two never cross: the legacy authenticator looks keys up
only in `tenant_api_keys`, so it refuses a shop key on every existing API-key
route, and the shop authenticator looks keys up only in
`shop_management_keys`, so a legacy key is unknown on a shop route. The
database requires an issuer, an expiry and a non-empty array of known shop
scopes on every shop key.

- **Binding.** A key belongs to one workspace and records the verified owner
  who created it; that owner role may be direct or derived from the
  organization the workspace is linked to. Only that kind of owner, in their own session (no member
  view, no capability override, no API key), creates, revokes or purges shop
  keys or reads their history. Each request selects the workspace by host or
  `X-Tenant` like the other API-key routes, and the key lookup is scoped to
  that workspace.
- **Revalidation.** Every request re-reads the key and the issuer: the key must
  be unrevoked and unexpired, and the issuer must still exist, have a verified
  e-mail address and hold the owner role in that workspace, read through the
  same staff-grant lookup as a session. Nothing is cached between requests, so revocation, expiry,
  demotion, removal or account deletion takes effect on the next request; for
  an issuer whose owner role is organization-derived, so do leaving the
  organization, losing its owner role, unlinking the workspace and suspending
  the organization.
- **Expiry.** An expiry is mandatory and at most 30 days after creation; there
  is no renewal.
- **Scopes.** `shop:catalog:read|write`, `shop:orders:read`,
  `shop:fulfilment:write`, `shop:settings:read|write` and
  `shop:integrations:read|write` map to a fixed capability list. The request
  acts as the issuer's real account with the capabilities of its scopes
  intersected with the owner's, so `authorize()` stays default-deny and a key
  never exceeds its issuer.
- **Fulfilment scope.** `shop:fulfilment:write` grants `order:write`, which
  includes creating carrier shipments (InPost ShipX), a paid action at the
  carrier charged to the workspace's carrier account. A key reaches it through
  `POST /api/m2m/shop/orders/<orderId>/shipx` (see
  [InPost ShipX credentials](#inpost-shipx-credentials)).
- **Uniform refusal.** A missing key answers `401 Missing API key`; an unknown,
  revoked, expired, legacy or other-workspace key and an issuer who no longer
  qualifies all answer the same `401 Invalid API key`. A missing scope answers
  `403` after the rate limit.
- **No mixed credentials.** A shop route refuses any request that also carries
  a `Cookie` or an `Authorization` header with `401` before any key lookup,
  records only `app.api_key.match=mixed_credentials` on its span, never falls
  back to a session and never upgrades one. The routes live only under `/api/m2m/shop`,
  each needs a "Shop management key" entry in the self-authenticating route
  manifest, and their unsafe methods are classified `api-key` in
  `apps/server/src/request-origin-policy.ts`; registration fails otherwise.
- **Client.** The typed client and the CLI send the key only in `x-api-key`,
  read it from an environment variable, never from an argument, and never
  follow a redirect, so the key cannot reach another URL.
- **Rate limits.** Each key has atomic PostgreSQL buckets of 60 requests a
  minute and 10,000 a day with `Retry-After`, in their own table
  `shop_management_key_rate_limit_buckets` whose rows go with their key. A request refused by the minute
  bucket does not consume the day bucket, and a day refusal returns its minute
  unit.
- **Propose mode.** A key created with `mode: "propose"` (immutable) never
  changes live state. Its write scopes grant only `proposal:submit:catalog` and
  `proposal:submit:settings` in place of the live write capabilities, and
  `shop:fulfilment:write` and `shop:integrations:write` cannot be granted to
  it. A write scope requires its read scope (`shop:catalog:write` needs
  `shop:catalog:read`, `shop:settings:write` needs `shop:settings:read`): the
  creation schema, a database check on `shop_management_keys` and the
  submission use-case, which also authorizes the family's read capability
  (`product:read`, `tenant:settings:read`), each enforce it. Whether a dry run
  accepts or refuses a proposal depends on live state (a negative stock
  adjustment, the effect size), so a write-only key could otherwise probe
  values it cannot read; with the rule, a propose-mode key learns nothing from
  a refused or accepted proposal that it could not read with its read scope. Every shop write route declares a propose-mode class in
  `apps/server/src/shop-machine-auth.ts` and the server refuses to start
  without one: the ten catalogue write routes, the three sales-link write
  routes and the settings update store a
  [change proposal](change-proposals.md) instead of running their handler,
  every other write route (images, fulfilment, integrations) answers `403`,
  and a test drives a propose-mode key
  over every registered shop route and asserts that no live row changed. A
  proposal's effect comes from a dry run of the live use-case in a transaction
  that is always rolled back, with non-database effects deferred to a commit
  that never happens. The key's receipt never carries the effect, a before
  value, a live label, the issuer's state or the deciding account; after an
  approval it names only the id of the applied resource, which the key can
  already read with its read scope. The owner view adds a display label read
  from live state at read time (never used by a decision), the issuing
  account's e-mail and whether it is still a verified owner of the
  workspace, and the deciding account's e-mail.
  Only the verified owner in their own session reads, approves and
  rejects proposals (`proposal:read`, `proposal:decide`, owner-only); an admin, an
  impersonating owner, a direct-mode key, a propose-mode key and a legacy key
  are refused. Proposals carry no foreign key to their key, so the history
  survives a purge, and revoking or purging a key withdraws its pending,
  unexpired proposals in the same transaction. Pending proposals are capped at
  200 per key and 1,000 per workspace and creation at 500 per key a day,
  checked read-only before the dry run and again atomically at insert. A dry
  run never takes a second database connection (the storage credentials of a
  draft deletion are read through the transaction) and locks its target with
  `FOR NO KEY UPDATE` so it cannot deadlock with a live stock write. Every
  lock wait of a dry run or an approval transaction, the workspace lock, the
  proposal row, the target rows, the rows the live use-case locks and the
  sales-link workspace lock, is bounded by a transaction-local 5-second
  `lock_timeout`; a wait that runs out rolls the whole transaction back and is
  answered `503` with a `retry-after` on the keyed routes and on the owner
  approve route, so queued proposals cannot hold pool connections without
  bound and nothing is applied. Approval runs in one transaction: it locks the
  pending, unexpired proposal row, re-reads the clock (a proposal that expired
  during the wait is recorded as expired and not applied), re-validates the
  stored input strictly (an unknown operation, or an unknown key at any depth
  such as a retired field or a settings field outside the key's allow-list,
  makes it `stale` without running anything), locks the target and re-reads
  the clock again, runs the live use-case as the approving owner inside a
  savepoint, recomputes the effect and commits the change only when it equals
  the stored effect the owner saw; otherwise the savepoint is rolled back and
  the proposal becomes `stale`, or `failed` when the live use-case refuses the
  command itself. Any other error of the live use-case (an infrastructure,
  configuration or caller code, see `describesTheRequest` in
  `core/domain/errors.ts`) rolls the whole transaction back, leaves the
  proposal or the whole group pending and answers that error. A reject and a
  withdrawal lock the proposal row before they read the clock, so a proposal
  that expired during the wait is recorded as expired, never decided. A draft
  deletion's effect lists everything it destroys (every price, every download
  file, the stock), read under the exclusive locks the deletion takes, so a
  file uploaded after the proposal makes it `stale`. Settings writes lock the
  workspace row `FOR NO KEY UPDATE`, which does not conflict with the key-share
  lock a key event's foreign key takes, so a settings approval and a key
  revocation share only the proposal row lock and cannot deadlock. There is no intermediate state, so a
  repeated or concurrent approve finds no pending row and gets `409`; an
  infrastructure failure rolls everything back and leaves the proposal
  pending. Non-database effects of an applied change run only after the
  commit. The database checks only the shape of a stored operation name; a
  row whose operation the running release does not know stays readable and is
  never applied. A writer that read the row before the approval took its lock can
  still overwrite the applied change afterwards, as between any two writers
  today. A retention purge of settled proposals is a follow-up. The owner
  panel's summary (`GET /api/change-proposals/summary`) is owner-only like the
  list and returns `{ pending, pendingGroups, hasProposals }`: the pending and
  pending-group counts and whether the workspace holds any proposal at all,
  whatever its status. A submitted proposal raises an in-app notification for
  the workspace owners (direct and organisation-derived, the same effective
  grant as the owner session), at most one unread per owner and key (the
  notification's unique source key, which is per key, makes it atomic); a group
  raises it once, with its first item; its later items signal the owner's open
  panel and never make a read notification unread again. It names only the key and the group title, carries no
  effect, and is written after the proposal committed, in its own transaction
  with a 500 ms bound on every lock wait and statement, and the submission
  stops waiting for it after 500 ms in any case, so a held or failing
  notification is logged and never fails, changes or holds up the submission
  beyond that bound. Each re-armed
  notification gets a new id, so a late "mark read" of an earlier one cannot
  clear it. The owner view shows an account's e-mail only while that account
  holds a staff grant in the workspace; a former team member or a deleted
  account is shown as such, without its address.
- **Proposal groups.** A propose-mode key may group proposals that depend on
  each other; the owner approves or rejects the group as one unit. Only the
  key that created a group joins, reads or withdraws it: the
  `x-proposal-group` header is read once by the shared shop dispatch,
  validated as an identifier, ignored for a direct-mode key, and the group is
  looked up by workspace and key, so another key's or another workspace's
  group answers `404` like an unknown id. A later item names what an earlier
  item of its group creates only as `$proposal:<proposal id>` and only in the
  id positions of its operation; such a reference resolves only to an earlier
  item of the same group, key and workspace that creates that kind of
  resource, never to a live id, and anything else is refused with `400`.
  Submitting an item replays the group's earlier items and the new item in
  one transaction that always rolls back and keeps only the new item's
  effect, so it leaves nothing behind; an earlier item that no longer applies
  answers `409` and stores nothing. Created ids appear in stored effects only
  in their reference form, which names the creating item, so swapping
  references between items changes the effect. The owner's approval names
  the ordered item ids they were shown; any other list answers `409`, so an
  item added after the owner looked is never applied, and the owner CLI
  approves only with the digest of the item ids that `proposals group show`
  printed, sending nothing when the group changed since. One transaction locks
  the group and its items, applies each item with every check of a single
  approval and commits only when every item matches; otherwise all live work
  is rolled back and every item is recorded `stale` or `failed`. Targets are
  locked in item order; two groups locking the same rows in opposite orders
  end on the bounded lock wait or the database's deadlock detection and are
  answered busy with nothing applied. A grouped item cannot be decided on its
  own. A group holds at most 50 items and a key at most 20 open groups; with
  the key's rate limit, one dry run per group at a time and the per-statement
  time bounds of dry runs and approvals, that bounds the cost of the
  replaying dry runs.
- **Off switch.** The server variable `SHOP_MANAGEMENT_KEYS` set to `disabled`
  answers every request under `/api/m2m/shop` and `/api/m2m/entitlements` with `404` before any session,
  cookie or key is read, records only the switch state on the span, performs
  no key lookup and refuses key creation; existing keys stay listable,
  revocable and purgeable. An unknown value stops the server from booting.
- **Purge.** `POST /api/api-keys/shop-management/purge` is the owner's kill
  switch for one workspace: it deletes every shop key and every application key
  of the workspace, revoked or not, with their rate-limit buckets, in one
  transaction. The legacy keys are untouched. It needs a verified owner in
  their own session, and an owner whose role comes from an organization may
  run it too: it is the stop action, so it deliberately does not require the
  direct workspace grant that creating, listing and revoking application keys
  require.
- **Rollback.** Migration 0159 only adds the three shop tables and leaves
  `tenant_api_keys` untouched, and the previous release never reads the new
  tables, so a retreat to it needs no purge; the off switch and the purge stay
  owner controls, not rollback steps. A release that predates migration 0163
  reads shop keys but not their mode, and refuses a propose-mode key with
  `401`: the key's stored hash is taken in a separate propose-mode hash
  domain, so the plain hash of the presented secret finds no row. Such a key
  never gains live write access, direct-mode keys keep working, and pending
  change proposals stay untouched until the roll forward; no purge is needed.
  Migration 0164 widens the operation check to a shape check and is not
  undone by a code rollback: a release with 0163 and only the ten catalogue
  operations answers `500` on every proposal read that meets a sales-link or
  settings proposal, and applies nothing; count those rows before such a
  rollback (the query is in [change proposals](change-proposals.md#rolling-back)).
- **Attribution.** Creation, revocation, purge and every keyed `POST`, `PUT`,
  `PATCH` or `DELETE` to a shop route that passed every check write a row to
  the dedicated `shop_management_key_events` table with the key id, never the
  secret or its hash; the workspace audit list is unchanged. A request row is
  written before the handler runs: if it cannot be written the request answers
  `503` with `Retry-After` and nothing changes, so no keyed change commits
  without its row, and no write follows the handler, so a committed change is
  never answered as an error. A request refused before the handler (the off
  switch, the body size limit, mixed credentials, the key or issuer checks, the
  rate limit or a missing scope) writes no row and is recorded in its request
  span only, so those refusals cannot grow the table. A refusal returned by the
  handler (a validation error, an id of another workspace, a conflict) does
  have a request row, written before the handler ran, which does not record
  the refusal. The rate limits bound the rows of one key to 10,000 a day; the
  bound multiplies by the number of keys, which is not capped per workspace,
  and a retention job for `shop_management_key_events` is a follow-up, so the
  history grows until its workspace is deleted. A row keeps a resource id
  only when it is an identifier of at most 200 characters matching
  `^[A-Za-z0-9][A-Za-z0-9._:-]*$`; the database enforces the length and the
  pattern with its own checks. Every shop request span records `app.api_key.match` and, when the secret matched a key
  row, `app.api_key.id` and `app.api_key.issuer.id`.
  Changes the reused use-cases record elsewhere (product versions, stock
  events, order fulfilment and shipment events, stored secrets) are
  attributed to the issuing owner's account; the key history row is what
  tells a key's change apart from the owner's own. A request row names the
  resource from the path, else the body's `id` or `productId`, and for the
  generic secret routes the secret's name only when it is one of the
  allow-listed names below; it never copies a credential, a credential
  identifier such as the storage access key id or the ShipX organization id,
  or a signed storage URL.
- **Hash secrecy on failure.** A database driver error carries the query's
  bound parameters, and the key hash is one of them. Every shop key query that
  takes a key hash (the lookup and the insert) replaces a database error with
  a parameter-free `API key lookup failed` or `API key write failed` in the
  repository, before it can reach the error handler, telemetry, a log or a
  response. The legacy key repository is unchanged.
- **Integration scope.** `shop:integrations:write` grants `tenant:secret:write`
  and nothing else, and a key ctx holds that capability only for an operation
  on the allow-list in `core/domain/shop-management-key.ts`, checked in
  `core/server/authorize.ts` below every route: the Stripe configure and
  permission probe use-cases (the payment account, including the live slot;
  configuring creates the webhook signing secret and endpoint id), the ShipX
  configure use-case (the credentials of both carrier connections and the
  sender), the storage configure
  use-case (the object storage connection) and the generic secret write or
  delete of the invoicing credentials (`ifirma.invoiceApiKey`,
  `ifirma.username`, `ksef.token`, `ksef.contextNip`, `ksef.test.token`,
  `ksef.test.contextNip`). A key never writes a webhook signing secret or
  endpoint id directly, the Meta Conversions API token, a video-hosting,
  marketing, mail or telemetry credential or any other secret name, and never
  runs a connection test (`integration:test`), whichever route calls the
  use-case; owner sessions keep every write they have. Within its workspace a
  key with this scope reaches those use-cases only through these routes:
  `POST /api/m2m/shop/integrations/stripe/configure`, the live Stripe slot
  included (owner decision 2026-11-14), and
  `POST /api/m2m/shop/integrations/stripe/probe`, which checks the stored
  Stripe key; `POST /api/m2m/shop/integrations/storage/configure`, which
  probes the bucket against the workspace origins before it stores anything;
  `POST /api/m2m/shop/integrations/shipx/configure` (see
  [InPost ShipX credentials](#inpost-shipx-credentials)); and
  `POST /api/m2m/shop/integrations/secrets` and
  `DELETE /api/m2m/shop/integrations/secrets/:key`, whose accepted names are
  that same domain allow-list (`SHOP_MANAGEMENT_KEY_SECRET_KEYS`) and whose
  use-cases name the secret to the guard. Any other secret name answers `400`
  and changes nothing, so the keyed generic route never reaches the Stripe,
  storage, ShipX, Meta, video, mail or telemetry secrets.
  These routes reuse the owner session's use-cases and validation, refuse
  unknown body fields, and `shop:integrations:read` returns masked previews
  only. Each accepted call writes its key history row before the use-case
  runs, so a configure or secret call whose row cannot be written answers
  `503` and stores nothing. A stolen key with this scope can therefore
  redirect the workspace's live payments and storage until it expires, is
  revoked or the off switch is set.
  `shop:settings:write` grants `tenant:settings:write`, and a key ctx holds
  that capability only when the use-case names the shop settings update or
  the branding asset upload with fields from the allow-list
  `SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS` in `core/domain/shop-management-key.ts`,
  checked in `core/server/authorize.ts`; a grant naming any other field is
  refused, and the settings update refuses a change to a field its grant does
  not name. `POST /api/m2m/shop/settings` names exactly the fields present in
  its body, and its strict body schema is derived from that same allow-list.
  Every other use-case that needs `tenant:settings:write` (team,
  domains, redirects, Meta Conversions API settings, telemetry store) refuses
  a key ctx; owner and admin sessions are unchanged.

Whoever holds a key can change that workspace's shop within its scopes and,
with `shop:integrations:write`, its payment configuration, until the key
expires or is revoked; the owner accepted this risk. See
[Shop management keys](shop-management-keys.md) for the procedure.

### Application keys

Another application of the workspace owner may ask whether a person currently
has access to the workspace's products ([integration guide](entitlement-check.md)).
It uses an application key: a separate key kind in its own table,
`application_keys`, next to shop management keys and the legacy keys, and it
reaches exactly one route, `POST /api/m2m/entitlements/check`.

- **Separate kind.** The stored hash is taken over the secret in its own hash
  domain, and every other machine route looks keys up in its own table, so an
  application key is unknown on every other route and a shop or legacy key is
  unknown on the check route. A release without application keys never reads
  their table, so after a rollback each such key fails closed by itself and the
  shop key list and authentication are unchanged (no closed scope list of an
  older release meets a new value).
- **Binding and revalidation.** A key belongs to one workspace. Only a verified
  owner in their own session with a direct workspace grant (no member view, no
  key, no organization-derived role) creates, lists or revokes keys one by
  one. The purge, the stop action, stays open to every verified owner in their
  own session, an organization-derived owner included, and deletes application
  keys with the shop keys. Every
  check re-reads the key and the issuer: unrevoked, unexpired, issuer verified
  and still a direct owner. A missing key answers `401 Missing API key`; every
  other failure answers the same `401 Invalid API key`.
- **Scopes.** `entitlements:check` (required; grants only `entitlement:check`)
  and `entitlements:members:read` (optional; grants `entitlement:member:read`),
  intersected with the owner's capabilities. The use-case also refuses any
  caller that is not an application key, so an owner session or a shop key
  cannot reach it. A key may carry a product allow-list of at most 50 products
  of its workspace; a request naming another product is `403` without a partial
  answer. Expiry is mandatory and at most 90 days.
- **Read-only, no session, no CORS.** The route refuses a `Cookie` or an
  `Authorization` header with `401`, is classified `api-key` in the request
  origin policy and sends no CORS headers. It writes nothing but its history
  row and its rate-limit bucket.
- **Matching.** An e-mail address is looked up as an account first: the
  account must have a verified e-mail address, and the member is the
  workspace's member row of that account (unique per workspace and account),
  never a row matched by its stored e-mail. Deleted and erased members never
  match. A member id is accepted only from a key holding
  `entitlements:members:read`, the scope that hands member ids out; imported
  member ids can be chosen by the importer, so they are not treated as secret.
  A member found by id must belong to an existing account with a verified
  e-mail address, the same rule as for an e-mail lookup, and a lookup that
  matches nobody runs the same sequence of queries as one that matches.
  Either way the member must also have at least one `sign-in` event in
  `member_events` of the answering workspace. The account's verified flag
  alone is not proof: an import by any workspace owner sets it for an address
  without an account. A sign-in to this workspace (magic link, password,
  passkey or Google) is made by the person. So a person matches only when the
  account is verified and its member in the workspace has a recorded sign-in;
  a buyer created by a payment matches only once a sign-in is recorded for
  their member, normally through the link in the purchase e-mail.
- **Indistinguishability.** Without `entitlements:members:read` an unknown
  person, an unverified address, a member without a recorded sign-in, a
  deleted or erased member and a known person without access give the same
  entry (`access: false`, `source`, `subscription` and `member` null) or the
  same empty list. A subject that matches nobody runs the same sequence of
  queries as one that matches, with placeholder ids whose results are
  discarded. Staff roles are ignored: the answer comes from live grants only,
  so it never reveals who is staff.
- **Answer.** Per product: `access`, `source`, the subscription status, period
  end and cancel flag, and the check time. Per person, `identity` is
  `verified` only when the answer already reveals the match (access to an
  answered product, or a key with `entitlements:members:read`), otherwise
  `null`. Never a name, an address, an order, an amount, a coupon or a
  provider id. The answer echoes the selector that was sent and returns no
  other address. A subscription is named as the source of the access, and
  shown to a key without `entitlements:members:read`, only when the grant has
  an expiry and the newest subscription for the product is active or past due
  or paid through the check time.
- **`source` is informational.** It is the origin recorded on the grant when
  the grant was created (a payment, staff, an import); a payment origin is
  reported as `subscription` while a current subscription keeps the window
  moving, under the rule above. A later renewal of the same grant through
  another route keeps the recorded origin: `createOrRenewGrant` in
  `core/server/usecases/grant-window.ts` changes the window, not the source.
  So `source` is not proof of what paid for the current window; `access` is
  the answer to rely on.
- **What `entitlements:members:read` reveals.** With this scope a person who
  matches (a verified account whose member in the workspace has a recorded
  sign-in) is named with the member id, independently of product access, and
  a lapsed subscription is shown. A `null` member does not prove that the
  person is not a member: a member whose account is unverified or who has no
  recorded sign-in answers like an unknown person.
- **Scopes a later release adds.** Reading a stored key (listing,
  authentication, revocation) drops scope values this release does not know,
  so such a key only lacks their capabilities and never breaks the list;
  creating a key still refuses an unknown scope. The table's scope check
  (migration 0169) lists the two scopes, so a release that adds a scope widens
  it in an additive migration first.
- **Rate limits.** Per key, weighted by the number of people in the request
  (at most 25): 300 a minute and 20,000 a day, in
  `application_key_rate_limit_buckets`, with `Retry-After`. The key is
  authenticated before the body is parsed. A request refused before parsing
  (wrong media type, over the size limit) is not counted against the key and
  writes no history row; a body that is not valid JSON costs one unit.
- **History without the identifier.** Each check that passed authentication
  and the rate limit writes one `request` row to `shop_management_key_events`
  (route, method, key id, issuer) before it reads anything, and answers `503`
  if the row cannot be written. The row holds no identifier and no count. A
  salted hash was rejected: with the salt in the same database, a hash of an
  e-mail address is a stable pseudonym that anyone with database access can
  confirm by guessing, and the history needs only which key was used and when.
- **Identifiers kept out of errors and logs.** E-mail addresses travel only in
  the `POST` body, never in a URL. The queries that carry the checked
  person's e-mail address or member id run in the subject reader
  (`adapters/db/entitlement-subjects.ts`), which replaces a database error,
  whose message carries the bound parameters, with `Entitlement check
  database query failed` plus the SQLSTATE when the driver gave one. The key
  lookup has its own boundary that drops the driver error, because it carries
  the key hash. The rate-limit and history writes carry no identifier of the
  person checked. Validation errors of the check carry field paths and issue codes
  only, never request text. Telemetry records the route, the status, the key
  attribution and, exactly as on the shop management key routes, the identity
  of the owner who issued the key; never the person checked.
- **Known limitation: sign-in proof belongs to the member row.** The
  operator's bulk import, a database-level tool, can move an existing member
  to another account; such a member then matches at the new address without a
  new sign-in. The keyed import route refuses to change an imported member's
  e-mail address.
- **Known limitation: rate-limit release after a window change.** A request
  computes its windows when it starts. When another request has already moved
  the key's bucket to a newer window by the time the claim is stored, the
  claim is charged to that newer window, and a later release of that request
  (history unavailable, or the day limit refused after the minute claim) does
  not find its window, so the weight stays charged. Each such request can
  leave its own weight behind, always in the limiting direction.
- **Rollback.** Migration 0169 only adds `application_keys` and
  `application_key_rate_limit_buckets`, and the previous release never reads
  them. Its purge, however, does not delete application keys, and it has no
  route that revokes them. After a retreat to it, purge or revoke the
  application keys again as soon as this release is back; a key known to have
  leaked is revoked before the retreat.

Whoever holds an application key learns, within its products, whether a person
of their choice is a customer with access, at the rate limit, until the key
expires or is revoked.

## Public newsletter signup

`POST /api/public/marketing/forms/:slug/submit` resolves the tenant from the
request host and ignores tenant-selection headers. Only active forms and
active optional marketing consent definitions can collect signups. The
16 KiB body limit is applied before parsing or rate-limit email extraction;
oversized signup requests return 413. Names are limited to 120 characters.
Addresses are normalized and never included in route logs or error details.

The shared public rate-limit repository enforces separate signup buckets:
`PUBLIC_RATE_LIMIT_SIGNUPS_PER_IP_PER_MINUTE` defaults to 10 in production,
and `PUBLIC_RATE_LIMIT_SIGNUPS_PER_EMAIL_PER_10_MINUTES` defaults to 3. The
email bucket uses a SHA-256 digest scoped to the tenant; the IP comes only from
the trusted connection/proxy policy. Development defaults are 1000 and 100.
Environment overrides follow the existing rate-limit convention, including
zero to disable a bucket. Rejections carry `Retry-After`. HTML form posts
over the per-IP limit get a minimal 429 page from the rate-limit middleware;
over the per-address limit, the submit handler reads the limiter result before
submitting and answers with the form page and its rate-limit error.

Browser JSON requests and preflights require an exact origin in the form's
allow-list. No credentials or wildcard origins are enabled. Ordinary HTML
form posts support cross-site embeds without CORS. Every real submission must
carry the form revision's public token. The token binds an embed to its wording
snapshot; it is public and is not an authentication credential. A filled
honeypot silently succeeds without creating contact, consent, or mail records.
`MarketingSignupDeps.abuseCheck` is an optional pre-write integration point
for a future abuse-verification provider.

The response status is determined solely by the consent definition, including
for existing and suppressed addresses. Submission responses have a minimum
500 ms duration, and confirmation delivery is asynchronous. This reduces the
usefulness of timing differences without promising constant database latency.
The hosted success URL contains no recipient information. Redirect targets
must use HTTPS without embedded credentials; users cannot override them in a
submission. Consent, submission history, and mail enqueueing share the submission
transaction; deferred contact and list effects commit in the confirmation
transaction. Public submissions never lift a suppression.


## Operator tenant provisioning

- `POST /api/internal/tenants/provision` requires the operator secret and the
  `tenant:provision` capability. It creates a tenant, the existing verified owner's
  grant, and an audit event atomically, with retries deduplicated by slug and owner.
- `GET /api/internal/tenants/:slug/readiness` requires the same secret and
  `tenant:readiness`. It returns only configuration booleans, a probe timestamp,
  the Stripe mode and the published-product count.

Both routes compare `x-scheduler-operator-secret` with `deps.operatorSecret`
using `secretEquals` before parsing input or accessing repositories. An early
route-specific guard also rejects invalid secrets before the global impersonation
middleware can resolve a session cookie. They are
registered on the internal app and excluded from public manifests. Session roles
have neither capability. Like neighboring operator routes, they have no separate
rate limiter. Public `TENANT_CREATION` policy is unchanged.

The provisioning body rejects unknown fields, including storage and Stripe
credentials. The owner configures those integrations in the panel or with the
existing owner CLI commands after creation. Operator CLI commands read the secret
only from `OPERATOR_SECRET`, never a flag, and redact transport exceptions.
Requests carrying the operator secret refuse redirects, preventing the header
from being forwarded to another origin.
See [operator tenant provisioning](tenant-provisioning.md) for the procedure,
readiness evidence limits and recovery behavior.

## Download copy privacy

The copy registry is tenant-scoped and requires `order:read`. Public and member
read models do not expose identifiers, hashes, order links or registry rows.
The member download path retains its active-grant and ready-asset checks. It
serves the unchanged original through a signed link during member impersonation
without reading, personalising or issuing a copy, so operator downloads cannot
be attributed to the member. For ordinary member requests, it
checks recorded size before fetching, enforces the storage Content-Length
ceiling before reading a body, and writes the registry before sending a file
or signed redirect. Personalised files are private, `no-store` responses.
Member erasure removes registry rows; see [copy identifiers](storage.md#copy-identifiers).

## Parcel locker lookup

`GET /api/public/parcel-lockers/<code>` is the one public route that makes the
server call a third party on an anonymous request. Its limits:

- The outbound call goes to one fixed host,
  `https://api-shipx-pl.easypack24.net/v1/points/`, for live and test mode; no
  part of the URL comes from configuration or from the request except the code.
- The code must match `^[A-Z0-9]{4,12}$` after trimming and upper-casing before
  any call, and is URL-encoded anyway. The route reads only its `:code` segment;
  a query string or extra path segments are never forwarded.
- The call sends no credentials (the Points resource is public), follows no
  redirects, times out after 3 seconds and is never retried. Any failure answers
  `unavailable`; the checkout then stores the code as unverified instead of
  blocking the sale.
- The answer is parsed with zod and reduced to the code, a name, an address and
  a usable verdict; nothing else from the carrier reaches the caller.
- The route answers only in a workspace with an active parcel locker option (a
  `not_found` error otherwise, with no carrier call), is same-origin only (no
  open CORS), returns `Cache-Control: no-store` and is limited per client
  address (`parcel-locker:ip`, 30 per minute) and per workspace
  (`parcel-locker:tenant`, 600 per minute). The per-address bucket keys a
  single address, also for IPv6. Known limit: a client holding an IPv6 /64 can
  rotate addresses and get a fresh per-address bucket each time; the
  per-workspace bucket and the public share below still cap it.
- Every call to the carrier, from the public route and from checkout session
  creation alike, first claims the platform-wide `parcel-locker:global` budget
  (1,200 per minute) in a wrapper around
  the adapter, so lookups from many addresses, workspaces and checkouts cannot
  add up at the carrier from the platform's one egress address. A lookup
  refused before the carrier would be asked (malformed code, no parcel locker
  option, a per-address or per-workspace limit) does not use the budget. When
  the budget is spent the lookup answers `unavailable` without asking the
  carrier, so checkout stores the code as unverified.
- The public route also claims a platform-wide `parcel-locker:public` share
  (600 per minute) right before the carrier
  call, after every local refusal, so anonymous lookups can use at most half of
  the global budget and checkout session creation always keeps the other half.
  When the share is spent the route answers `unavailable` without asking the
  carrier. Checkout never claims this share.
- These four figures hold on every deployment that asks the real carrier
  (`PAYMENT_PROVIDER=stripe`), whatever its `APP_ENV`, so a staging that runs
  Stripe test mode cannot send InPost more than production does. Only a
  deployment with the fake directory (`PAYMENT_PROVIDER=fake`) uses the
  development values (3,000 per address, 60,000 per workspace, 120,000 global,
  60,000 public), and none of them reaches the carrier.
- A claim on either budget that throws (a lock or statement timeout on the
  shared row) counts as a spent budget (`lookupBudgetSpentOnError` in
  `apps/server/src/parcel-locker-budget.ts`): the carrier is not asked, the
  error goes to the request span and the server log, and the lookup answers
  `unavailable`, so checkout stores the code as unverified instead of answering
  500. The claim itself has no time bound of its own; it waits as long as any
  other database statement. The per-address and per-workspace limits and the
  checkout write limits are not wrapped: a throw there still fails the request.

Checkout session creation asks the carrier through the same adapter, also
within the existing checkout write limits. See [the shop guide](shop.md#parcel-locker-lookup-at-the-carrier).

## InPost ShipX credentials

Each workspace keeps two ShipX connections, `production` for live orders and
`sandbox` for test-mode orders. Their organization ids and API tokens are
encrypted tenant secrets (`shipx.production.organizationId`,
`shipx.production.token`, `shipx.sandbox.organizationId`,
`shipx.sandbox.token`), written only through the owner-only
session route `POST /api/integrations/shipx/configure` (or the owner-only
generic tenant-secret route) and through the keyed
`POST /api/m2m/shop/integrations/shipx/configure` with a
[shop management key](#shop-management-keys) holding
`shop:integrations:write`. A shop management key may write them only through
the ShipX configure use-case, never through the generic tenant-secret write;
the keyed generic secret route refuses all four names, which stay off the
shop-key secret allow-list, and the configure route writes no other secret
name. Saving or clearing one connection never touches the other's rows. They
are returned only as
masked previews. They are not part of tenant
settings, the public offer or the public payment configuration. The server
decrypts them only for a ShipX call, and only the connection of the order's
mode: a test-mode order never resolves the production credentials or the
production URL, and a live order never the sandbox ones. The readiness check on
the order page asks the secret repository whether both secrets of that
connection exist without decrypting them. There is no data migration: the
legacy single-connection rows (`shipx.organizationId`, `shipx.token`) keep
serving only the connection that the workspace's stored environment names, for
each value that connection has no row of; a connection row that cannot be
decrypted never falls back to them, and an order of the other mode never reads
them. Removing the credentials of that connection deletes the legacy rows as
well (see
[Upgrade from the single connection](shop.md#upgrade-from-the-single-connection)). None of these ShipX secrets is inherited from an organization: an organization may store ShipX credentials, but a workspace always reads its own, so one connection never combines an organization value with a workspace value. Each
`order_shipments` row keeps a plain copy of the organization id it was created
with (an identifier that also appears in every ShipX URL), so later calls for
that shipment can refuse to run against another organization or another
connection than the order's mode; the shipment
view returned to staff omits it, and the token is never copied. Error envelopes carry
only the ShipX error key, a description cut to 300 characters with control
characters removed and the field keys of the validation details, never the raw
body or the token. The adapter refuses redirects, so the bearer token is only
sent to the configured ShipX host.

Only POST routes call ShipX or write shipment state: creating the shipment
(`POST /api/orders/<orderId>/shipx`), refreshing a stored shipment that is not
bought yet (`POST /api/orders/<orderId>/shipx/refresh`), fetching the label
(`POST /api/orders/<orderId>/shipx/label`) and discarding an unconfirmed attempt
(`POST /api/orders/<orderId>/shipx/discard`). Each requires `order:write`, records
an `order_shipment_events` row with the staff user for every change it stores,
and is classified `session` in `apps/server/src/request-origin-policy.ts`, so a
cookie-authenticated request from a foreign origin is refused before the handler
runs. `GET /api/orders/<orderId>/shipx` (`order:read`) is read-only: it returns
the readiness and the stored shipment without calling ShipX, decrypting the
credentials or writing anything, so a cross-site GET, which the origin guard
does not inspect, cannot cause a carrier call or an event.

The same four calls exist for shop management keys under
`/api/m2m/shop/orders/<orderId>/shipx` (`POST` to create, `/refresh`, `/label`
and `/discard`) and require `shop:fulfilment:write`, which grants only
`order:write`. They are classified `api-key` in
`apps/server/src/request-origin-policy.ts`, refuse any request that carries a
cookie or an `Authorization` header, run the same use-cases with the same lease
rules, and act as the key's issuer: each stored change records
an `order_shipment_events` row with the issuing owner as the staff user, and
the key history records the key id, the route and the order id of every call
that passed the key checks, before the use-case runs, so a call the use-case
then refuses (a lease conflict, a missing configuration, an order of another
workspace) keeps its history row. A call refused by the key checks writes no
history row, and when the row cannot be written the call answers `503` with
`Retry-After` without calling ShipX or changing the order. `POST` to create
buys the shipment at InPost, charged to the workspace's carrier account, so
a key with `shop:fulfilment:write` can spend carrier money (owner decision
2026-11-14).
`GET /api/m2m/shop/orders/<orderId>/shipx` (`shop:orders:read`) is read-only
like its session twin.

Labels are proxied: `POST /api/orders/<orderId>/shipx/label` returns the PDF with
`Content-Disposition: attachment` and `Cache-Control: private, no-store`, so no
ShipX origin is added to any content security policy and the browser never
contacts ShipX. Deployments with `PAYMENT_PROVIDER=fake` use the in-process
fake client for every order and never call InPost; with `PAYMENT_PROVIDER=stripe`
the real client serves every order, against the sandbox for test-mode orders and
against production for paid orders, and a missing connection refuses the
order. See [Which ShipX client answers](shop.md#which-shipx-client-answers).

## Meta conversions credentials

The Meta Conversions API access token is the tenant secret
`analyticsMetaCapiAccessToken`, not a tenant setting. It is encrypted at rest
with AES-256-GCM under `SECRETS_MASTER_KEY` and written or removed only through
the owner-only tenant-secret routes (`POST /api/tenant-secrets`,
`DELETE /api/tenant-secrets/:key`). A shop management key never writes or
removes it: the token is not on the shop management key allow-list, so the
keyed `POST /api/m2m/shop/integrations/secrets` and
`DELETE /api/m2m/shop/integrations/secrets/:key` refuse it and no other keyed
route writes it. Reads return only the key, the update time
and the literal `configured`, never a token fragment. The server decrypts it
when the checkout status decides whether to offer the consent prompt, when a
new consent decision is recorded and when a dispatch builds a request. It is sent only to
`https://graph.facebook.com/<version>/<pixel id>/events`, in the `Authorization`
header and never in the URL; the request refuses redirects and times out after
5 seconds.

Capturing a decision makes no Meta request. The dispatch tick calls Meta only
for an order whose buyer granted consent for that order and has not withdrawn
it. Before every attempt it rechecks that the workspace still has the feature
enabled with a pixel id and a stored token; that the order is a live-mode
Stripe order from a `cs_live_` checkout session with status paid, partially
refunded or refunded and a paid time in the past and less than seven days ago;
and that the buyer's member record exists, has not been erased and has an
email address. The request carries one `Purchase` event with the order id, the
paid time, the workspace's offer or checkout URL without a query string, the
SHA-256 of the trimmed, lower-case buyer email and, when available, the IP
address, user agent and `_fbp` value captured with the consent request, an
`fbc` value built from the stored `fbclid`, the SHA-256 of the customer country
captured from Stripe, and the order's amount, currency and product ids; the
workspace's test event code is added when configured. The
[field table](integrations/meta-capi.md#delivery-and-fields) lists the sources.

Meta's response body is never stored. A receipt keeps the status, the field
names sent, Meta's trace id only when it is at most 100 letters, digits, `_` or
`-` and does not contain the access token, and a fixed error label
(`http_<status>`, `invalid_response`, `network_or_timeout`, `invalid_pixel_id`
or `invalid_tenant`); dispatch failures log a fixed message without request or
response data. Consent, retention and
retry rules are described in [Meta Conversions API](integrations/meta-capi.md).
