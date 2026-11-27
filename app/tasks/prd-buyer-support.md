# PRD: Buyer support inside Studio (e-mail, SMS, notes and one timeline per order)

## 1. Introduction

A real order showed the gap: an order paid with a foreign mobile number for a
parcel-locker delivery could not be shipped. The checkout let the number through
(the browser autofilled the buyer's second number), the order page had no way to
fix it, and staff had to leave the product to reach the buyer: a personal mail
client for e-mail, a private phone for an international SMS, and finally a direct
database edit to change the delivery phone, which left no audit trail.

This PRD covers two things:

1. **Quick fixes** (shipped first, separate pull request): the checkout refuses a
   phone number InPost cannot use before payment, and staff can correct the
   delivery details of an order still to pack, with an audit trail.
2. **Buyer support**: staff write to a buyer by e-mail and SMS from the order page
   and the contact page, replies come back into the same conversation, and every
   order and contact has one timeline with Together's automatic e-mails, manual
   e-mails, SMS, staff notes and attachments.

Section 7 compares building this inside Together with integrating a separately
deployed open-source helpdesk and states the recommended route.

## 2. Goals

- No staff member needs a database edit, a personal mail client or a private
  phone to resolve a delivery problem with a buyer.
- A parcel-locker order cannot be paid with a phone number that the shipment step
  refuses.
- A delivery-detail correction always records who, when, the old and the new value.
- Every message to or from a buyer about an order is visible on that order's
  timeline within 1 minute of being sent or received.
- Buyer replies to a staff e-mail arrive in the right conversation without staff
  copying anything.
- An SMS reaches a Polish or a foreign mobile number from the workspace, with its
  cost visible before sending.

## 3. What exists today (read before building)

| Area | Where | Reuse |
| --- | --- | --- |
| E-mail transport | `adapters/email/` (tenant SES, SMTP, Resend, platform fallback) selected per workspace | Manual e-mails use the same transport and the workspace's verified domain |
| Outbox | `email_outbox` (`adapters/db/app-schema.ts`), dispatcher `core/server/usecases/dispatch-email-batch.ts`, payload kinds in `core/domain/email-outbox.ts` | A new payload kind for a staff-written buyer message |
| Pre-rendered transactional mail | `core/domain/transactional-email*.ts`, `prerenderedTransactionalPayload` | Timeline shows these as "automatic" entries |
| Sent e-mails list | `/panel/marketing/sends`, `SendsPanel.tsx`, `email_events`, `EmailEventTimeline.tsx` | Delivery status per message on the timeline |
| Contact page | `/panel/marketing/contacts/$contactId`, `ContactDetailPanel.tsx`, `ContactSendsSection.tsx` | Mount point for the contact timeline |
| Buyer-to-seller message | `core/server/usecases/support.ts` (`support-message` to the workspace support address) | Becomes a timeline entry (inbound) |
| Staff notifications | `tenant-staff-recipients.ts` (e-mail), `adapters/notifications/in-app.ts` | New kind "buyer replied" |
| Sending domain | `tenant_ses_settings`, `ses-onboarding.ts` (DKIM), `EmailTab.tsx` | Reply sub-domain set up from the same screen |
| SNS handling | `marketing-sns-erasure.ts`, SES event topics | Pattern for verifying signed SNS deliveries |
| File storage | `adapters/storage/s3.ts` | Attachments |
| Erasure | `email-event-erasure.ts`, `member-erasure-request.ts` | Conversation content joins the erasure path |
| SMS | none in product code | New port and adapter |

## 4. User stories

### Part A: quick fixes

#### US-001: Locker delivery refuses a phone InPost cannot use, before payment
**Description:** As a buyer choosing an InPost delivery, I want to be told before
paying that only a Polish mobile number works, so my parcel is not stuck.

**Acceptance Criteria:**
- [ ] For a rate with carrier InPost (parcel locker and courier), the checkout shows its own phone field with a fixed `+48` prefix, `type="tel"`, `inputmode="tel"`, `autocomplete="tel-national"`, and a permanent hint explaining that InPost sends the pick-up code by SMS only to a Polish mobile number.
- [ ] The field validates on blur, on input after the first blur and after autofill; a foreign or malformed number shows an inline error before the buyer reaches payment.
- [ ] The server refuses the checkout with a distinct error code when the rule fails; a client-only check is not enough.
- [ ] Stripe keeps collecting a phone for one release so an in-flight checkout can finish after a rollback; the order prefers Together's canonical phone. The next release disables Stripe phone collection on InPost rates.
- [ ] The order stores the canonical `+48XXXXXXXXX` form.
- [ ] Polish and English copy.
- [ ] The project's own checks pass.
- [ ] Verified in the running app.

#### US-002: Staff correct delivery details of an order to pack
**Description:** As staff, I want to correct the delivery phone, the recipient name,
the address and the locker of a paid order still to pack, so the shipment can be
created again without a database edit.

**Acceptance Criteria:**
- [ ] "Correct delivery details" on the Delivery card, gated by the permission that marks an order as shipped (`order:write`).
- [ ] Also offered from the shipment error when InPost refuses the receiver.
- [ ] Refused once the order is shipped or a non-canceled shipment is bought.
- [ ] A non-canceled shipment with a provider id, a create attempt or an active operation lease blocks corrections; staff change the receiver in InPost Manager instead. A known canceled label does not block corrections, and saving does not recreate it.
- [ ] Each changed field is kept as an audit entry (who, when, old, new) and listed under the card.
- [ ] The locker code is verified the same way as at checkout; every InPost order's phone follows US-001's rule.
- [ ] The project's own checks pass.
- [ ] Verified in the running app.

### Part B: buyer support

#### US-010: Conversation model
**Description:** As a developer, I need one conversation per order (and one per
contact for messages without an order) to hold every entry.

**Acceptance Criteria:**
- [ ] New additive tables for conversations and entries (tenant-scoped, migration numbers assigned by the release coordinator).
- [ ] Entry kinds: `email_out`, `email_in`, `sms_out`, `sms_in`, `note`, plus read-only references to automatic e-mails already in the outbox. No closed enum the previous release reads gets a new value.
- [ ] Rollback proven against literal copies of the production release's schemas.
- [ ] The project's own checks pass.

#### US-011: Timeline on the order page and the contact page
**Description:** As staff, I want one timeline per order and per contact, so I see
everything said to and by the buyer in one place.

**Acceptance Criteria:**
- [ ] Order page shows the order's conversation; the contact page shows all of the contact's conversations, newest first.
- [ ] Automatic e-mails (order confirmation, shipped and others) appear as entries with their delivery status from the existing e-mail events.
- [ ] Each entry shows channel, direction, author (staff e-mail or "buyer" or "automatic"), time and delivery state.
- [ ] Visible only to staff with order read access; never on a buyer-facing page or the shop machine API.
- [ ] Verified in the running app.

#### US-012: Send an e-mail to the buyer
**Description:** As staff, I want to write to the buyer from the order page, sent
from the workspace's own address, so the buyer recognises the shop.

**Acceptance Criteria:**
- [ ] Composer with subject (prefilled with the order reference) and body; optional attachments (US-016).
- [ ] Sent through the workspace's configured transport from its verified sending address; refused with an explanation when no verified domain exists.
- [ ] The message carries a per-conversation reply address (US-013) and standard threading headers.
- [ ] Appears on the timeline at once as queued, then sent, delivered or bounced.
- [ ] Verified in the running app.

#### US-013: Buyer replies by e-mail land in the conversation
**Description:** As staff, I want a buyer's reply to arrive in the same
conversation, so I do not copy mail by hand.

**Acceptance Criteria:**
- [ ] Each conversation has a reply address on a workspace reply sub-domain that cannot be guessed (random token, not the order id).
- [ ] Inbound mail is received by the provider chosen in section 7, stored, verified (provider signature) and matched to its conversation by token, falling back to the threading headers.
- [ ] Mail that matches no conversation goes to an "Unmatched" list for staff, never dropped silently.
- [ ] HTML is sanitised before display; quoted earlier text is collapsed; attachments follow US-016's limits.
- [ ] Spam and auto-replies (`Auto-Submitted`, `Precedence: bulk`) are marked and do not notify staff.
- [ ] Staff with order access get an e-mail and an in-app notification for each buyer reply.
- [ ] The project's own checks pass; the inbound endpoint is reviewed by a security-focused reviewer.

#### US-014: Send an SMS to the buyer, Polish and foreign numbers
**Description:** As staff, I want to send an SMS from the order page, including to a
foreign number, so I reach a buyer who does not read e-mail.

**Acceptance Criteria:**
- [ ] SMS composer with a character and segment counter and the estimated cost per destination before sending.
- [ ] Sent through the workspace's SMS provider account with the workspace's verified sender name.
- [ ] Delivery reports update the entry (sent, delivered, failed).
- [ ] Refused with a clear message when the workspace has no SMS provider configured.
- [ ] No SMS is sent from automated tests or development to a real number; the adapter has a test mode.
- [ ] Verified in the running app against the provider's test mode.

#### US-015: Inbound SMS replies (second stage)
**Description:** As staff, I want a buyer's SMS reply in the conversation.

**Acceptance Criteria:**
- [ ] Enabled only when the workspace has a reply-capable number with its provider (paid number; owner's explicit OK).
- [ ] Inbound webhook authenticated with the provider's mechanism; matched to the latest conversation with that number.
- [ ] Without a reply number, the SMS text tells the buyer to reply by e-mail.

#### US-016: Staff notes and attachments
**Description:** As staff, I want internal notes and files (screenshots, photos) on
the timeline, so the whole case is in one place.

**Acceptance Criteria:**
- [ ] Notes are staff-only and visibly marked as internal.
- [ ] Attachments: images (PNG, JPEG, WebP, HEIC), PDF and plain text; max 10 MB per file and 25 MB per message; content type sniffed, not trusted from the name.
- [ ] Stored privately in the existing S3 storage under a tenant prefix and served only through short-lived signed links to authorised staff.
- [ ] Removed together with the conversation's content on erasure and at the end of retention.
- [ ] Verified in the running app.

#### US-017: Retention and erasure
**Description:** As the shop, I want buyer correspondence kept only as long as
needed and erased with the member.

**Acceptance Criteria:**
- [ ] Message bodies, notes and attachments are kept until the end of the calendar year three years after the conversation's last entry, then deleted by a scheduled job; a minimal record (date, channel, direction) remains.
- [ ] A member erasure deletes bodies, attachments, phone numbers and e-mail addresses of their conversations and keeps the anonymised minimal record.
- [ ] The privacy notice text lists the purpose (order handling), legal basis and period.

## 5. Functional requirements

- FR-1: The checkout server refuses an InPost-carrier delivery without a phone that normalises to a Polish 9-digit number (prefixes `+48`, `0048`, `48`; spaces and dashes allowed).
- FR-2: The order stores that phone in canonical `+48XXXXXXXXX` form and uses it for the shipment.
- FR-3: Staff with `order:write` can correct phone, recipient name, address (line 1, line 2, postal code, city) and locker of an order whose status allows shipping and whose fulfilment is "to pack", while no bought shipment exists.
- FR-4: Each correction appends one audit entry per changed field to the order's delivery data; the order page lists them.
- FR-5: A correction changes the order's live delivery data only. Sent e-mails, issued invoices and earlier audit entries stay as history.
- FR-6: Each order has at most one buyer conversation; contact-level conversations hold messages without an order.
- FR-7: A staff e-mail is sent through the workspace transport from its verified address with a per-conversation reply address.
- FR-8: The inbound mail endpoint accepts only provider-signed deliveries and stores the raw message before parsing.
- FR-9: An SMS is sent through the workspace's SMS provider; the estimated cost is shown before sending.
- FR-10: Inbound replies notify staff by e-mail and in-app notification.
- FR-11: Conversation content follows the retention and erasure rules in US-017.
- FR-12: No buyer-support data appears on buyer-facing pages or the shop machine API.

## 6. Non-goals

- No marketing or bulk SMS, no campaign tooling. One message to one buyer about their order.
- No chat widget on the shop site in this version.
- No automatic SMS on order events (shipped and others) in this version.
- No shared inbox for the workspace support address beyond buyer replies matched to conversations and the "Unmatched" list.
- No WhatsApp, Messenger or voice.
- No re-sending or editing of automatic e-mails from the timeline.

## 7. Build inside Together versus integrate a helpdesk

Read on 2026-11-25 from each project's licence file at its latest release tag and
its own documentation.

| Project (tag) | Licence | Inside this repo? | As a separate service | Multi-workspace | SMS | Inbound mail | Footprint |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chatwoot (v4.20.1) | MIT outside `enterprise/`; `enterprise/` under a paid seat licence | Allowed (MIT), `enterprise/` never | Allowed; community image tags `v*-ce` exclude paid code | Yes, accounts per install | Twilio, Bandwidth (two-way) | IMAP, or SES/Mailgun/SendGrid ingress | 4 GB RAM minimum, 8 GB recommended on the deploy page; Postgres 16 + pgvector, Redis, Sidekiq |
| Zammad (7.3.0) | AGPL-3.0-only | Never | Allowed; modifications reachable over the network must be offered as source (AGPL §13) | No (one help desk) | MessageBird, Twilio | IMAP/POP3 polling | Postgres, Redis, optional Elasticsearch |
| FreeScout (1.8.252) | AGPL-3.0 (paid modules also AGPL) | Never | Allowed, same AGPL §13 duty; API and SMS are paid modules | No | Twilio (paid module) | IMAP/POP3 polling | PHP + MySQL/Postgres |
| osTicket (v1.18.4) | GPL-2.0 | Never | Allowed; GPL-2 has no network clause | No | None | Piping or IMAP/POP3 | PHP + MySQL |
| UVdesk (v1.1.8) | OSL-3.0 (composer.json says MIT, the licence file wins) | Never | Network use counts as distribution (OSL §5 "External Deployment") | No | None | Mailbox polling | PHP + MySQL |
| Peppermint (0.5.5, 2024) | AGPL-3.0 | Never | Allowed, AGPL §13; webhooks unsigned; threading by subject | No | None | IMAP polling | Node + Postgres |

**Code inside the repository versus a separate service.** The Licensing & IP policy
(app/CLAUDE.md) forbids GPL/AGPL code in this repository, including ported code, and
allows only permissive dependencies. A separately deployed helpdesk reached over HTTP is
not part of this repository and does not change Together's licence. Its own licence
still applies to that deployment: under AGPL §13, a modified version used over the
network must offer its users the source of that modified version. An unmodified
deployment carries no extra duty beyond keeping the notices. Under OSL-3.0, any network
deployment is treated as distribution. Chatwoot's MIT part has no network clause.

**Cost and class of a separate service.** A helpdesk holding buyer phone numbers and mail
is a production system for the shops' buyers: SIL-3. It needs a paid commercial host with
no agent identity or token, tested backups and a rehearsed restore, and a promotion path
approved by the owner. A Chatwoot-sized server (4 vCPU, 8 GB) costs from EUR 30.49/month
excl. VAT (Hetzner CPX32, Helsinki; listed as currently unavailable on 2026-11-25),
before backups, object storage and the operator's time.

**Fit.**
- Only Chatwoot is permissively licensed and multi-workspace. Every other candidate would need one install per shop or a single shared desk.
- No candidate speaks Together's SMS choice (SMSAPI); SMS would go through Twilio.
- Together's automatic e-mails, orders and contacts would have to be pushed into the helpdesk. Every delivery correction, erasure and retention rule would then live in two systems with two data processors.
- Staff would leave Studio for the helpdesk, which is the problem the brief names.

**Recommendation: build inside Together.** Together already has the transport, the outbox,
SES identities and SNS handling, S3 storage, e-mail events, notifications, erasure and the
SIL-3 release path. The new parts are a conversation store, an inbound mail endpoint and an
SMS port: a few pull requests, no new production service. Chatwoot stays the fallback if
the scope grows towards a shared multi-channel inbox (live chat, social channels). It would
be deployed unmodified as a community image, so its licence adds no duty.

## 8. Providers

### 8.1 Inbound e-mail

| Provider | Price per received mail | How it reaches the app | Authentication | Max size | EU |
| --- | --- | --- | --- | --- | --- |
| Amazon SES receiving | $0.10 / 1,000 plus $0.09 / 1,000 chunks of 256 KB | Receipt rule: S3 (raw MIME) + SNS notification | SNS message signature (version 2 = SHA-256) | 40 MB via S3, 150 KB via SNS alone | eu-central-1, eu-west-1, eu-west-2, eu-south-1, eu-west-3, eu-north-1 |
| Postmark inbound | Only on Pro plan ($16.50/month and up) | JSON webhook | HTTP Basic Auth + IP allowlist, no signature | 35 MB | No (US) |
| Mailgun routes | Plan from $15/month | HTTP POST | HMAC-SHA256 | Not stated | EU region |
| Cloudflare Email Routing + Worker | Free inbound; Worker plan | In-process Worker | DMARC check, no webhook signature | 25 MiB | Not stated |
| SendGrid Inbound Parse | Plan from $19.95/month | HTTP POST | Optional ECDSA signature | 30 MB | Not stated for inbound |

**Choice: Amazon SES receiving** in the EU region the platform already uses for SES,
delivering raw mail to a private S3 bucket and a signed SNS notification to
Together. Together already holds SES identities, SNS topics and S3 storage, so no new
vendor joins the data-processing chain.

### 8.2 SMS

Prices are net, per single SMS (one segment), read on 2026-11-25. Dollar and euro
prices converted at the NBP mid rate of 2026-11-25 (USD 4.0966, EUR 4.4809).

| Provider | Poland | United Kingdom | Sender name | Replies | Test without a card | Data |
| --- | --- | --- | --- | --- | --- | --- |
| SMSAPI (PL) | 0.17 PLN (top-up 49–499.99 PLN) | 0.35 PLN "abroad", may be higher outside the EEA | Up to 11 characters, verified by the provider | Dedicated number 99 PLN/month (12-month contract) or 149 PLN/month | Free account, `test=1` sends nothing and costs nothing | EEA, DPA annex in the terms |
| SerwerSMS (PL) | 0.19 PLN (top-up 50–149 PLN) | about 0.20 PLN (network average) | Added in the panel; UK needs pre-registration | Dedicated number 99 PLN/month; "2waySMS" 19 PLN/month | 14-day trial, card requirement not stated | Location not stated |
| Twilio | $0.0457 ≈ 0.19 PLN | $0.056 ≈ 0.23 PLN | Alphanumeric, no registration for PL; send-only | Two-way on a leased number (UK mobile $2.50/month; PL price not published) | 30-day trial, no card, verified numbers only | Optional EU residency (Ireland) |
| Vonage | €0.04139 ≈ 0.19 PLN | €0.04839 ≈ 0.22 PLN | Up to 11 characters; replies only to a number | PL number €2.69/month | €2 test credit, card optional | DPA not fetched |
| AWS End User Messaging | $0.03222 ≈ 0.13 PLN | $0.05 ≈ 0.20 PLN | PL supported; UK registration required | PL long code $15/month | Sandbox; AWS sign-up asks for a card | EU location not stated |

**Choice: SMSAPI** for the first adapter. It is a Polish company with data in the EEA
and a DPA annex, it bills in PLN, it verifies the sender name for Polish networks and
its `test=1` mode lets development and tests run without sending or paying. The
adapter sits behind an SMS port, so Twilio (no-card trial, EU residency, published
UK pricing) can be added as a second adapter without touching the conversation code.
Each workspace connects its own SMS account: the shop is the sender and pays for its
messages.

### 8.3 Sender name rules (Poland and United Kingdom)

- Poland: the act on combating abuse in electronic communications (Dz.U. 2023 poz. 1703) creates a list of sender names reserved for **public entities** (kept by CSIRT NASK) and a list of SMS integrators for them (kept by the President of UKE). Operators block SMS that use a reserved public name from an unlisted sender. A private business does not register its own sender name with a regulator; the SMS provider verifies it. A name ending in `#RP` is reserved for public entities.
- United Kingdom: the SMS SenderID Protection Registry is an industry scheme (Mobile UK with MEF) that blocks protected brand names used by others. It is not a legal duty for a sender. Some providers ask for UK pre-registration of an alphanumeric name (SerwerSMS, AWS); Twilio does not.
- An alphanumeric sender is send-only everywhere: a reply needs a real number.

### 8.4 Consent and legal basis

- A message about the buyer's own order is sent to perform the contract (GDPR art. 6(1)(b)). The prior-consent rule for commercial information by e-mail or SMS (Prawo komunikacji elektronicznej, Dz.U. 2024 poz. 1221, art. 398) applies to promotion. Staff messages therefore carry no promotional content; the composer says so.
- Breaking art. 398 can be fined up to 3 % of the previous year's revenue or PLN 1,000,000, whichever is higher (art. 446 ust. 5). This is another reason the feature excludes marketing.

### 8.5 Retention

- GDPR art. 5(1)(e): no fixed period, no longer than necessary.
- Kodeks cywilny art. 568 § 1: the seller is liable for defects of a movable thing for 2 years from delivery. Art. 118: claims of a business become time-barred after 3 years, counted to the end of the calendar year.
- Ordynacja podatkowa art. 86 § 1 with art. 70 § 1: tax records for 5 years from the end of the year; correspondence is not named, so it is not the basis here.
- **Choice:** keep content until the end of the calendar year three years after the conversation's last entry (covers the 2-year warranty and the 3-year limitation for a business claim), then delete it and keep a minimal record.

## 9. Security and the SIL class

- Together is SIL-3 (commercial hosted). Buyer support built inside Together is part of that system: it ships only through the owner-approved promotion, with backups and the post-deploy smoke.
- The inbound mail and SMS endpoints are new unauthenticated public entry points. They accept only provider-signed requests (SNS signature, SMS provider mechanism). They are rate-limited, write the raw payload first and parse it asynchronously. A security-focused review is required before merge.
- Provider credentials (SMS API token) are workspace secrets, write-only in Studio, never in logs.
- Attachments are private objects, served only through short-lived signed links, with type sniffing and size limits.
- Inbound HTML is sanitised; remote images are not loaded by default.

## 10. Pull request plan

Each slice is one pull request against `staging`, reviewed locally first. Migration
numbers come from the release coordinator.

| # | Slice | Owner sees after merge | Needs |
| --- | --- | --- | --- |
| 1 | Quick fixes: Polish mobile for InPost deliveries at checkout; staff correct delivery phone, name, address and locker with audit trail | Checkout explains the phone rule before payment; "Correct delivery details" on the order page | Nothing |
| 2 | Conversation store + read-only timeline (automatic e-mails with delivery status) on the order page and the contact page | Each order shows what Together already sent the buyer | Migration numbers |
| 3 | Staff notes and attachments | Internal notes and screenshots on the order timeline | — |
| 4 | Staff e-mail from the workspace address, with a per-conversation reply address prepared | "Write to buyer" sends from the shop's own address, visible on the timeline | — |
| 5 | Inbound e-mail via SES receiving, matching, sanitising, "Unmatched" list, staff notifications | Buyer replies appear in the conversation; staff get notified | Owner OK: production MX record on a reply sub-domain and the production SES receipt rule (security review first) |
| 6 | SMS port, SMSAPI adapter (test mode), workspace SMS settings, composer with cost estimate | "Send SMS" on the order page, in test mode until a live account is connected | Owner OK: the shop's paid SMSAPI account and sender name |
| 7 | Retention job and erasure for conversations | Old content disappears on schedule; erasure covers conversations | — |
| 8 | Inbound SMS (optional) | Buyer SMS replies on the timeline | Owner OK: a paid reply number |

## 11. Success metrics

- Zero direct database edits of order delivery data after the quick fixes ship.
- Zero parcel-locker orders paid with a phone the shipment step refuses.
- A buyer reply appears in the conversation within 1 minute in 95 % of cases.
- Staff resolve a delivery problem without leaving Studio.

## 12. Decisions taken for the owner

- D1. Route: build inside Together (alternatives: Chatwoot as a separate service, Zammad or FreeScout as a separate service). Why: no new SIL-3 service, multi-workspace already, one data processor chain. Revert: "revert D1 → Chatwoot".
- D2. Inbound mail: Amazon SES receiving in the EU, raw mail to S3 plus a signed SNS notification (alternatives: Mailgun routes, Postmark). Why: same vendor and infrastructure as outbound. Revert: "revert D2 → Mailgun".
- D3. SMS provider: SMSAPI behind an SMS port, one account per workspace (alternatives: Twilio, SerwerSMS, a platform account). Why: Polish, EEA, DPA, PLN billing, free test mode. Revert: "revert D3 → Twilio".
- D4. InPost phone rule at checkout covers every InPost-carrier rate, courier included (alternative: parcel lockers only). Why: Together's own shipment step refuses a non-Polish phone for both services. Revert: "revert D4 → lockers only".
- D5. Together collects the phone for InPost rates and the order uses it; Stripe keeps collecting a phone for one release so a rollback still has one, and stops in the next release. Revert: "revert D5 → Stripe phone off now".
- D6. Delivery-correction audit is kept inline in the order's delivery data, no migration (alternative: an event table). Why: ships without a migration during the promotion freeze; the same pattern as personalisation corrections. Revert: "revert D6 → event table".
- D7. Retention: until the end of the calendar year three years after the last entry, then a minimal record (alternatives: 2 years, 6 years). Why: covers warranty and the business-claim limitation. Revert: "revert D7 → 6 years".
- D8. Attachments: images, PDF and text; 10 MB per file, 25 MB per message (alternative: any type). Revert: "revert D8 → any file type".
- D9. Inbound SMS is a later, optional slice; without a reply number the SMS asks the buyer to reply by e-mail. Revert: "revert D9 → reply number now".

Open, need the owner's explicit OK (nothing else waits on them):
- Production MX record and SES receipt rule for the reply sub-domain (slice 5).
- A paid SMSAPI account and sender name for the shop (slice 6).
- A paid reply number (slice 8).
