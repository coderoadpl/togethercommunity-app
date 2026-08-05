# Marketing e-mail — owner decisions and contract (2026-07-21)

> **STATUS (current):** the marketing module is SHIPPED. Phases P2-P5 are
> delivered and merged (P2-P4 overnight on branch `marketing-email`, P5
> observability package via PR #8, merge ab91e9a — see the execution records
> below). Together sends both transactional/notification e-mail (SES behind
> EmailPort with an **outbox table + cron dispatcher**: idempotent batches via
> FOR UPDATE SKIP LOCKED, batch = SES rate × interval; QStash/persistent worker
> = approved volume upgrade path) and native marketing campaigns (segmentation
> WITH exclusions, SNS bounce/complaint suppression, unsubscribe/preferences,
> campaign editor + stats). Running marketing on an external tool was the
> interim arrangement in force until parity was reached; the P1 spec defined
> that parity bar.
>
> **AMENDMENT (2026-07-21, infra/licensing session):**
> 1. **Licensing**: Together targets Fair Source (FSL-1.1 vs BSL-1.1 — picking
>    the exact text was a blocking pre-release task, resolved as FSL-1.1-ALv2,
>    see LICENSE.md).
>    100% copyright ownership; NO copyleft (GPL/AGPL) code ever, including
>    translated/ported code; dependencies permissive-only (MIT/Apache-2.0/
>    BSD/ISC) with a license check on every new dependency.
> 2. **Clean-room protocol v2 (strict)**: agents who read the prior-art
>    sources (inventory in the owner's private materials) write behavioral
>    specs in their own words; DIFFERENT agents implement from the spec alone
>    and must never see the sources or the analysts' raw reports. No naming
>    derived from those tools (trademarks).

> Owner decisions after reading the e-mail research DECISION note
> (the owner's private audit artifacts).
> Supersedes the "on hold" state; implementation proceeds in phases below.

## Architectural decisions (binding)

1. **BYO SES per tenant.** Each creator plugs their OWN Amazon SES credentials
   (tenant_secrets, same pattern as Stripe/Bunny/S3). Marketing sends go
   through THE TENANT'S key, infrastructure and sending reputation — the
   platform never sends marketing from shared infra and owns as few moving
   parts as possible. No tenant SES key = no broadcasts (clear panel hint).
   *Working assumption to confirm with the owner: platform-level transactional
   mail (magic links, receipts) stays on the platform's SES so the product
   works out of the box; a tenant SES key upgrades transactional to their
   identity too.*
2. **Scheduler: Vercel Pro cron / QStash** — the owner accepts Vercel Pro as
   the commercial baseline. Behind a port: dev uses an in-process batcher,
   deployment adapter picks cron/QStash. SES rate throttling per tenant key.
3. **Fully original implementation.** Before writing code: extract a complete
   requirements checklist (queueing, throttling, bounces/complaints,
   suppression, unsubscribe, consent, retention patterns), write tests first,
   then implement our own code. NO code copying; the clean-room discipline in
   `app/CLAUDE.md` applies to every inspiration source.
4. **No native drip builder. The automation API is the killer feature.**
   A public API (existing tenant API key mechanism) that sends marketing
   messages AS IF native: consent + suppression + unsubscribe + campaign log
   enforced server-side regardless of caller. Creators build arbitrarily
   complex sequences in n8n / Make.com. Ship with integration docs and
   ready-made example scenarios (n8n workflow JSON, Make blueprint).
5. **Consent creator (kreator zgód).** Panel wizard to define consents
   (name, copy, required/optional, scope, linked document). Documents:
   BYO URL (today's mechanism) OR hosted in-app (tenant uploads/authors the
   regulamin content; app serves versioned public pages usable in the consent
   links). Consent records stay append-only with document-version snapshots.
6. **Legal patterns via research, then professional review.** Open legal
   questions are flagged for professional legal review before public launch;
   the spec phase includes research on retention/suppression/double-opt-in
   obligations (PL/EU); decisions documented with sources, flagged clearly as
   research-not-legal-advice.
7. Suppression/retention recommendation from DECISION.md accepted (per-tenant
   suppression list lives in OUR database; erasure propagation documented).

## Phases

- **P1 SPEC (research):** requirements checklist from the research phase;
  legal-pattern research; API surface draft (broadcast + automation
  API); consent-creator UX sketch; output `tasks/marketing-email-spec.md`
  reviewed by the owner before P2.
- **P2 TESTS-FIRST CORE:** domain + ports + use-cases with the full test
  suite written against the spec (consent gate, suppression, throttle, token
  unsubscribe, campaign log, automation-API parity with native sends).
- **P3 SURFACES:** panel (campaigns, consent creator, SES settings), member
  unsubscribe pages, public automation API + docs + n8n/Make examples.
- **P4 VERIFY:** E2E on simulated SES sink + real-SES smoke on the owner's
  key (owner-triggered), convergence-style audit of the whole slice.

## P2-P4 GO decision (owner, 2026-07-22 night)

Owner greenlit the full implementation overnight, clean-room (implementers
read ONLY tasks/marketing-email-spec.md — never the prior-art sources or the
analyst reports). D1-D5 adopted per spec recommendations as WORKING DEFAULTS,
owner may override in the morning: D1 double opt-in ON per consent definition;
D2 transactional on platform SES, auto-upgrade to tenant SES once verified;
D3 hosted documents = markdown-authored versioned pages, v1; D4 consent
evidence retention 6y after withdrawal, IP/UA on consent events only;
D5 no tracking in MVP.

## D1/D3/D4 confirmed FINAL (owner, 2026-07-26)

No longer working defaults — owner explicitly confirmed: D1 double opt-in
default-on per consent definition (toggle + warning stays); D3 hosted
documents = markdown-authored versioned immutable pages, v1 scope; D4 consent
evidence retained 6 years after withdrawal, IP/UA captured on consent events
only. D2 superseded by D2-rev2 below; D5 superseded by the owner's 2026-07-26
decision to ship open/click via tenant SES config-sets (P5-W3, default off
per tenant).

## D2-rev2: layered transactional sender policy (owner, 2026-07-26 — BINDING)

Supersedes D2(b). Three layers for transactional mail (magic links, receipts,
resets):

1. **Default out-of-box: platform key with a LIFETIME cap** — every tenant may
   send their first **1000 transactional mails** on the deployment's SES key
   ("test before you wire your own sending"). Panel shows a usage counter and
   a migration nudge; at the cap, transactional sending requires layer 2 or 3.
   The cap counts transactional mail ONLY — marketing never touches the
   platform key (it is hard-blocked without tenant SES, M13, unchanged).
2. **Target path: tenant's own SES** via the W5 onboarding wizard (DKIM,
   config-set, SNS wired automatically; the AWS production-access request
   stays a one-time ~24h AWS-side step). Full tracking depth + own identity.
3. **Low-friction escape hatch: tenant SMTP, transactional ONLY** — minutes to
   configure, explicitly labeled in the panel as reduced tracking depth
   (relay-accepted only; no delivery/bounce events). Marketing remains
   SES-only on the tenant key, no exceptions.

W5 documentation duties (owner, 2026-07-26): (a) describe the SES
production-access request step-by-step, with READY-TO-PASTE answers for the
AWS use-case form generated from how our consent/suppression machinery
actually works; (b) a "free SMTP options" section for layer 3 — including
connecting a personal Gmail (app password, ~500/day consumer or Workspace
SMTP relay ~2000/day) with an honest "works but not recommended for
deliverability" caveat, plus 1-2 free-tier transactional SMTP providers with
permissive terms.

The platform transactional cap is a deployment-level knob; any commercial
plan strategy around it is kept in private materials. Platform SES is NEVER
extended to marketing (we do not control content or reputation there);
marketing stays tenant-SES-only.

Visibility structure for platform-key mail (owner question resolved 2026-07-26):
mail records are tenant-scoped — the tenant admin sees ALL mail of their
tenant in the Wysyłki view regardless of transport. The platform operator gets
usage/quota metadata per tenant (counters, statuses, cap consumption) for ops
and abuse handling — not a mail-content reading surface; content access stays
a DB-level processor capability documented in the DPA. `email_events` is
transport-independent, so history never splits on migration between layers.

## D2-rev2 as implemented (P5-W5 addendum, 2026-07-27)

D2-rev2 replaces the D2 working default above. Tenant-scoped transactional
mail selects exactly one transport in this order:

1. the tenant's verified SES identity and AWS key;
2. the tenant's configured SMTP relay;
3. the platform SES starter pool.

Selection and delivery are separate decisions. Once a transport is selected,
a delivery failure is returned and retried through the transactional outbox on
that same policy evaluation; the send does not fall through to a lower layer.
This deliberately prevents duplicate delivery when a provider accepts a
message but its response is lost. Owner-accepted consequence: a broken tenant
SES or SMTP configuration can delay magic links and other transactional mail
until the configuration is repaired or removed.

The platform starter pool is a lifetime allowance of 1,000 successfully
accepted tenant-scoped transactional messages per tenant. Failed sends do not
consume the allowance. Capacity reservations are atomic and expire after 15
minutes so a killed dispatcher cannot leak quota permanently. There is no
automatic reset; after exhaustion the tenant must configure SES or SMTP.
Platform-owned mail without a tenant remains on platform SES and does not use a
tenant pool.

Marketing transport is a separate hard boundary: campaigns and automation API
sends require the tenant's verified SES credentials. They never use tenant
SMTP or platform SES. The dependency gate protects the marketing adapters from
SMTP imports.

SES onboarding may disable identity feedback forwarding only after SNS reports
the HTTPS subscription as confirmed. Until then, SES feedback forwarding stays
enabled so bounce and complaint notifications retain a working path.

Checkout may collect only optional, product-attached marketing consents and
must never block purchase when consent persistence fails. It records IP and
User-Agent evidence when supplied by the proxy/client, logs failures, links the
exact hosted or external document version, and suppresses another DOI message
while an existing confirmation remains valid.

### W5 documentation duties

- This section is the binding owner record for transport priority, the
  no-fallback trade-off, lifetime starter-pool semantics, and transport
  isolation.
- `docs/ses-onboarding.md` is the operator runbook for the automated SES/SNS
  sequence, production access, transactional fallbacks, and pool exhaustion.
- Checkout-consent collection follows D1/D4 and the evidence contract in
  `tasks/marketing-email-spec.md`; hosted links always identify an immutable
  public document version.

## Executed: P5 observability package (2026-07-26/27, PR #8, merge ab91e9a)

Five sub-packages on branch `marketing-p5`, each with an independent Opus
review round, closed by an adversarial Fable audit (verdict APPROVE, zero
must) and full gates (check 1028 tests / smoke / visual 186 / e2e:marketing):

- **W1 event spine** — append-only `email_events` (projection + events is now
  the documented system convention in app/CLAUDE.md), deterministic ordering,
  transactional outbox reaches identical tracking depth (sesMessageId + SNS
  correlation), unified Wysyłki view + per-send timelines + member mail tab.
- **W2 scheduler observability** — `scheduler_runs` + per-tenant breakdowns,
  bidirectional runId linkage, tenant activity view + operator CLI.
- **W3 open/click** — tenant SES config-set events only; config set always
  attached (suppression independent of tracking), toggle default off,
  transactional never tracked.
- **W4 reputation dashboard** — S2 thresholds with volume floors, warn/
  critical surfaces, default-off auto-pause at critical.
- **W5 D2-rev2 + onboarding + editor + consents** — layered transactional
  transports with atomic lifetime pool, SMTP adapter with limited-tracking
  labeling, guided SES onboarding (feedback forwarding only after confirmed
  SNS), docs/ses-onboarding.md + docs/ses-sending-onboarding.md, GFM campaign
  editor sharing the send-path renderer, checkout marketing consents (M5,
  DOI-deduped), QA polish.

Audit's 4 non-blocking shoulds carried into the erasure-hardening follow-up:
event-meta PII scrub on erasure, transactional config-set split, checkout
non-DOI consent policy, outbox 'sending' reclaim.

## Executed (2026-07-22, overnight)

P2-P4 shipped on branch `marketing-email` in three workflow phases, each
stage gpt-5.5 clean-room implementation + independent Claude review:

- **P2 core** — `d3fbbb9` (11 tables + migration 0027, zod domain with U1-U10
  pure functions, ports, in-memory fakes), `2e7e5be` (full pipeline use-cases:
  consent lifecycle with DOI via the transactional outbox, HMAC suppression,
  campaign tick with lease/throttle/keyset/dedup/dequeue-recheck/footer hard
  gate/auto-pause/finalization, ONE send path for broadcast + automation API,
  M29 idempotency, erasure tombstone, retention jobs, tests I1-I13),
  `da01e3c` (drizzle repos, SES raw-send with RFC 8058 + bulk headers, SNS
  webhook with cert pinning + SSRF guard + TopicArn match, /u/:token,
  /legal/*, full /api/m2m/marketing/*, dev+cron scheduler, CLI), `a5c8c3e`
  (review fixes: campaignKey dedup no longer kills multi-step drips, real
  429 + Retry-After, M32 layout composition).
- **P3 surfaces** — `e4b6ec8` (panel: campaigns, consent creator with M5
  validation UX, SES settings + M19 onboarding checklist, hosted documents,
  layouts, PL/EN, stories + goldens), `a3d922b` (tenant-branded /u/:token
  preference page, /legal renderer, DOI landing), `ca8efb9` (automation API
  guide + importable n8n drip JSON + Make blueprint). Review verdict: approve.
- **P4 verify** — `45db9df` (markdown integrity on legal pages, DOI
  confirm-on-POST interstitial), `1cf833e` (`npm run e2e:marketing`: E1-E4 on
  throwaway Postgres + dev sink incl. locally-signed SNS envelopes; found and
  fixed unsubscribe URLs built on the platform host instead of the tenant
  host, migration 0029), browser QA (29 screenshots, journeys A/B/C), final
  adversarial audit, `42d7a88` (its 3 MUSTs: future-dated collectedAt could
  permanently defeat withdrawal — clamped; production scheduler was missing —
  vercel.json cron + re-enqueue-while-work-remains + retention wiring,
  migration 0030; automation API bypassed the SES throttle/daily quota —
  enforced cross-request).

Final gates on HEAD: `npm run check` (927 tests) + `npm run smoke` +
`npm run visual` (156/156) + `npm run e2e:marketing` (8/8) all green.
Remaining owner-triggered item: E5 real-SES smoke on the owner's key.
QA/audit should-fixes (consent-key validation copy, mobile tap targets,
generic "Zapisz kampanię" button labels, cancelled-campaign copy) filed as
backlog, non-blocking.
