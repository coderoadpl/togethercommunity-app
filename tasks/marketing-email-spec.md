# Marketing e-mail — full slice specification (P1 output)

> Produced 2026-07-21 from the clean-room analysis phase mandated by
> `tasks/marketing-email.md`. Inputs: clean-room behavioural analyses of
> prior-art tools (source inventory in the owner's private materials) and
> PL/EU legal-pattern research, plus the existing code surfaces
> (`core/server/ports.ts`, `core/domain/{consent,tenant-secret,api-key,transactional-email}.ts`,
> `adapters/email/ses.ts`, the `/api/m2m/enroll` route pattern).
>
> **License hygiene (binding).** The prior-art tools analysed are AGPL. Their
> sources were read by analyst agents for requirements and patterns only; this
> spec is written in our own words and contains no copied code and no
> line-by-line paraphrased algorithms. Implementing agents (P2+) work from THIS
> document and the contract alone and must never open those checkouts or the
> analysts' raw reports.
>
> **Scope note (status).** The marketing module specified below is SHIPPED —
> phases P2-P5 are delivered and merged, alongside the transactional stack (SES
> behind `EmailPort` + outbox/cron dispatcher). Running marketing on an external
> tool was the interim arrangement in force until parity was reached. This spec
> is the **parity bar** for the shipped module: the definition of "parity
> reached".

---

## 1. Requirements checklist

Legend: source tags — [LEX] legal research, [C] binding contract
`tasks/marketing-email.md`.

### 1.1 MUST for MVP (parity bar)

**Consent & eligibility**

- M1. Marketing eligibility is always derived server-side: member/e-mail has an
  `active` grant of the required marketing-consent definition AND is not
  suppressed AND is not unsubscribed from that scope. Evaluated at batch-fetch
  time AND re-checked at dequeue/send time, so late unsubscribes win. [C]
- M2. Consent records are append-only rows (grant → confirmed → withdrawn as new
  rows, never updates), with a snapshot of the exact wording shown and the
  linked document version. Extends the existing `terms_consents` discipline. [LEX][C]
- M3. Double opt-in flow: `pending` on form submit → confirmation e-mail
  (transactional class, zero promotional content) → `active` on click, second
  append-only row with timestamp (+ optional IP/UA). Only `active` is mailable.
  Stale `pending` purged after a configurable window (default 30 days). [LEX]
- M4. No implicit consent anywhere: automation-API contact upsert NEVER grants
  marketing consent; a consent grant requires an explicit consent-evidence
  payload (definition id + collectedAt + source/proof). A `subscribed=true`
  default on contact creation is the named anti-pattern. [LEX]
- M5. Consent-creator wizard validation: one purpose + one channel per
  definition; no pre-ticked optional consents; marketing consent can never be a
  required checkbox. [LEX]

**Suppression**

- M6. Per-tenant suppression table, first-class, keyed `(tenant_id, email)` with
  `reason ∈ {hard_bounce, complaint, manual, unsubscribe_global, erasure}`,
  source reference and timestamp. Checked in the core send use-case for EVERY
  marketing path (broadcast AND automation API), with no exempt path. [C]
- M7. Suppression survives erasure: member pseudonymization writes an
  HMAC-of-e-mail tombstone suppression entry in the same atomic operation that
  tombstones the e-mail (`MemberErasurePort.pseudonymize` extension). Suppressed
  ≠ unsubscribed; suppression wins over any consent state; complaint suppression
  is permanent, hard-bounce suppression may be lifted manually with an audit
  entry. [LEX]

**Unsubscribe**

- M8. Signed or opaque per-recipient unsubscribe tokens (never raw member ids —
  bare-UUID/raw-id links are rejected). Token resolves
  tenant + member/e-mail + campaign + scope; no expiry on unsubscribe tokens
  (links in old mail must keep working); expiry only on opt-in confirmations.
- M9. RFC 8058 one-click: `List-Unsubscribe: <https URL>` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` on every marketing send,
  emitted as a pair or not at all. The POST endpoint unsubscribes server-side
  with zero human steps, idempotent, 200 on repeat. GET renders the human
  preference page and never unsubscribes by itself (mailbox scanners GET
  links). A JavaScript-only preference page that never answers the one-click
  POST is the named anti-pattern. [LEX]
- M10. Bulk headers on marketing mail: `Precedence: bulk`,
  `Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All`.
  Transactional mail carries none of the unsubscribe pair. [LEX]
- M11. Hard gate: refuse to send any marketing message whose rendered body lacks
  the unsubscribe link and the mandatory identity footer (validated on rendered
  output, not by convention). [LEX]
- M12. Server-injected footer on every marketing send: tenant legal name +
  postal/electronic address (new tenant-settings fields, non-empty before
  broadcasts enable), "you receive this because…" consent reference,
  unsubscribe link. Tenants and API callers cannot remove it (art. 9 UŚUDE +
  Gmail/Yahoo). [LEX]

**BYO SES & deliverability**

- M13. Per-tenant SES credentials in `tenant_secrets` (AES-GCM, same pattern as
  Stripe/Bunny/S3). No tenant SES key ⇒ broadcasts disabled with a panel hint.
  Platform SES key is used only for platform transactional mail. [C]
- M14. Marketing sends need custom headers ⇒ the current SES v1
  `SendEmailCommand` adapter (`adapters/email/ses.ts`) is insufficient. Extend
  `EmailPort` with a headers-capable send (SESv2 `SendEmail` with raw/headers
  support or v1 `SendRawEmailCommand`); RFC 5322 care: no blank line may enter
  the header block, long-line wrapping. [LEX]
- M15. SNS bounce/complaint webhook, per-tenant-resolvable endpoint:
  signature verification with cert-URL pinning to `sns.<region>.amazonaws.com`,
  `SubscriptionConfirmation` auto-confirm with SSRF host allowlist, stored
  `TopicArn` match check (prevents cross-tenant spoofed suppression injection),
  always-200 ack on processing errors (non-200 only for bad signature /
  malformed payload).
- M16. Bounce classification: `Permanent` → hard; `Transient` → soft except
  status `5.4.4` promoted to hard; unknown bounce type → treated as permanent
  (fail-safe); `Complaint` → complaint. Fixed threshold actions in v1 (no
  knobs): soft 2/none, hard 1/suppress, complaint 1/suppress-permanent. Raw
  provider payload retained in a `meta` column.
- M17. Message attribution via SES `MessageId` correlation: store the returned
  MessageId on the send-log row at send time; webhook resolves the log row by
  MessageId (unique index). Header echo is fallback only (headers can arrive
  truncated).
- M18. Per-tenant throttle derived from the tenant key's `GetSendQuota`
  (rate/sec + 24h quota + sandbox detection), never asked of the tenant as a
  number to guess. Refreshed periodically and cached on the tenant SES
  settings row.
- M19. Onboarding checklist gate: broadcasts stay disabled until the tenant's
  identity is DKIM-verified, the SNS webhook is confirmed working (SES
  simulator addresses test step: bounce@/complaint@simulator.amazonses.com),
  and the identity/footer fields are filled. Panel surfaces SPF/DKIM/DMARC
  status. [LEX]

**Campaigns & pipeline**

- M20. Campaign state machine `draft → scheduled → running → paused →
  cancelled → finished` with validated transitions, persisted per tick
  (stateless serverless worker); content edits blocked outside
  draft/scheduled.
- M21. Resumable batcher: per-campaign cursor (last-processed member id) +
  audience snapshot upper bound + `to_send`/`sent` counters on the campaign
  row; keyset pagination, no OFFSET.
- M22. Per-recipient send log (contractual here): doubles as dedup ledger
  (skip recipient if already logged for the campaign ⇒ effectively-once on top
  of at-least-once ticks) and as consent evidence (references the consent row
  authorizing the send). [C][LEX]
- M23. Campaign lease/lock against double processing (`locked_until` lease per
  campaign or QStash single-flight) from day one — without it two concurrent
  processors double-send.
- M24. Auto-pause on error threshold with a clear panel message (bad/revoked/
  sandboxed tenant SES key must not burn retries).
- M25. Finalization probe: after every terminal send-log update, a cheap "any
  row still pending?" check flips the campaign to `finished` with partial
  counts — no campaigns stuck in `running` forever. FAILED is terminal.
- M26. Transactional mail always jumps the queue ahead of marketing (priority
  lanes) so magic links never wait behind a broadcast.
- M27. Test-send-to-self (tenant staff only, tagged, untracked, no variable
  substitution needed in v1).

**Automation API (killer feature)**

- M28. Public API on the existing tenant API-key mechanism (`x-api-key`,
  `authenticateApiKey`, `/api/m2m/*` pattern) whose sends are indistinguishable
  from native broadcasts: consent gate, suppression, throttle, unsubscribe
  token + headers + footer injection, send log — all server-side, regardless
  of caller. Parity is a P2 test requirement. [C]
- M29. `Idempotency-Key` support: claim-by-unique-insert `(tenant_id, key)`
  BEFORE the handler runs; reuse ⇒ `409` with original request metadata
  (refuse, never replay); claim released on 4xx, kept on 2xx/5xx; TTL'd rows
  with a sweep job.
- M30. Ineligible recipient ⇒ 4xx with a machine-readable reason code
  (`not_consented`, `suppressed`, `unsubscribed`, `pending_confirmation`) —
  the n8n/Make branching UX depends on it.

**Rendering**

- M31. Sandboxed, non-Turing template language: `{{var}}` interpolation with
  nullish (not falsy) fallback `{{var ?? fallback}}`, property paths only,
  HTML-escaped by default with explicit raw slots; never eval. Go-template-
  style logic is rejected as an SSTI-class multi-tenant risk.
- M32. Two-layer model: tenant layout with exactly one content slot + campaign
  content; HTML + auto-generated plaintext alternative. System variables always
  injected: member name/e-mail, tenant/brand fields, unsubscribe URL. API sends
  additionally take a free JSON `data` bag.

**Retention & erasure**

- M33. Erasure keeps aggregate campaign stats (sever identity, keep counts —
  SET-NULL-style orphaning), pseudonymizes send-log rows for the erased member,
  and never deletes suppression tombstones or in-window consent evidence. [LEX]
- M34. Scheduled retention jobs behind the scheduler port: purge stale
  `pending` consents (default 30 days), age out stored rendered bodies, purge
  event-level analytics per policy, sweep idempotency keys. [LEX]

### 1.2 SHOULD (post-MVP, spec'd so the MVP doesn't preclude them)

- S1. Guided SES onboarding automation with the tenant key:
  `VerifyDomainDkim` (DKIM CNAMEs as copy-paste DNS records),
  `CreateConfigurationSet` + SNS event destination, custom MAIL FROM subdomain,
  `SetIdentityFeedbackForwardingEnabled(false)` once SNS is wired, periodic
  verification poll with regression detection. MVP may document these as
  manual AWS-console steps behind the checklist (M19).
- S2. Reputation dashboards + optional auto-pause: 7-day hard-bounce warn 5% /
  critical 10%, complaint warn 0.075% / critical 0.15%, with ≥100-send and
  absolute-count floors — tenant-facing warnings, not a platform kill-switch
  (BYO SES = tenant's reputation).
- S3. Outbound tenant webhooks (or a polling endpoint) for `email.delivered/
  bounced/complained` and consent events so n8n reacts push-style; with SSRF
  guard (resolved-address private-IP/localhost blocklist) if webhooks. MVP
  fallback: poll the send-log endpoint.
- S4. Mirror suppressions into the tenant's SES account-level suppression list
  (belt and braces; our table stays the source of truth). [LEX]
- S5. Member self-service data export from the preference page.
- S6. Open/click accounting via the tenant's SES config-set event destinations
  (unique-vs-total, click link captured) — never a self-hosted pixel/redirector.
  Ships only if decision D5 turns tracking on.
- S7. Scheduled campaigns UI niceties: audience count preview at draft time,
  re-count at send time, recipient reconciliation at the last batch. (Snapshot
  counters themselves are MVP — M21.)
- S8. Tenant-scoped member labels as an audience grouping refinement on top of
  consent scopes + product grants.
- S9. Locale-aware footer/preference page copy (PL/EN) following the existing
  `transactionalLanguageSchema` pattern.

### 1.3 Deliberately OUT (with reasons)

- O1. **Native drip/workflow builder** — the contract's core bet: n8n/Make
  orchestrate; our API enforces. A native graph engine is replaced by the
  automation API + docs. [C]
- O2. **Raw-SQL segmentation** (admin-written WHERE clauses) — that shape
  assumes a single-tenant trust model and puts query text in operator hands.
  The automation API computes audiences externally instead.
- O3. **SMTP transport & non-SES providers, POP3 bounce mailbox polling** —
  BYO SES only; we already send via the SES API. [C]
- O4. **Visual/drag-drop e-mail builder, media library, attachments, inline
  cid images** — v1 is HTML + auto-plaintext; big surface, low parity value.
- O5. **Single opt-in with mailable unconfirmed contacts** and **implicit
  subscribe-on-track** as defaults — rejected on PKE/GDPR grounds; see
  decision D1 for the explicit toggle. [LEX]
- O6. **Platform-level kill-switch that disables a tenant on reputation
  metrics** — with BYO SES the risk is the tenant's;
  we warn and optionally pause broadcasts (S2), we don't brick accounts.
  Abuse-driven suspension stays a ToS/manual lever. [LEX]
- O7. **Domain-level signup blocklists, captcha, public subscribe forms** —
  Together members come from purchases/enrollment, not open signup forms; the
  consent creator covers acquisition. Revisit if public newsletter signup ever
  lands.
- O8. **Per-tenant configurable bounce-threshold knobs** — fixed
  SES-recommended defaults in v1 (M16); knobs are support burden.
- O9. **Self-hosted open/click tracking (pixel + link redirector)** — privacy
  default and effort; if tracking ships it is SES config-set events (S6).

---

## 2. Domain model

All tables tenant-scoped (`tenant_id` on every row, tenant-scoped uniqueness —
the same e-mail exists under many tenants). Names are suggestions; layering
follows the codebase rules (zod schemas in `core/domain`, ports in
`core/server/ports.ts`, Drizzle tables in `adapters/db/app-schema.ts`).

### 2.1 Consent definitions — the KREATOR ZGÓD

Builds ON TOP of the existing append-only consents slice
(`core/domain/consent.ts`, `TermsConsentRepository`) — no redesign of what
exists; today's terms/privacy checkout consent keeps working unchanged.

**`consent_definitions`** (mutable head, versioned bodies)

| field | notes |
|---|---|
| id, tenant_id | |
| key | tenant-scoped slug, e.g. `newsletter`; immutable after creation |
| kind | `required_terms` \| `optional_marketing` (marketing can never be required — M5, wizard-enforced) |
| channel | `email` in v1 (one purpose + one channel per definition — M5) |
| double_opt_in | boolean, default true (decision D1) |
| document_ref | `{ mode: 'url', url }` \| `{ mode: 'hosted', documentId }` |
| status | `active` \| `archived` (archived stops NEW grants; existing records untouched) |
| created_at, updated_at | |

**`consent_definition_versions`** (append-only)

| field | notes |
|---|---|
| id, tenant_id, definition_id | |
| version | monotonic int |
| label | consent copy exactly as shown next to the checkbox |
| document_version_ref | snapshot: BYO URL string, or hosted `document_version_id` |
| created_at, created_by | |

Every wording or linked-document change creates a new version row; consent
records always reference a specific version, satisfying art. 7(1) GDPR
demonstrability (wording + document snapshot).

**Hosted documents option** (the in-app "regulamin" alternative to BYO URL):

**`tenant_documents`** — id, tenant_id, slug, title, status.
**`tenant_document_versions`** (append-only) — id, tenant_id, document_id,
version, content (markdown), published_at, created_by.

Public versioned pages served on the tenant domain:
`https://<tenant-domain>/legal/<slug>` (latest published) and
`/legal/<slug>/v/<version>` (permanent, immutable — this is the URL consent
records snapshot). Existing `LegalUrls` settings can point at hosted pages,
so the BYO-URL mechanism is unchanged and hosted docs slot underneath it.

**Marketing consent records** — extend the existing append-only table's
discipline with a sibling table (keeps `terms_consents` untouched):

**`marketing_consents`** (append-only, `TermsConsentRepository`-style port)

| field | notes |
|---|---|
| id, tenant_id | |
| member_id | nullable (pre-membership capture allowed) |
| email | normalized via `normalizeEmail` |
| definition_id, definition_version | which consent, which wording |
| wording_snapshot | denormalized copy of the label shown |
| document_ref_snapshot | URL or hosted version id at grant time |
| status | `granted` \| `confirmed` \| `withdrawn` — each a NEW row referencing `previous_id` |
| source | `checkout` \| `panel` \| `import` \| `api` \| `preference_page` |
| evidence | JSONB: collectedAt, optional ip/user_agent (tenant toggle), import/proof ref |
| occurred_at | |

Current eligibility per (email, definition) = latest row's status; `confirmed`
required when the definition has double_opt_in (else `granted` suffices).
Rows are never updated or deleted; erasure pseudonymizes the email linkage
after the retention window only (M33, section 5).

### 2.2 Campaigns and sends

**`campaigns`**

| field | notes |
|---|---|
| id, tenant_id | |
| name, subject, body_html, body_source | |
| layout_id | nullable FK to `email_layouts` (two-layer rendering, M32) |
| consent_definition_id | the audience gate: everyone `active` on this consent |
| audience_filter | optional narrowing: `{ productIds?: string[] }` (grant-based) |
| status | `draft/scheduled/running/paused/cancelled/finished` (M20) |
| send_at | for `scheduled` |
| snapshot_max_member_id, cursor_member_id | resumable keyset batcher (M21) |
| to_send, sent, failed | counters on the row (cheap stats, purge-safe) |
| locked_until, locked_by | tick lease (M23) |
| error_count, paused_reason | auto-pause (M24) |
| started_at, finished_at, created_at | |

Audience names/consent label are denormalized at start so finished campaigns
stay meaningful if definitions are archived (historical snapshot posture).

**`campaign_sends`** — the per-recipient send log, unified for ALL marketing
paths (broadcast and automation API create rows in the same table; a row is a
"send attempt + outcome" record):

| field | notes |
|---|---|
| id, tenant_id | |
| campaign_id | nullable for API sends without a campaign; API sends may pass `campaignKey` to group into an auto-created `api` campaign |
| source | `broadcast` \| `api` |
| member_id, email | email kept for correlation; pseudonymized on erasure (M33) |
| consent_row_id | the `marketing_consents` row that authorized this send (M22/LEX evidence) |
| unsubscribe_token_id | token minted for this message |
| status | `pending` \| `sending` \| `sent` \| `failed` \| `skipped` |
| skip_reason | `suppressed/unsubscribed/not_consented/pending_confirmation` |
| ses_message_id | unique index; SNS correlation (M17) |
| delivery_status | `delivered/bounced/complained` + occurred_at, from webhooks |
| idempotency_source | API idempotency key ref, nullable |
| rendered_body_purged_at | body retention (M34) |
| created_at, sent_at | |

Unique `(tenant_id, campaign_id, email)` (where campaign_id not null) is the
dedup ledger: a crashed tick re-fetches the batch, skips already-logged
recipients ⇒ effectively-once.

**`suppressions`** (per-tenant, permanent)

| field | notes |
|---|---|
| id, tenant_id | |
| email | plaintext while the member exists |
| email_hmac | HMAC(tenant-scoped key, normalized email); the only identifier left after erasure |
| reason | `hard_bounce` \| `complaint` \| `manual` \| `unsubscribe_global` \| `erasure` |
| source_ref | campaign_send id / webhook event id / staff user id |
| created_at, lifted_at, lifted_by | lifting = manual, audited, forbidden for `complaint` |

Unique `(tenant_id, email_hmac)` active-row constraint. Send-path check
computes the same HMAC of the recipient and refuses matches — works both
before and after erasure.

**`unsubscribe_tokens`** (opaque server-side tokens; simplest revocable design)

| field | notes |
|---|---|
| id, tenant_id | |
| token | random ≥128-bit, unique |
| email, member_id | |
| campaign_send_id | nullable; scoping + logging |
| scope | `consent:<definitionId>` \| `all_marketing` |
| created_at, used_at | no expiry (M8); used_at is informational — reuse stays 200-idempotent |

Opt-in confirmation tokens are a separate short-TTL table
(`consent_confirmation_tokens`: token, marketing_consent_row_id, expires_at).

### 2.3 Tenant SES settings

Secrets (extend `tenantSecretKeySchema` — same AES-GCM storage):
`ses.accessKeyId`, `ses.secretAccessKey`, `ses.region`.

**`tenant_ses_settings`** (non-secret operational state, one row per tenant)

| field | notes |
|---|---|
| tenant_id | PK |
| from_address, from_name | must belong to the verified identity |
| identity | domain or e-mail identity string |
| identity_verified_at | from DKIM verification poll (S1) or manual confirm |
| configuration_set | config set name used for marketing sends |
| sns_topic_arn | the ONLY TopicArn the webhook accepts for this tenant (M15) |
| webhook_token | random path token for `/api/webhooks/ses/:token` |
| quota_rate_per_sec, quota_daily, quota_refreshed_at, in_sandbox | `GetSendQuota` cache (M18) |
| webhook_verified_at | set when a simulator bounce round-trips (M19) |
| footer_legal_name, footer_address | mandatory footer fields (M12) |
| broadcasts_enabled | derived gate, recomputed on read like onboarding checklist |

New ports (sketch): `MarketingConsentRepository` (record/list/latestByEmail,
append-only), `ConsentDefinitionRepository`, `CampaignRepository` (incl.
`acquireLease`, `advanceCursor`), `CampaignSendRepository` (incl.
`claimRecipient`, `correlateBySesMessageId`), `SuppressionRepository`
(`isSuppressed(tenantId, emailHmac)`), `UnsubscribeTokenRepository`,
`TenantSesSettingsRepository`, `SesMarketingSender`
(headers-capable send, credentials passed per call like `VideoLibraryPort` so
the use-case controls which tenant secret is decrypted), `SnsVerifier`,
`SchedulerPort` (tick/enqueue abstraction: dev in-process batcher, prod
Vercel cron / QStash), `EmailHmac` (keyed hash port for suppression).

---

## 3. Automation API — the killer feature

Design constraints: curl-simple (n8n/Make HTTP nodes, no SDK required), the
existing `x-api-key` header + `authenticateApiKey` + tenant-from-host pattern
of `/api/m2m/enroll`, and the parity guarantee: **an API send traverses the
exact same core use-case as a broadcast batch item** — one code path, tested
for parity in P2 (section 6). API can never bypass: consent gate, suppression
HMAC check, throttle (token bucket per tenant SES key), unsubscribe token +
RFC 8058 headers + footer injection, send-log row.

### 3.1 Endpoints (all under the m2m surface, `x-api-key` auth)

| method+path | purpose |
|---|---|
| `POST /api/m2m/marketing/messages` | send 1..50 marketing messages (template or inline body + `data` bag) |
| `GET  /api/m2m/marketing/eligibility?email=` | `{ eligible, reasons[], consent: {definitionId, status, since} }` — cheap pre-flight for branching |
| `POST /api/m2m/marketing/consents` | record consent WITH explicit evidence payload (definitionId, collectedAt, source, proofRef); triggers DOI confirmation mail when the definition requires it; never auto-eligible before confirmation |
| `GET  /api/m2m/marketing/suppressions?email=` / `POST .../suppressions` | read / add (`manual` reason); no delete via API |
| `GET  /api/m2m/marketing/messages?campaignKey=&email=&status=&cursor=` | send-log read (poll-based integration until S3 webhooks) |
| `GET  /api/m2m/marketing/messages/:id` | single send status incl. delivery_status |
| `GET  /api/m2m/marketing/templates` | list templates/layouts for the send call |

`POST /messages` body (single item shown; `messages: [...]` for batch):

```json
{
  "to": "member@example.com",
  "consentDefinitionId": "cd_newsletter",
  "templateId": "tpl_weekly",
  "data": { "firstName": "Ala", "offerUrl": "https://…" },
  "campaignKey": "drip-2026-07",
  "subject": "optional override"
}
```

Responses: `202 { results: [{ to, sendId, status: "queued" }] }`;
per-recipient failures inside a batch come back as
`{ to, status: "skipped", reason: "suppressed" }` (batch is not atomic;
each recipient stands alone). Whole-request 4xx reasons: `not_consented`,
`suppressed`, `unsubscribed`, `pending_confirmation`, `ses_not_configured`,
`broadcasts_disabled`, `validation` (M30). Throttle pressure ⇒
`429` + `Retry-After`.

Headers: `x-api-key` (existing), `Idempotency-Key` (optional, M29 semantics:
claim-by-insert, 409 refuse with original request metadata, release on 4xx,
keep on 2xx/5xx, TTL + sweep).

`campaignKey` groups API sends into an auto-created campaign row
(`source: 'api'`) so the panel shows n8n drips next to native broadcasts with
the same stats — part of the "indistinguishable" story.

Error codes join `ERROR_CODES` in `core/domain/errors.ts` with exhaustive
HTTP-status + exit-code mappings, per the layer rules.

### 3.2 Worked example A — n8n drip sequence (post-purchase 3-step drip)

Docs ship this as an importable n8n workflow JSON. Node list:

1. **Schedule Trigger** — every hour (poll-based v1; switches to a Webhook
   node when S3 outbound webhooks land).
2. **HTTP Request** `GET https://acme.together.app/api/m2m/orders?since={{$now.minus(1,'hour')}}`
   — new purchases (existing surface) — or the tenant's own store as source.
3. **Split In Batches** — iterate buyers.
4. **HTTP Request** `GET /api/m2m/marketing/eligibility?email={{$json.email}}`
   (header `x-api-key: {{$credentials.togetherApiKey}}`).
5. **IF** `{{$json.eligible}}` is false → **NoOp** end (reason available at
   `{{$json.reasons[0]}}` for logging).
6. **HTTP Request** `POST /api/m2m/marketing/messages` — day-0 welcome:
   `templateId: tpl_drip_welcome`, `campaignKey: "drip-{{$json.productId}}"`,
   `Idempotency-Key: drip0-{{$json.orderId}}`.
7. **Wait** — 3 days (n8n resumes the execution).
8. **HTTP Request** `GET /eligibility` again (late unsubscribes win — the API
   would refuse anyway, this keeps the run green).
9. **IF** eligible → **HTTP Request** `POST /messages` — day-3 tips,
   `Idempotency-Key: drip3-{{$json.orderId}}`.
10. **Wait** — 4 days.
11. **HTTP Request** `POST /messages` — day-7 offer,
    `Idempotency-Key: drip7-{{$json.orderId}}`; **on error 4xx** branch →
    NoOp (skipped recipients are success, not failure).

The idempotency keys make the whole workflow safely re-runnable after n8n
crashes/retries — no double sends.

### 3.3 Worked example B — Make.com welcome series (2-mail series)

Make has no durable multi-day Wait, so the docs blueprint uses two scenarios
and a Data store (pattern documented as-is):

**Scenario 1 — "Welcome: enroll & send #1"** (instant):

1. **Webhooks → Custom webhook** — tenant's signup/checkout system calls it
   (or Scenario 1 starts with **HTTP → Make a request** polling new members
   on a 15-min schedule).
2. **HTTP → Make a request** — `POST /api/m2m/marketing/consents` with the
   evidence payload collected at signup (definitionId `cd_newsletter`,
   collectedAt, source `api`, proofRef form id). If DOI is on, Together sends
   the confirmation mail itself; the series only ever reaches confirmed
   members because eligibility gates every send.
3. **HTTP → Make a request** — `GET /eligibility?email=…`.
4. **Router**, filter `eligible = true` →
5. **HTTP → Make a request** — `POST /messages`
   (`templateId: tpl_welcome_1`, `campaignKey: welcome-series`,
   `Idempotency-Key: w1-{{email}}`).
6. **Data store → Add/replace a record** — key `{{email}}`, fields:
   `stage = 1`, `dueAt = {{addDays(now; 2)}}`.

**Scenario 2 — "Welcome: send #2"** (scheduled every hour):

1. **Data store → Search records** — filter `stage = 1 AND dueAt <= now`.
2. **Iterator** over results.
3. **HTTP → Make a request** — `GET /eligibility?email=…`.
4. **Router**: not eligible → **Data store → Update** `stage = done-skipped`;
   eligible →
5. **HTTP → Make a request** — `POST /messages`
   (`templateId: tpl_welcome_2`, same `campaignKey`,
   `Idempotency-Key: w2-{{email}}`).
6. **Data store → Update a record** — `stage = done`.

Both examples ship in the docs with screenshots + the raw JSON/blueprint
export, per the contract's "ready-made example scenarios" requirement.

---

## 4. Send pipeline

### 4.1 Queue model

One logical loop (scan → lease → fetch batch by cursor → gate → render → send →
log → advance cursor), driven by ticks behind `SchedulerPort`:

- **dev**: in-process batcher (setInterval-style tick in the composition root),
  SES replaced by the existing dev e-mail sink so `npm run smoke`-class flows
  work offline.
- **prod baseline**: Vercel Pro cron hitting an internal tick route every
  minute; **upgrade path**: QStash schedules/queues (the amendment's approved
  volume path) — same port, adapter swap.

Tick algorithm (per tenant, campaigns first-come):

1. Promote due `scheduled` campaigns to `running` (state machine M20).
2. Acquire the campaign lease (`locked_until = now + tickBudget`, compare-and-
   set; QStash single-flight where available) — M23.
3. Compute the tick's send budget from the per-tenant token bucket
   (`quota_rate_per_sec` × tick seconds, capped by remaining 24h quota) — M18.
4. Keyset-fetch the next batch of eligible recipients
   (cursor < member_id ≤ snapshot_max): eligibility (consent `active`, not
   suppressed by HMAC, not unsubscribed in scope) evaluated IN the fetch
   query — late unsubscribes affect all unfetched batches (M1).
5. Per recipient: claim the send-log row (unique-insert dedup, skip on
   conflict — M22), re-check suppression/consent (dequeue-time re-validation),
   render (layout + content + variables), validate rendered body contains the
   unsubscribe link + footer (M11/M12), mint the unsubscribe token, build
   headers, send via the headers-capable SES port with the TENANT's decrypted
   credentials, store `ses_message_id`, mark `sent`.
6. Advance the cursor after each small sub-batch (Vercel time limits mean the
   tick may stop early at budget/timeout — the next tick resumes from the
   cursor; never sleep in-loop on serverless).
7. On SES auth/quota errors bump `error_count`; over threshold → `paused` +
   panel notification (M24). After terminal updates run the finalization
   probe (M25).

Transactional mail rides the existing outbox dispatcher and is always
prioritized ahead of marketing batches (M26); marketing ticks yield when the
transactional outbox is non-empty for the same tenant key.

### 4.2 Bounce/complaint ingestion

`POST /api/webhooks/ses/:webhookToken` (public, unauthenticated-but-verified):

1. Resolve tenant by `webhook_token`; 404 unknown.
2. Coerce content type when `x-amz-sns-message-type` is present (SNS posts
   text/plain).
3. Verify the SNS signature: cert URL pinned to
   `https://sns.<region>.amazonaws.com/…pem`, fetch+cache cert, verify; 403
   on failure.
4. `SubscriptionConfirmation` → SSRF-guarded fetch of `SubscribeURL`
   (https + exact SNS host), mark handshake done.
5. `Notification` → check `TopicArn` equals the tenant's stored
   `sns_topic_arn` (cross-tenant spoof guard, M15) → parse the SES event from
   `Message` → correlate the send-log row by `mail.messageId` (M17) →
   classify (M16) → apply: hard bounce / complaint ⇒ insert suppression row
   (reason + source_ref + raw payload in meta) + update
   `campaign_sends.delivery_status`; soft bounce ⇒ record only (threshold 2
   before any action, and v1 action for soft is none).
6. Always return 200 after signature+shape checks pass, even if processing
   fails (stops SNS retry storms); log processing errors.

### 4.3 Unsubscribe surfaces

- `POST /u/:token` — RFC 8058 one-click: resolve token → append
  `withdrawn` consent row for the token's scope (+ suppression row with
  `unsubscribe_global` when scope is `all_marketing`) → 200 empty. Idempotent,
  no UI, no redirect requirement (M9).
- `GET /u/:token` — tenant-branded preference page on the tenant domain:
  one-click confirm button, optional per-consent checkboxes (tenant's optional
  consents only), explicit "unsubscribe from everything from this creator".
  Never mutates on GET.
- Every marketing message carries `List-Unsubscribe: <https://<tenant-domain>/u/<token>>`,
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, plus the bulk header
  trio (M9/M10); the same URL is injected into the body footer (M11/M12).
- Suppression/withdrawal is effective immediately for any batch not yet
  fetched and re-checked at dequeue for in-flight rows — comfortably inside
  the Gmail/Yahoo 2-day bound.

---

## 5. Legal directives

> Legal requirements (PKE/GDPR) together with their analysis and the intended
> contractual position are kept in private materials; open questions go to
> professional legal review before the public launch.

The statutory obligations this spec itself implements stay stated as
requirements: consent capture with append-only evidence and document-version
snapshots (M2, M3, M5), the server-side consent gate on every send path
(M1, M28), suppression that survives erasure (M6, M7), one-click unsubscribe
with the non-removable identity footer (M9-M12), retention and erasure jobs
(M33, M34), and the mailbox-provider authentication and complaint bar
(M19, S2).

---

## 6. Test plan (P2 — tests first)

Written against this spec before any implementation; core-layer tests
(vitest) unless marked. Naming mirrors existing `usecases/*.test.ts`.

**Unit — domain**

- U1. Consent state derivation: latest-row wins; DOI definitions require
  `confirmed`; non-DOI accept `granted`; `withdrawn` terminal until a new
  grant; append-only repository never updates.
- U2. Consent-creator validation: marketing kind cannot be required; no
  pre-ticked optional; one channel; version bump on wording/doc change.
- U3. Suppression precedence: suppressed beats `confirmed` consent; complaint
  cannot be lifted; lift of hard_bounce requires actor + audit fields;
  HMAC matching is case/whitespace-insensitive via `normalizeEmail`.
- U4. Unsubscribe token: opaque, unguessable length, scope resolution,
  idempotent consumption (second POST = 200, no duplicate rows), no expiry;
  confirmation tokens DO expire.
- U5. Renderer: `{{var}}`/`{{var ?? fallback}}` nullish (0 and '' do NOT fall
  through), path-only lookup, HTML-escaping by default, raw slots explicit,
  arrays, missing → empty string, no code execution surface.
- U6. Rendered-output hard gate: body without unsubscribe link or footer
  fields ⇒ validation error, send refused.
- U7. Header builder matrix: marketing ⇒ RFC 8058 pair (both-or-neither) +
  bulk trio; transactional ⇒ neither; caller header overrides merge
  case-insensitively; no blank line can enter the header block.
- U8. Campaign state machine: every legal transition, every illegal one
  refused, edits blocked outside draft/scheduled, `finished` terminal.
- U9. Bounce classification: Permanent→hard, Transient→soft, 5.4.4→hard,
  unknown→permanent, Complaint→complaint; thresholds soft 2/none, hard 1,
  complaint 1.
- U10. Throttle math: token bucket from cached quota; tick budget respects
  rate × seconds and 24h remainder; sandbox flag blocks broadcasts.

**Integration — use-cases + fake adapters (in-memory repos, fake SES port)**

- I1. **Automation-API parity (the contract test):** the same recipient/
  template sent via broadcast batch and via `POST /messages` produces
  byte-equivalent headers, footer, token semantics, and identical send-log
  shape; both refused identically for suppressed/withdrawn/pending recipients
  with the right machine-readable reason.
- I2. Eligibility-at-fetch: withdraw/suppress mid-campaign between batches ⇒
  recipient in a later batch is skipped with logged reason.
- I3. Dequeue re-check: withdraw between claim and send ⇒ send refused,
  log row `skipped`.
- I4. Dedup ledger: replay a tick over an already-claimed batch ⇒ zero
  duplicate sends; crash-after-send-before-cursor scenario re-run is
  effectively-once.
- I5. Lease: two concurrent ticks on one campaign ⇒ one processes, one no-ops;
  expired lease is stolen.
- I6. Idempotency middleware: concurrent duplicate `Idempotency-Key` ⇒ exactly
  one execution + one 409 with original metadata; 4xx releases the claim;
  5xx keeps it; sweep removes expired.
- I7. Auto-pause: N consecutive SES auth failures ⇒ campaign `paused` with
  reason; resume works from cursor.
- I8. Finalization: all rows terminal (incl. FAILED) ⇒ `finished` with
  partial counts; never stuck in `running`.
- I9. SNS webhook: signature verify (bad cert URL host rejected), handshake
  confirm with SSRF guard, TopicArn mismatch rejected, correlation by
  MessageId, suppression written for hard bounce + complaint, soft bounce
  recorded only, processing error still 200.
- I10. Erasure interplay: `pseudonymize` writes the HMAC suppression tombstone
  atomically, consent rows survive within retention window, send-log rows
  pseudonymized, campaign counters unchanged.
- I11. DOI flow: consent via API ⇒ confirmation mail queued (transactional
  class, no unsub pair), confirm token flips to `confirmed` and records
  evidence; expired token refused; stale `pending` purged by the retention
  job.
- I12. Priority: transactional outbox items dispatch before a pending
  marketing batch on the same tick.
- I13. One-click POST endpoint: no auth, no body required, writes withdrawal +
  (scope=all) suppression, idempotent; GET never mutates.

**E2E (P4, dev SES sink + CLI/HTTP)**

- E1. Full broadcast on the dev sink: create consent definition → grant +
  confirm two members, suppress a third, leave a fourth pending → campaign to
  the consent scope → exactly the two confirmed receive; sink captures RFC
  8058 headers + footer + working token URLs.
- E2. Automation-API drip against the running server (the n8n example script
  as a TS test): eligibility → send → idempotent retry → send-log poll.
- E3. Simulated SNS bounce/complaint POSTs (generic ingest shape from the
  simulator) flip delivery status and suppress; subsequent campaign skips the
  address.
- E4. Unsubscribe journey in a real browser context: GET page renders on
  tenant domain, POST from page unsubscribes, one-click POST without UI
  unsubscribes.
- E5. Real-SES smoke on the owner's key (owner-triggered, P4 only):
  simulator addresses bounce@/complaint@/success@simulator.amazonses.com.

---

## 7. OWNER DECISION POINTS (max 5, with recommendations)

**D1. Double opt-in default.**
Options: (a) DOI hard-on for all marketing consents; (b) DOI default-on,
single opt-in per definition behind an explicit toggle + "you carry the burden
of proving consent" panel warning; (c) tenant free choice, no warning.
**Recommendation: (b).** Matches PL practice (DOI is the evidence gold
standard, not a statutory duty) and keeps import/migration flows possible;
the toggle is auditable per definition. Preconfirmed imports stay a
privileged operation with source recorded in the consent evidence.

**D2. Transactional-mail key policy (platform vs tenant SES).**
Options: (a) platform SES for all transactional forever; (b) platform SES by
default, automatic upgrade of transactional to the tenant's SES once their
identity is verified; (c) tenant SES required for everything.
**Recommendation: (b)** — confirms the contract's working assumption: product
works out of the box (magic links, receipts on platform identity), and a
verified tenant identity upgrades transactional mail to their brand/domain.
Marketing remains tenant-SES-only, no fallback, per the binding contract.

**D3. Hosted-documents scope for the consent creator.**
Options: (a) BYO URL only (defer hosted docs); (b) hosted docs v1 =
markdown-authored in the panel, versioned immutable public pages on the
tenant domain; (c) full document suite (file uploads, PDF, e-signatures).
**Recommendation: (b).** It is the piece that makes consent-version snapshots
airtight (immutable `/legal/<slug>/v/<n>` URLs we control), it is small
(two tables + one public route), and BYO URL remains available unchanged.
(c) is out of scope for an e-mail slice.

**D4. Consent-evidence retention window + IP/UA capture.**
Options: retention after withdrawal/erasure 6 years (conservative,
art. 118 KC general limitation) vs 3 years (business-claims reading); IP/UA
capture on consent events on or off by default.
**Recommendation: 6 years default, tenant-configurable down to 3, flagged for
lawyer confirmation; IP/UA capture default ON for consent/confirmation events
only** (it is the evidence DOI exists to produce; scope it to consent rows,
never to general analytics).

**D5. Open/click tracking scope for v1.**
Options: (a) none — send + delivery/bounce/complaint status only; (b)
campaign-level open/click via the tenant's SES config-set event destinations
(no self-hosted pixel), default off per tenant; (c) per-recipient tracking on
by default.
**Recommendation: (a) for MVP, (b) as the first post-MVP increment.** Bounce/
complaint ingestion (mandatory) already exercises the whole event pipeline;
opens/clicks add GDPR surface (legitimate-interest analysis, privacy-notice
updates) without gating parity. (c) is rejected as a default under EU
practice.

---

*Phase gate: this document is the P1 deliverable and requires owner review
before P2 (tests-first core) starts. P2 implements section 6 against sections
2–4; P3 adds panel/member surfaces + API docs with the section 3 examples;
P4 runs the E2E/audit pass.*
