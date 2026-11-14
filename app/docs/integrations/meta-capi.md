# Meta Conversions API

Meta CAPI sends a server-side `Purchase` only after the buyer explicitly grants
consent for that order. Payment fulfillment never waits for a decision or for
Meta. The payment webhook does not enqueue conversions. The existing browser
pixel retains its separate consent-cookie gate; neither that cookie nor the
analytics bypass setting grants CAPI consent.

## Configuration

The owner configures the existing Meta pixel ID and a privacy-policy URL, then
sets these tenant settings through `POST /api/tenant/settings` or the CLI:

| Setting | Meaning |
|---|---|
| `analyticsMetaCapiEnabled` | Defaults to false; enables the consent prompt and dispatch eligibility |
| `analyticsMetaCapiTestEventCode` | Optional Events Manager test code; 1–100 ASCII letters, digits, underscores or dashes |
| `analyticsMetaCapiConsentHeading` | Optional plain text, at most 200 characters |
| `analyticsMetaCapiConsentBody` | Optional plain text, at most 4000 characters |
| `analyticsMetaCapiConsentAcceptLabel` | Optional plain text, at most 80 characters |
| `analyticsMetaCapiConsentDeclineLabel` | Optional plain text, at most 80 characters |

Null copy values restore the locale-resolved defaults: English for `locale=en`
and Polish for `locale=pl`. A missing locale resolves to English. Tenant overrides
take priority in both locales.
Checkout status and the consent POST carry the same locale; the server resolves
and hashes that exact copy and privacy URL. Switching locale fetches a distinct
status query, and a stale text version is rejected before the first decision. The default describes purchase
value, ad click and browser identifiers, hashed email, IP, user agent and country;
Meta Platforms Ireland; measurement, optimization, matching and personalization;
voluntary consent; and withdrawal without promising deletion of already delivered
events. The checkout response supplies the privacy-policy URL separately. The
workspace must identify the controller and publish its applicable privacy notice
before enabling the feature.

`analyticsMetaCapiAccessToken` is a **tenant secret**, not a tenant-settings JSON
property. The existing tenant-secret API encrypts it at rest. Its read response
contains only the key, update time and the literal `configured`, never a token
fragment. Use the owner-only secret set/delete operations; the token is sent to
Meta in the Authorization header, never in the URL.

```sh
pnpm --silent run cli --tenant acme tenant settings-set --analytics-meta-capi-enabled true
pnpm --silent run cli --tenant acme tenant settings-set --analytics-meta-capi-test-event-code TEST123
pnpm --silent run cli --tenant acme tenant settings-set --analytics-meta-capi-test-event-code ''
pnpm --silent run cli --tenant acme --json meta-capi events
```

Use `tenant-secret set analyticsMetaCapiAccessToken <value>` to store a token and
`tenant-secret delete analyticsMetaCapiAccessToken` to clear it. The existing CLI
accepts the value as an argument: prefer the settings form for manual entry, and
never paste literal tokens into shell history or shared command output. Copy flags follow their setting names in
kebab case, for example `--analytics-meta-capi-consent-heading`; an empty string
restores the default.

## Studio and buyer experience

In **Studio → Settings → Analytics**, configure CAPI next to the Meta pixel
ID. The toggle, test event code and four consent-copy fields save with the
analytics form. Empty copy fields restore the defaults shown as placeholders.
The separate write-only token card saves or removes the encrypted secret and
shows only whether it is configured. Only workspace owners can manage it.

On `/checkout/<slug>?status=success` and `/offer/<slug>?status=success`, an eligible
paid order with no decision opens an accessible consent dialog over the return
page. Accept and decline have equal visual weight. Neither is preselected;
Escape or the backdrop closes the dialog without recording a choice. Dismissal
is remembered for that browser tab session; a later session can ask again only
while the order remains undecided. The expandable field list and privacy-policy
link are available before choosing.

Either choice closes the dialog immediately; the purchase never waits for the
write request. The request includes the current `_fbp` cookie when available.
A failed write shows an error and clears the session dismissal marker so that
reloading can retry with fresh consent text. Browser pixel behavior is unchanged.

Members can review decisions per order and withdraw under **Account →
Notifications → Purchase sharing with Meta**; the card appears only once the
member has at least one recorded decision, or with an error and a retry action
when the decision list cannot be loaded. Guests return to the original
purchase-success link containing `session_id` to withdraw: while the workspace
has CAPI enabled with a pixel ID, the return page shows granted consent and a
withdrawal action. This uses the existing session credential, not the staff
order verification page. Preserve that success link; there is no separate guest
order page. Once CAPI is disabled the return page no longer shows CAPI state,
dispatch blocks every pending job, and members still withdraw from their
account. Withdrawal stops future sends, not data already delivered to Meta.

The account list returns at most 100 decisions, with granted, not-withdrawn
consents first. Within each group, orders sort by creation time descending,
then order ID descending. Newer denials and withdrawn grants therefore cannot
hide an older active grant. If active grants alone exceed the bound, omitted
orders remain withdrawable through the original success link or the authenticated
withdrawal API; the list has no pagination. Evidence lists likewise cap at 100
and use recorded time plus transaction ID for stable ordering.

## Consent and access

For a workspace with `analyticsMetaCapiEnabled` and a Meta pixel ID, the paid
checkout status response contains `metaCapi`: enabled, the current
consent and withdrawal time, copy fields, privacy URL, and a SHA-256 `textVersion`
over the exact copy and privacy URL. The prompt is disabled for test purchases,
test sessions, an unconfigured pixel, a missing privacy URL, or a workspace
without a stored `analyticsMetaCapiAccessToken`. A disabled prompt still shows
an order's recorded grant and its withdrawal action.

`POST /api/public/meta-capi/consent` accepts exactly one order credential:
`sessionId` (the existing opaque Stripe checkout return credential) or
`orderToken` (the existing order verification/QR token, which permits only
`withdrawn`; it cannot grant or deny). New decisions require `sessionId`.
The contract and use-case both reject QR-token grants before repository access.
Its JSON body contains `decision`
(`granted`, `denied` or `withdrawn`), `textVersion` for a new decision, and
optional `fbp`. An invalid browser identifier is discarded, never used as
consent. Both decisions require a stored access token and the current text
version, so stale pages must reload rather than attest to copy they did not
display; a withdrawal needs neither. Browser IP comes from
the server's trusted proxy policy, not from the JSON body. User agent is bounded
to 1024 characters. The route is rate-limited with the public-write buckets,
requires JSON, rejects foreign Origin headers and offers no cross-origin
preflight.

A decision is once per order. Repeated or contradictory decisions return the
original state without creating another job. Withdrawal is idempotent and
permanent for that order. It sets the withdrawal timestamp, cancels pending work,
and prevents regranting. Accounts list their recorded decisions with
`GET /api/me/meta-capi/consents` and withdraw with
`POST /api/me/meta-capi/withdraw` and `{ "orderId": "..." }`; the repository checks
the signed-in member's ownership. Guests can withdraw with the order-link token
through the public endpoint. Withdrawal does not claim to recall data from Meta.

## Delivery and fields

The existing authenticated per-minute `GET /api/internal/dispatch-email` tick
also drains CAPI after email dispatch. It retains the existing bearer cron-secret
check. Self-hosted Node servers also invoke the same isolated runner from the
email ticker; CAPI cycles for the same runtime dependencies cannot overlap in
one process, including a concurrent cron request. A tick handles at most 20 jobs
within a 20-second dispatch budget, taking one due job per tenant per pass.
A tick first lists the tenants that have due jobs and visits only those, so an
empty outbox costs one query. No job starts unless the remaining budget covers
the 5-second request timeout.
The starting tenant rotates every minute, so tenants beyond a tick's budget
get a turn on subsequent minutes even when earlier tenants stay busy. Each
request has a 5-second timeout. Consent capture performs no Meta HTTP request.

The adapter pins Graph API **v27.0** in `META_GRAPH_API_VERSION`. The
[official changelog](https://developers.facebook.com/docs/graph-api/changelog/)
read on 2026-11-05 explicitly identifies v27.0 as the latest version; its version
table still starts at v26.0, so no release date is inferred for v27.0.

| Payload field | Source |
|---|---|
| `event_name`, `action_source` | `Purchase`, `website` |
| `event_id` | Order transaction ID, identical to the browser pixel event ID |
| `event_time` | Persisted order paid-at, in Unix seconds; never consent time |
| `event_source_url` | Canonical workspace origin and offer or checkout path, without query tokens |
| `user_data.em` | SHA-256 of trimmed, lower-case buyer email |
| `user_data.client_ip_address`, `client_user_agent` | Consent request, when available |
| `user_data.fbp` | Valid browser cookie value supplied with the consent request, when present |
| `user_data.fbc` | `fb.1.<attribution_at milliseconds>.<stored fbclid>`, when available |
| `user_data.country` | SHA-256 of lower-case ISO-2 country captured from Stripe customer address, when known |
| `custom_data.value`, `currency` | Paid gross amount in major units and ISO currency |
| `content_type`, `content_ids`, `contents`, `num_items`, `order_id` | Product order lines, one quantity per immutable order line, and transaction ID |
| `test_event_code` | Optional workspace test code, outside the event object |

Existing fbclid/gclid attribution persistence is unchanged. Gclid and UTM fields
are not sent to Meta. Test-mode orders, `cs_test_` sessions and simulated
purchases are blocked. A missing or future paid-at is blocked; purchases at least
seven days old expire. Eligibility and withdrawal are rechecked before every
attempt, including retries.

HTTP 5xx and network/timeout failures receive at most three retries, after 1, 2
and 4 minutes. HTTP 4xx, including 429, and invalid successful responses are final
failures. API messages and exception text are not persisted: errors are bounded
internal labels such as `http_400` or `network_or_timeout`.

## Evidence and concurrency

| Storage | Evidence retained |
|---|---|
| Order projection | Consent decision, UTC decision time, text version, source and withdrawal time |
| `meta_capi_consent_evidence` | Append-only decision/withdrawal records; exact copy and privacy URL snapshot, hash, order ID, UTC time and source |
| `meta_capi_outbox` | Pending order reference, consent request IP/UA/fbp, copy snapshot, attempts and next due time; deleted at a terminal outcome or withdrawal |
| `meta_capi_events` | One terminal receipt per transaction: workspace, order and consent time, paid time, sent/recorded time, sent/blocked/expired/failed status, trace ID, redacted error label and field names only |

A withdrawal record copies the text version and snapshot of the order's grant
record, so it names the wording the buyer accepted; a withdrawal without a grant
record stores the copy for the request locale.

No full outgoing payload, raw email, token or token fragment is stored in the
CAPI evidence log. The text snapshot is consent wording, not a payload snapshot.
A terminal event is append-only: withdrawal after a successful send preserves
the sent receipt and appends separate withdrawal evidence. The evidence tables
reference workspace-scoped orders. Owner-only `meta-capi events` lists the latest
100 receipts for the selected workspace.

Order row locks serialize decisions, withdrawal and dispatch. Workers skip
already locked orders; the consent and outbox insert commit together. Once a
withdrawal returns, no new dispatch for that order can start. An already-running
HTTP request finishes before a concurrent withdrawal commits. A process crash
after Meta accepted a request but before the database commit can cause another
attempt; the same `event_id` is preserved for Meta deduplication. This is not an
exactly-once network guarantee.

Pending request identifiers are removed on completion, expiry, blocking,
withdrawal or member erasure. No automatic retention period applies to
`meta_capi_consent_evidence` or `meta_capi_events`: the scheduled consent-evidence
purge covers terms and marketing consent only, so these rows remain until their
order or workspace row is deleted or an operator purge removes them, and member
erasure retains them (see
[member erasure](../member-erasure.md#meta-purchase-sharing-evidence)). Before enabling it,
the controller must document specific evidence-retention periods, recipient
agreements, international transfers and the procedure for data-subject requests.

## Local verification

Run `pnpm run check`, `pnpm run db:up`, `pnpm run smoke` and `pnpm run visual`.
The focused browser specification runs with `pnpm run e2e:meta-capi`.
It creates and removes its own local PostgreSQL database, builds and starts the
real SPA/API, blocks non-local browser requests, and dispatches through a fake
Meta gateway. It covers decline without an outbox job, acceptance with one job
and a sent receipt, Escape without a decision, a disabled tenant without CAPI
state on the return page, and guest withdrawal. English and Polish default-copy cases assert
the complete stored snapshot and its SHA-256 version; QR grants/denials and a
stale version after switching locale are rejected. The workspace stores a local
placeholder token encrypted with a per-run key; no real Meta access token or
external API is used.

## Verification before enabling production

1. Supply the pixel ID, privacy URL, encrypted token and a test event code in a
   non-production workspace approved for vendor testing.
2. Complete a real-mode purchase suitable for testing. Decline and verify no
   outbox row appears. For another purchase, grant and verify one outbox row.
3. Run the authenticated local/approved-environment tick. Verify a terminal
   receipt using `meta-capi events` and check Meta's
   [Test Events documentation](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/).
4. Confirm Purchase, its unchanged transaction ID, matching browser/server IDs,
   and deduplication when the separately consented pixel also fires.
5. Verify withdrawal cancels a pending attempt, clear the test code, and obtain
   the required production approval. Local tests use fake HTTP and do not send
   conversions to Meta.
